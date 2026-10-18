"""One command for the book: serve it, look an address up, or add a name.

Dispatch is standard-library only and the server is imported inside `serve`
alone, because a lookup is the frequent operation and must not pay for a web
framework it never uses.

`lookup` makes a keyless GET and retries once with the configured token only
on 401. `add` presents the bearer token `write_token()` resolves and adds
names without replacing those already held.

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
    "agent": "Agent",
}

# The source the records this command writes carry. Mirrors the Literal in
# server.py; settled when a record is created and never rewritten.
SOURCE = "agent"
# Mirrors MAX_TAG_LENGTH and the batch limit in server.py; checked here only to
# fail before a round trip rather than after one.
MAX_TAG_LENGTH = 80
MAX_TAGS = 32
MAX_CHANGES = 5000


class Unavailable(Exception):
    """The book could not be reached. Never 'this address has no tag'."""


class Unconfigured(Exception):
    """This machine has not been told where the book is, or how to write to it."""


class CliParser(argparse.ArgumentParser):
    def error(self, message):
        # Exit 2 means the book or a write reply failed, never malformed input.
        self.exit(1, f"{self.prog}: error: {message}\n")


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
    parser = CliParser(
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


def additions_from(values, scope: str) -> list[dict]:
    """Check and group every name before sending a single batch."""
    held: dict[str, list[str]] = {}
    for value in values:
        pair = named(value)
        if pair is None:
            continue
        address, tag = pair
        tags = held.setdefault(address, [])
        if tag.casefold() not in {existing.casefold() for existing in tags}:
            tags.append(tag)
        if len(tags) > MAX_TAGS:
            sys.exit(f"{PROG}: {address} has more than {MAX_TAGS} tags in one batch")
    if len(held) > MAX_CHANGES:
        sys.exit(f"{PROG}: a batch carries at most {MAX_CHANGES} addresses")
    return [
        {"address": address, "scope": scope, "tags": tags, "source": SOURCE}
        for address, tags in held.items()
    ]


def confirmed(result, addition) -> bool:
    """Each requested tag must appear in the returned record and accounting."""
    if (not isinstance(result, dict) or result.get("address") != addition["address"]
            or result.get("scope") != addition["scope"]
            or not isinstance(result.get("created"), bool)):
        return False
    record = result.get("record")
    added, present = result.get("added_tags"), result.get("already_present_tags")
    if (not isinstance(record, dict) or record.get("address") != addition["address"]
            or record.get("scope") != addition["scope"]
            or not isinstance(record.get("tags"), list)
            or not isinstance(added, list) or not isinstance(present, list)
            or any(not isinstance(tag, str) for tag in [*record["tags"], *added, *present])):
        return False
    asked = {tag.casefold() for tag in addition["tags"]}
    reported = {tag.casefold() for tag in [*added, *present]}
    held = {tag.casefold() for tag in record["tags"]}
    return (len(added) + len(present) == len(addition["tags"])
            and asked == reported and asked <= held
            and (not result["created"] or not present)
            and not ({tag.casefold() for tag in added} & {tag.casefold() for tag in present}))


def capacity_items(body, additions) -> dict[tuple[str, str], dict] | None:
    """Trust a capacity refusal only when it accounts for our own items."""
    if not isinstance(body, dict) or body.get("code") != "tag_limit":
        return None
    entries = body.get("at_capacity")
    if not isinstance(entries, list) or not entries:
        return None
    asked = {(item["address"], item["scope"]): item for item in additions}
    seen = {}
    for item in entries:
        if not isinstance(item, dict):
            return None
        address, scope = item.get("address"), item.get("scope")
        if not isinstance(address, str) or not isinstance(scope, str):
            return None
        key = (address, scope)
        missing, present = item.get("not_added_tags"), item.get("already_present_tags")
        if (key not in asked or key in seen
                or not isinstance(missing, list) or not missing
                or not isinstance(present, list)
                or any(not isinstance(tag, str) for tag in [*missing, *present])
                or len(missing) + len(present) != len(asked[key]["tags"])
                or {tag.casefold() for tag in [*missing, *present]}
                   != {tag.casefold() for tag in asked[key]["tags"]}
                or {tag.casefold() for tag in missing}
                   & {tag.casefold() for tag in present}):
            return None
        seen[key] = item
    return seen


def add(argv: list[str]) -> int:
    parser = CliParser(
        prog=f"{PROG} add",
        description="Add established names, preserving the book's existing primary names.",
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
    additions = additions_from(
        [*args.name, *(read_lines(args.file) if args.file else [])], scope)
    if not additions:
        return 0

    try:
        book, token = book_url(), write_token()
    except Unconfigured as reason:
        sys.exit(f"{PROG}: {reason}")

    pending = additions
    not_added = []
    results = []
    problem = None
    try:
        status, body = request(book + "/tags", method="POST", token=token,
                               body={"additions": pending})
        if status == 409:
            full = capacity_items(body, pending)
            if full is None:
                problem = "the book refused the batch without a usable capacity report; nothing was written"
            else:
                not_added = [{"address": item["address"], "scope": item["scope"],
                              "tags": full[(item["address"], item["scope"])]["not_added_tags"],
                              "already_present_tags":
                                  full[(item["address"], item["scope"])]["already_present_tags"]}
                             for item in pending if (item["address"], item["scope"]) in full]
                pending = [item for item in pending
                           if (item["address"], item["scope"]) not in full]
                if pending:
                    # The first request wrote nothing. Try unaffected items
                    # once, then stop, whatever the second reply says.
                    status, body = request(book + "/tags", method="POST", token=token,
                                           body={"additions": pending})
                else:
                    status, body = 200, {"results": []}
    except Unavailable as reason:
        # A lost reply may have landed. A blind retry could restore a tag
        # someone removed between the two requests.
        problem = f"book unavailable: {reason}. Whether anything was added is unknown"

    if problem is None:
        if status == 401:
            problem = "the book did not accept the token"
        elif status != 200:
            detail = body.get("detail") if isinstance(body, dict) else None
            problem = f"the book answered {status}: {detail or 'refused'}"
        else:
            answer = body.get("results") if isinstance(body, dict) else None
            if (not isinstance(answer, list) or len(answer) != len(pending)
                    or not all(confirmed(result, item)
                               for result, item in zip(answer, pending))):
                problem = "the book did not confirm every tag; whether the write landed is unknown"
            else:
                results = answer

    if args.json:
        print(json.dumps({"results": results,
                          "not_added": [{"address": item["address"], "scope": item["scope"],
                                         "tags": item["tags"],
                                         "already_present_tags": item["already_present_tags"],
                                         "reason": "tag_limit"}
                                        for item in not_added],
                          **({"unconfirmed": True} if problem else {})}, indent=2))
    else:
        for result in results:
            if result["added_tags"]:
                action = "created" if result["created"] else "added"
                print(f"{short(result['address'])}  {' · '.join(result['added_tags'])}  {action}")
            if result["already_present_tags"]:
                print(f"{short(result['address'])}  "
                      f"{' · '.join(result['already_present_tags'])}  already present")
        for item in not_added:
            if item["already_present_tags"]:
                print(f"{short(item['address'])}  "
                      f"{' · '.join(item['already_present_tags'])}  already present")
            print(f"{short(item['address'])}  {' · '.join(item['tags'])}  not added (tag limit)")
        if not results and not not_added and not problem:
            print("Nothing to add.")
    if problem:
        print(f"{PROG}: {problem}", file=sys.stderr)
        return 2
    return 3 if not_added else 0


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
