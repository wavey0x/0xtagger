"""One command for the book: serve it, or look an address up.

Dispatch is standard-library only and the server is imported inside `serve`
alone, because a lookup is the frequent operation and must not pay for a web
framework it never uses.

`lookup` makes one GET and writes nothing. A write path will present the
bearer token `write_token()` resolves; nothing here writes yet.

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
COMMANDS = ("serve", "lookup")
TIMEOUT = 10
ADDRESS = re.compile(r"0x[0-9a-f]{40}", re.IGNORECASE)
CHAIN = re.compile(r"[1-9][0-9]{0,19}")
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
}


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
    parts = urlsplit(raw)
    # Plain HTTP would put the book, and later a write's token, on the wire.
    if parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in LOOPBACK):
        return raw
    raise Unconfigured(f"{raw} is not https, or http on loopback")


def write_token() -> str:
    """The bearer token a write presents: the same one the extension holds.

    Read internally and never printed, never an argument, never logged. The
    identity path the private browser view uses is a browser boundary — its
    `Origin` rule is not a credential for a command to supply for itself.
    """
    supplied = os.environ.get("OXTAGGER_TOKEN")
    if supplied and supplied.strip():
        return supplied.strip()
    path = config_home() / "token"
    try:
        mode = path.stat().st_mode
    except FileNotFoundError:
        raise Unconfigured(f"writing needs the book's token in {path}") from None
    except OSError as error:
        raise Unconfigured(f"cannot read {path}: {error.strerror}") from error
    # The same refusal ssh makes of a private key, for the same reason.
    if os.name != "nt" and mode & 0o077:
        raise Unconfigured(f"{path} is readable by others; chmod 600 it")
    token = path.read_text(encoding="utf-8").strip()
    if not token:
        raise Unconfigured(f"{path} is empty")
    return token


# ---------------------------------------------------------------------------
# The one request this program makes
# ---------------------------------------------------------------------------

def records_of(url: str) -> list:
    """One GET, and nothing else anywhere."""
    opener = urllib.request.build_opener(NoRedirect)
    request = urllib.request.Request(url + "/tags", headers={"Accept": "application/json"})
    try:
        with opener.open(request, timeout=TIMEOUT) as answer:
            body = json.load(answer)
    except urllib.error.HTTPError as error:
        raise Unavailable(f"the book answered {error.code}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise Unavailable(f"{urlsplit(url).netloc or url} could not be reached") from error
    except json.JSONDecodeError as error:
        raise Unavailable("the book returned an unreadable reply") from error
    records = body.get("records") if isinstance(body, dict) else None
    if not isinstance(records, list):
        raise Unavailable("that is not a 0xtagger book")
    return records


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


def addresses_from(path: str):
    """One or more addresses per line; blank lines and # comments skipped."""
    if path == "-":
        text = sys.stdin.read()
    else:
        try:
            text = Path(path).read_text(encoding="utf-8")
        except OSError as error:
            sys.exit(f"{PROG}: cannot read {path}: {error.strerror}")
    for line in text.splitlines():
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
    except Unconfigured as reason:
        sys.exit(f"{PROG}: {reason}")
    try:
        records = records_of(book)
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
# Dispatch
# ---------------------------------------------------------------------------

USAGE = f"""usage: {PROG} <command> [options]

  serve    run the address book
  lookup   what your book calls an Ethereum address

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
    sys.exit(f"{PROG}: no such command: {name!r}. Try: {', '.join(COMMANDS)}")


if __name__ == "__main__":
    sys.exit(main())
