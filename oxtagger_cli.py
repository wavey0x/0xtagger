"""One command for the book: serve it, look an address up, or add a name.

Dispatch is standard-library only and the server is imported inside `serve`
alone, because a lookup is the frequent operation and must not pay for a web
framework it never uses.

`lookup` makes a keyless GET and retries once with the configured token only
on 401. `add` presents the bearer token `write_token()` resolves and creates
names only where none already stand.

A book that cannot be read is reported as unavailable and never as an address
having no tag. Those are different answers and conflating them is how a
research note ends up calling a known address unlabelled.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

PROG = "0xtagger"
COMMANDS = ("serve", "lookup", "add")
TIMEOUT = 10
ADDRESS = re.compile(r"0x[0-9a-f]{40}", re.IGNORECASE)
CHAIN = re.compile(r"[1-9][0-9]{0,19}")
# Mirrors the scopes the server will store: global, or one chain.
SCOPE = re.compile(r"global|eip155:[1-9][0-9]{0,19}")
LOOPBACK = {"127.0.0.1", "localhost", "::1"}

# Mirrors extension/networks.js. A record names its own scope; this only makes
# that scope readable.
CHAINS = {
    "1": "Ethereum", "10": "Optimism", "56": "BNB Chain", "100": "Gnosis",
    "137": "Polygon", "8453": "Base", "42161": "Arbitrum", "11155111": "Sepolia",
}
# Mirrors SOURCE_NAMES in extension/shared.js.
SOURCES = {
    "safe:address-book": "Safe's address book",
    "safe:page": "Safe",
    "etherscan:page": "Etherscan",
    "arkham:api": "Arkham",
    "agent:investigation": "an investigation",
}

# The source the records this command writes carry. Mirrors the Literal in
# server.py; settled when a record is created and never rewritten.
SOURCE = "agent:investigation"
# Mirrors MAX_TAG_LENGTH and the batch limit in server.py; checked here only to
# fail before a round trip rather than after one.
MAX_TAG_LENGTH = 80
MAX_CHANGES = 5000


class Unavailable(Exception):
    """The book could not be reached. Never 'this address has no tag'."""


class Unconfigured(Exception):
    """This machine has not been told where the book is, or how to write to it."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """A book that redirects is not the book we were pointed at."""

    def redirect_request(self, *args, **kwargs):
        return None


# ---------------------------------------------------------------------------
# Where the book is, and what may write to it
# ---------------------------------------------------------------------------

def config_home() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config"
    return Path(base) / "0xtagger"


def configured(key: str):
    """One value from config.json, or None when this machine has no config."""
    path = config_home() / "config.json"
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except OSError as error:
        raise Unconfigured(f"cannot read {path}: {error.strerror}") from error
    try:
        settings = json.loads(text)
    except json.JSONDecodeError as error:
        raise Unconfigured(f"{path} is not valid JSON: {error}") from error
    if not isinstance(settings, dict):
        raise Unconfigured(f"{path} should hold a JSON object")
    return settings.get(key)


def book_url() -> str:
    """The book this machine is pointed at. No default: a book is personal, and
    one person's tailnet hostname has no business in everyone's checkout."""
    raw = os.environ.get("OXTAGGER_BOOK_URL") or configured("book_url")
    if not raw:
        raise Unconfigured(
            f'no book configured. Put {{"book_url": "https://…"}} in '
            f"{config_home() / 'config.json'}, or set OXTAGGER_BOOK_URL")
    raw = str(raw).rstrip("/")
    try:
        parts = urlsplit(raw)
        parts.port  # Raises on a port that is not a number, or out of range.
    except ValueError as error:
        # Not a word of the value is repeated, not even through the exception:
        # Python names the offending port in its own message, and a URL this
        # malformed may still be a mangled connect link.
        raise Unconfigured("that book URL cannot be read as a URL. Check the "
                           "scheme, host and port of the configured value") from error
    # The extension's connect link carries the book's key in its fragment, so a
    # pasted link must not become the configured URL — and must not be echoed
    # back in the refusal either. The server refuses these same shapes.
    if parts.fragment or parts.username or parts.password or parts.query:
        raise Unconfigured(
            "a book URL carries no key, credentials or query. The extension's "
            "connect link is not the book's address: keep the part before the #")
    if not parts.hostname:
        raise Unconfigured("that book URL names no host")
    # Plain HTTP would put the book, and later a write's token, on the wire.
    if parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in LOOPBACK):
        return raw
    raise Unconfigured(f"{raw} is not https, or http on loopback")


def configured_token() -> str | None:
    """The book's bearer token, if configured. Never printed or logged.

    A missing file is fine for a keyless read. A present file must meet the
    same permission and content rules whether lookup or add needs it.
    """
    supplied = os.environ.get("OXTAGGER_TOKEN")
    if supplied and supplied.strip():
        return supplied.strip()
    path = config_home() / "token"
    try:
        mode = path.stat().st_mode
    except FileNotFoundError:
        return None
    except OSError as error:
        raise Unconfigured(f"cannot read {path}: {error.strerror}") from error
    # The same refusal ssh makes of a private key, for the same reason.
    if os.name != "nt" and mode & 0o077:
        raise Unconfigured(f"{path} is readable by others; chmod 600 it")
    try:
        token = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError) as error:
        raise Unconfigured(f"cannot read {path}") from error
    if not token:
        raise Unconfigured(f"{path} is empty")
    return token


def write_token() -> str:
    """The token a write must present, resolved internally rather than passed
    as an argument. The browser view's `Origin` is not a CLI credential."""
    token = configured_token()
    if token is None:
        raise Unconfigured(f"writing needs the book's token in {config_home() / 'token'}")
    return token


# ---------------------------------------------------------------------------
# The request both commands use
# ---------------------------------------------------------------------------

def request(url: str, *, method: str = "GET", token: str | None = None, body=None):
    """Return (status, parsed body). No `Origin` is ever sent: that header is
    the browser view's boundary, not a credential for a command to supply."""
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    opener = urllib.request.build_opener(NoRedirect)
    message = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with opener.open(message, timeout=TIMEOUT) as answer:
            return answer.status, json.load(answer)
    except urllib.error.HTTPError as error:
        # A refusal is an answer worth reading: a conflict carries what stands.
        try:
            return error.code, json.load(error)
        except Exception:
            # A proxy may answer a 401 with HTML or no body. Lookup still needs
            # the status to know when the book requires a bearer token.
            if error.code == 401:
                return 401, None
            raise Unavailable(f"the book answered {error.code}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise Unavailable(f"{urlsplit(url).netloc or url} could not be reached") from error
    except json.JSONDecodeError as error:
        raise Unavailable("the book returned an unreadable reply") from error


def records_of(url: str) -> list:
    """Read once without a token; on 401 alone, retry once with one if set."""
    status, body = request(url + "/tags")
    if status == 401:
        token = configured_token()
        if token is None:
            raise Unavailable("the book requires a token; set OXTAGGER_TOKEN "
                              f"or put it in {config_home() / 'token'}")
        status, body = request(url + "/tags", token=token)
    if status != 200:
        raise Unavailable(f"the book answered {status}")
    records = body.get("records") if isinstance(body, dict) else None
    if not isinstance(records, list) or not all(map(readable, records)):
        # Half a snapshot is not a book. Reading one address out of a reply we
        # do not understand is how an outage starts looking like an answer.
        raise Unavailable("that is not a 0xtagger book")
    return records


def readable(record) -> bool:
    """A record this program can report on: an address and scope it can name,
    and at least one tag to print. Nothing else is its business — a tag longer
    than today's limit, or a source it has never heard of, still reads fine."""
    return (isinstance(record, dict)
            and isinstance(record.get("address"), str)
            and ADDRESS.fullmatch(record["address"]) is not None
            and isinstance(record.get("scope"), str)
            and SCOPE.fullmatch(record["scope"]) is not None
            and isinstance(record.get("tags"), list)
            and bool(record["tags"])
            and all(isinstance(tag, str) for tag in record["tags"]))


# ---------------------------------------------------------------------------
# lookup
# ---------------------------------------------------------------------------

def scope_name(scope: str) -> str:
    if scope == "global":
        return "All networks"
    chain = scope[7:] if scope.startswith("eip155:") else scope
    return CHAINS.get(chain, f"Chain {chain}")


def short(address: str) -> str:
    return f"{address[:6]}…{address[-4:]}"


def entry(record: dict) -> dict:
    """The first tag is the one a website shows; the rest follow it."""
    return {
        "address": record["address"], "found": True,
        "label": record["tags"][0], "tags": record["tags"][1:],
        "scope": record["scope"], "scope_name": scope_name(record["scope"]),
        "source": record.get("source"),
    }


def read_lines(path: str) -> list[str]:
    if path == "-":
        return sys.stdin.read().splitlines()
    try:
        return Path(path).read_text(encoding="utf-8").splitlines()
    except OSError as error:
        sys.exit(f"{PROG}: cannot read {path}: {error.strerror}")


def addresses_from(path: str):
    """One or more addresses per line; blank lines and # comments skipped."""
    for line in read_lines(path):
        yield from line.split("#", 1)[0].split()


def normalize(values) -> list[str]:
    """Lowercased, in the order given, each one checked rather than assumed."""
    found = []
    for value in values:
        if not ADDRESS.fullmatch(value):
            sys.exit(f"{PROG}: not a full Ethereum address: {value!r}")
        address = value.lower()
        if address not in found:
            found.append(address)
    return found


def look_up(records: list, address: str, chain: str | None) -> list[dict]:
    """Scope precedence as the extension paints it: the network asked about,
    else the name standing on every network. A name on some other chain covers
    nothing here, so it is reported as the aside it is."""
    here = [record for record in records if record["address"] == address]
    if chain:
        for scope in (f"eip155:{chain}", "global"):
            hit = [record for record in here if record["scope"] == scope]
            if hit:
                return [entry(hit[0])]
    elif here:
        return [entry(record) for record in
                sorted(here, key=lambda record: record["scope"] != "global")]
    elsewhere = sorted({scope_name(record["scope"]) for record in here})
    return [{"address": address, "found": False, "elsewhere": elsewhere}]


def search(records: list, text: str) -> list[dict]:
    wanted = text.casefold()
    hits = [record for record in records
            if any(wanted in tag.casefold() for tag in record["tags"])]
    return [entry(record) for record in
            sorted(hits, key=lambda record: record["tags"][0].casefold())]


def report(rows: list[dict], book: str, as_json: bool) -> None:
    if as_json:
        print(json.dumps({"book": book, "results": rows}, indent=2))
        return
    if not rows:
        print("No tag in your book matches that.")
        return
    named = [" · ".join([row["label"], *row["tags"]]) for row in rows if row["found"]]
    width = max((len(value) for value in named), default=0)
    for row in rows:
        line = f"{short(row['address'])}  "
        if not row["found"]:
            line += "— not in your book"
            if row["elsewhere"]:
                line += f" (named on {', '.join(row['elsewhere'])})"
        else:
            line += " · ".join([row["label"], *row["tags"]]).ljust(width)
            line += f"  {row['scope_name']}"
            if row["source"]:
                line += f"  from {SOURCES.get(row['source'], row['source'])}"
        print(line.rstrip())


def lookup(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog=f"{PROG} lookup", description="What your own book calls an Ethereum address.",
        epilog="Tags are your own labels, not verified identities.")
    parser.add_argument("address", nargs="*", help="one or more Ethereum addresses")
    parser.add_argument("--file", metavar="PATH",
                        help="read addresses from a file, or - for stdin")
    parser.add_argument("--find", metavar="TEXT", help="search your tags instead")
    parser.add_argument("--chain", metavar="ID",
                        help="prefer this chain's tag over the all-networks one")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    if args.chain and not CHAIN.fullmatch(args.chain):
        sys.exit(f"{PROG}: not a chain id: {args.chain!r}")
    if args.find and (args.address or args.file):
        sys.exit(f"{PROG}: --find searches your tags; give it no addresses")
    if not args.find and not args.address and not args.file:
        parser.print_help()
        return 0

    wanted = [] if args.find else normalize(
        [*args.address, *(addresses_from(args.file) if args.file else [])])

    try:
        book = book_url()
        records = records_of(book)
    except Unconfigured as reason:
        sys.exit(f"{PROG}: {reason}")
    except Unavailable as reason:
        # Nothing about any address is printed: an outage must not be able to
        # read as an answer. With --json there is no `results` key at all.
        print(f"{PROG}: book unavailable: {reason}", file=sys.stderr)
        if args.json:
            print(json.dumps({"book": book, "unavailable": str(reason)}, indent=2))
        return 2

    rows = search(records, args.find) if args.find else [
        row for address in wanted for row in look_up(records, address, args.chain)]
    report(rows, book, args.json)
    return 0


# ---------------------------------------------------------------------------
# add
# ---------------------------------------------------------------------------

def named(text: str) -> tuple[str, str] | None:
    """One `ADDRESS=Tag` or `ADDRESS Tag`, or None for a blank or comment.

    A `#` only starts a comment at the start of a line. A name may contain one
    — `Curve DAO #1` is a tag, not a tag and a remark — and silently writing
    half of it would be worse than refusing the line.
    """
    text = text.strip()
    if not text or text.startswith("#"):
        return None
    address, separator, tag = text.partition("=")
    if not separator:
        parts = text.split(None, 1)
        address, tag = parts[0], (parts[1] if len(parts) > 1 else "")
    address, tag = address.strip(), tag.strip()
    if not ADDRESS.fullmatch(address):
        sys.exit(f"{PROG}: not a full Ethereum address: {address!r}")
    if not tag:
        sys.exit(f"{PROG}: no name given for {address}")
    if len(tag) > MAX_TAG_LENGTH:
        sys.exit(f"{PROG}: a tag holds at most {MAX_TAG_LENGTH} characters: {tag!r}")
    if any(ord(character) < 32 or ord(character) == 127 for character in tag):
        sys.exit(f"{PROG}: a tag holds no control characters: {tag!r}")
    return address.lower(), tag


def changes_from(values, scope: str) -> list[dict]:
    """Every name checked before anything is sent, so a bad line costs no
    round trip and half a batch is never on its way."""
    held: dict[str, str] = {}
    for value in values:
        pair = named(value)
        if pair is None:
            continue
        address, tag = pair
        if held.get(address, tag) != tag:
            sys.exit(f"{PROG}: {address} is named twice, differently, in one batch")
        held[address] = tag
    if len(held) > MAX_CHANGES:
        sys.exit(f"{PROG}: a batch carries at most {MAX_CHANGES} names")
    return [
        # version None asserts nothing stands at this scope yet. For a chain,
        # only_if_unnamed also asks whether an all-networks name covers the
        # address; on a global write the server does not consult it, because
        # the version check above already answers the same question, so it is
        # left off rather than sent to do nothing.
        {"address": address, "scope": scope, "tags": [tag], "version": None,
         "source": SOURCE, **({} if scope == "global" else {"only_if_unnamed": True})}
        for address, tag in held.items()
    ]


def confirmed(records, change) -> bool:
    """A save is reported only where the book's reply shows what we asked for."""
    return any(isinstance(record, dict)
               and record.get("address") == change["address"]
               and record.get("scope") == change["scope"]
               and record.get("tags") == change["tags"]
               for record in records)


def add(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog=f"{PROG} add",
        description="Record a name your work established. Never replaces a name already in the book.",
        epilog="Writes read the book's token from its configured file; it is never an argument.")
    parser.add_argument("name", nargs="*", metavar="ADDRESS=TAG",
                        help="one or more addresses and the name each one has")
    scope_of = parser.add_mutually_exclusive_group(required=True)
    scope_of.add_argument("--chain", metavar="ID",
                          help="the network these names were established on (the normal choice)")
    scope_of.add_argument("--global", dest="everywhere", action="store_true",
                          help="name the address on every network: only for an identity "
                               "the evidence shows holds across chains")
    parser.add_argument("--file", metavar="PATH",
                        help="read `ADDRESS Tag` lines from a file, or - for stdin")
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    args = parser.parse_args(argv)

    if args.chain and not CHAIN.fullmatch(args.chain):
        sys.exit(f"{PROG}: not a chain id: {args.chain!r}")
    if not args.name and not args.file:
        parser.print_help()
        return 0

    scope = "global" if args.everywhere else f"eip155:{args.chain}"
    changes = changes_from(
        [*args.name, *(read_lines(args.file) if args.file else [])], scope)
    if not changes:
        return 0

    try:
        book, token = book_url(), write_token()
    except Unconfigured as reason:
        sys.exit(f"{PROG}: {reason}")

    kept, unsure = [], False
    try:
        status, body = request(book + "/tags", method="PUT", token=token,
                               body={"changes": changes})
        if status == 409:
            # Some of these are already named. Those are the book's to keep:
            # send the rest once and stop. One retry, never a loop.
            # The conflict key and the current record must both describe a
            # candidate we sent. A list we cannot account for is not a list
            # to filter by: it could report a stranger's name as kept.
            conflicts = body.get("conflicts") if isinstance(body, dict) else None
            asked = {(change["address"], change["scope"]) for change in changes}
            seen = set()
            valid = isinstance(conflicts, list) and bool(conflicts)
            if valid:
                for held in conflicts:
                    if not isinstance(held, dict):
                        valid = False
                        break
                    address, scope, current = (held.get("address"), held.get("scope"),
                                               held.get("current"))
                    if not isinstance(address, str) or not isinstance(scope, str):
                        valid = False
                        break
                    key = (address, scope)
                    current_scopes = {scope} if scope == "global" else {scope, "global"}
                    if (key not in asked or key in seen or not readable(current)
                            or current["address"] != address
                            or current["scope"] not in current_scopes):
                        valid = False
                        break
                    seen.add(key)
            if not valid:
                print(f"{PROG}: the book refused the batch and did not say which "
                      f"of these names it holds; nothing was written", file=sys.stderr)
                return 2
            kept = list(conflicts)
            taken = {(held["address"], held["scope"]) for held in conflicts}
            changes = [change for change in changes
                       if (change["address"], change["scope"]) not in taken]
            if not changes:
                status, body = 200, {"records": []}
            else:
                status, body = request(book + "/tags", method="PUT", token=token,
                                       body={"changes": changes})
                if status == 409:
                    # Named between the two requests. The book keeps what it has.
                    print(f"{PROG}: the book was written while this batch was being "
                          f"added; nothing further was written", file=sys.stderr)
                    return 2
    except Unavailable as reason:
        # A lost reply to a PUT does not say the write did not land.
        print(f"{PROG}: book unavailable: {reason}. Whether anything was saved "
              f"is unknown", file=sys.stderr)
        return 2

    if status == 401:
        print(f"{PROG}: the book did not accept the token", file=sys.stderr)
        return 2
    if status != 200:
        detail = body.get("detail") if isinstance(body, dict) else None
        print(f"{PROG}: the book answered {status}: {detail or 'refused'}", file=sys.stderr)
        return 2

    records = body.get("records") if isinstance(body, dict) else None
    if not isinstance(records, list):
        records, unsure = [], True
    saved = [change for change in changes if confirmed(records, change)]
    if len(saved) != len(changes):
        unsure = True

    if args.json:
        print(json.dumps({"saved": saved, "kept": kept,
                          **({"unconfirmed": True} if unsure else {})}, indent=2))
    else:
        for change in saved:
            print(f"{short(change['address'])}  {change['tags'][0]}  added")
        for held in kept:
            current = held["current"]
            print(f"{short(current['address'])}  {current['tags'][0]}  kept "
                  f"({scope_name(current['scope'])})")
        if not saved and not kept and not unsure:
            print("Nothing to add.")
    if unsure:
        print(f"{PROG}: the book did not confirm every name; whether the rest "
              f"was saved is unknown", file=sys.stderr)
        return 2
    return 0


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

USAGE = f"""usage: {PROG} <command> [options]

  serve    run the address book
  lookup   what your book calls an Ethereum address
  add      record a name your work established

`{PROG} <command> --help` describes one command.
"""


def main() -> int:
    argv = sys.argv[1:]
    if not argv or argv[0] in {"-h", "--help"}:
        print(USAGE, end="")
        return 0
    name, rest = argv[0], argv[1:]
    if name == "serve":
        # The only import of the web framework, and only when serving.
        from server import main as run_server
        sys.argv = [f"{PROG} serve", *rest]
        run_server()
        return 0
    if name == "lookup":
        return lookup(rest)
    if name == "add":
        return add(rest)
    sys.exit(f"{PROG}: no such command: {name!r}. Try: {', '.join(COMMANDS)}")


if __name__ == "__main__":
    sys.exit(main())
