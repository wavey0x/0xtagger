# Setup

0xtagger is a Python helper and an unpacked Chrome/Brave extension. The helper owns a SQLite book; the extension caches each connected API separately. Normal use requires no Node installation or application build.

## Run on your laptop

Use Python 3.10+ and [uv](https://docs.astral.sh/uv/getting-started/installation/):

```sh
git clone https://github.com/wavey0x/0xtagger.git
cd 0xtagger
uv run 0xtagger serve
```

The first run creates `~/.local/share/0xtagger/tags.sqlite3` and a random access token in `token.txt`. The helper listens on `http://127.0.0.1:8712`. Leave it running or start the same command through your operating system's login-service facility.

Without uv:

```sh
python3 -m venv .venv
.venv/bin/pip install .
.venv/bin/0xtagger serve
```

On Windows, use `.venv\Scripts\pip` and `.venv\Scripts\0xtagger serve`.

## Load the extension

Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's **extension** folder. Do not load the repository root. Chrome 125 or newer is required. Pin 0xtagger to the toolbar.

0xtagger starts with one address book kept on this device. There is nothing to connect and nothing to configure.

Open a supported website, then turn on the popup's **On this website** switch. The toolbar turns deep purple when tagging is active. Permissions are granted per website; other sites remain untouched. The popup also finds tags by name or address and adds a new address when you paste its full `0x` value. **Open address book** opens the full-page view for browsing, bulk work, importing, and exporting.

Click the purple tag glyph beside an address to edit its tags. The first tag is the default; + appends another and arrows reorder them. Enter saves; Escape or an outside click dismisses the draft. Turn off **Show tags** to temporarily reveal the website's original presentation for matching occurrences on that page. The popup's **On this website** switch restores every website default and persists across refreshes.

An inline editor shows its Save scope beside the button. It keeps an existing record's scope, otherwise uses the website's network for a usable site name, otherwise all networks. A pasted address in the popup starts with an explicit **All networks** choice, because its source may have nothing to do with the active tab. The popup and full-page book can choose a network for new tags. Removing a network override reveals global tags. The address switch suppresses the whole replacement until restored or reset by refresh, navigation, or switching books. **Remove tags** in the book editor prepares a deletion; Save commits it.

## Keep a book on a server

A book on a server can be reached from more than one device. Run the helper on your machine, or on a remote one behind an HTTPS reverse proxy:

```sh
uv run 0xtagger serve --public-url https://tags.example.com
```

For example, configure Caddy to forward to the helper's loopback listener:

```caddyfile
tags.example.com {
    reverse_proxy 127.0.0.1:8712
}
```

Use a reachable hostname and valid certificate. If serving under a path, pass the full base URL to `--public-url` and strip that path at the proxy. Requests reject redirects, so use the API's final URL.

The helper prints one line. In either view, open the address book menu, choose **Connect to a server**, and paste it. The book is named for where it is kept — **Local server** for one on this machine, the hostname otherwise — and can be renamed in its own row afterwards. A server that is already one of your books opens rather than being added twice. The key travels in the link's fragment, which your browser never sends to the server, and the field is cleared as soon as it has been used. Keep the line private.

Connecting and copying are separate: a book opens as it is. If it is empty and the previous book was not, its empty view offers to copy those addresses. The copy is the same single transaction a file import gets.

Books are separate and switching between them changes neither, so the book on your device stays exactly as it was while you use one kept on a server. A book is renamed in its own row in the list: hover it and click the pencil, or press F2 with the row focused. The trash button beside the book name removes the book that is open — removing one kept on a server only forgets it here, while removing one kept on this device deletes its addresses. **Import** in the full-page book carries addresses from an exported file into the book that is open.

For a book kept on a server, sync is a read-only snapshot pull, asked for where you are about to look at the book: opening the popup, switching to it, a page coming back to the front, opening an editor, and startup — at most once a minute however many of those arrive together, plus a five-minute backstop and the manual refresh. The pull is conditional, so a book that has not changed answers in a few hundred bytes and nothing downstream is told anything. A book kept on this device is never pulled, since nothing else writes it. Failed pulls keep the previous copy. An explicit save is the only operation that changes a book; saving to a server book needs that server. Conflicting or failed saves preserve the draft. A confirmed import travels in one atomic request, with a limit of 5,000 changes.

## Browse privately through Tailscale

The helper also ships the same book page and editor for an ordinary browser.
This view opens the server's one book: search, add/edit/remove tags, and import/export.
It uses your Tailscale identity, so its bookmark contains no access key.

On the server, explicitly allow your Tailscale login and keep the helper bound to loopback:

```sh
uv run 0xtagger serve --public-url https://machine.your-tailnet.ts.net/0xtagger/ \
  --tailscale-login you@example.com
tailscale serve --bg --https=443 --set-path=/0xtagger/ http://127.0.0.1:8712
```

Use the actual machine name and login from your tailnet. Open the plain HTTPS URL
while connected to Tailscale. Serve strips the mount prefix before forwarding;
the UI and API share an origin, and CORS stays disabled. Keep Funnel off.
The extension continues to use the private connection link and its stored API key.

An open browser page keeps its saved tags if the server becomes unreachable.
It checks again when connectivity returns, when you return to the tab, and once
a minute while visible. Failed edits stay in the open editor for you to retry;
they are never queued for a later upload. Closing or reloading discards that draft.

`--tailscale-login` (or `OXTAGGER_TAILSCALE_LOGIN`) trusts the identity supplied by
the local Serve proxy and accepts only that configured login. Serve replaces
incoming identity headers. Loopback binding keeps the backend off the network;
this deployment still trusts the server's local processes. Browser writes also
require the configured HTTPS origin. Without this explicit proxy configuration,
identity headers grant no access and API clients require the key.

The installed Python package includes the UI assets. The data directory is never
served. See [Tailscale Serve identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers).

## Look an address up from the terminal

`0xtagger lookup` prints what your own book calls an address and writes nothing.
It reads without a key first, then retries once with the book's token only if
the book answers `401`.

```sh
0xtagger lookup 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984
0xtagger lookup --file addresses.txt      # one or more per line, # comments skipped
0xtagger lookup --find gauge              # search the tags instead
0xtagger lookup 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984 --chain 1   # prefer this chain's tag
0xtagger lookup 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984 --json      # machine-readable
```

Install it so it runs from anywhere, then tell it where your book is:

```sh
uv tool install --editable .
mkdir -p ~/.config/0xtagger
echo '{"book_url": "https://machine.your-tailnet.ts.net/0xtagger"}' > ~/.config/0xtagger/config.json
```

There is no default book: a book is personal, and the URL belongs on the
machine rather than in the checkout. `OXTAGGER_BOOK_URL` overrides the file.
Remote books must be HTTPS; `http://` is accepted only on loopback. The
[Tailscale view](#browse-privately-through-tailscale) supplies your identity,
so its reads stay keyless. For a book that requires a token, set
`OXTAGGER_TOKEN` or keep it in `~/.config/0xtagger/token` as described below.
The command reads it internally. If the book cannot be read, lookup reports
it as unavailable — never as an address having no tag.

## Record a name from the terminal

`0xtagger add` records strong names the work established. It creates a record
when that address and scope are new, or appends distinct tags to an existing
record. The existing first tag stays the displayed name; nothing is replaced
or deleted.

```sh
0xtagger add --chain 1 '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984=UNI Token'
0xtagger add --chain 1 '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984=UNI Token' '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984=Uniswap Token'
0xtagger add --chain 1 --file identities.txt   # `ADDRESS Tag` per line, # comments skipped
0xtagger add --global '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045=vitalik.eth'
```

`--chain` is the normal choice: a name established on one network belongs to
that network. `--global` names the address everywhere and is for an identity
the evidence shows holds across chains, never a fallback when the chain is
unclear. One invocation carries one scope; run it again for another. The whole
batch is checked before anything is sent and normally lands in one atomic
request. Repeated addresses collect tags in the order given. If only a global
record exists, a chain addition creates a more specific record that becomes the
displayed name on that chain. `Agent` is recorded as the source only
when a new record is created; an existing record keeps its original source.

Writing presents the book's own token, read from `~/.config/0xtagger/token`:

```sh
install -m 600 /dev/null ~/.config/0xtagger/token   # then paste the token in
```

That is the same token `token.txt` holds on the server and the extension keeps
privately, so rotating it means updating the server, this file, and the
extension's connection. The command reads it internally and never accepts it as
an argument or prints it; a token file others can read is refused. The browser
view's Tailscale identity and `Origin` rules stay a browser boundary — a
command does not supply those for itself, and writes send no `Origin` header.

Exit `0` means every requested tag is present, newly added or already held.
Exit `1` is bad input or local configuration. Exit `2` is a server, credential,
transport, or reply failure; an unanswered write may have landed, so do not
retry blindly. Exit `3` means the output names tags that could not be added
because a record is full. On a capacity refusal, the server writes none of the
batch; the command excludes the full records and tries the rest once. A
capacity omission is known and is never reported as an existing tag.

## Correct a name from the terminal

`0xtagger rename` replaces an existing record's first tag, removing the old
primary name and preserving other aliases and the original source. If the new
name is already an alias, it is promoted without duplication.

```sh
0xtagger rename --global '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045=Vitalik' --json
0xtagger rename --chain 1 --file corrections.txt   # one ADDRESS=Name per line
```

Use the same credentials and explicit scope as `add`. Each address must already
have a record in that exact scope; `rename` never falls back to another network
or creates a record. A global rename leaves network overrides intact. Other
addresses are untouched, and names already matching require no write.

Renames travel in one version-checked API batch. A concurrent edit rejects the
whole batch; look up and review the current names before trying again. Exit `0`
confirms the requested names, `1` means invalid input, missing targets, or local
configuration, and `2` means a read/write failure or conflict. An unconfirmed
write may have landed: do not retry blindly. Agent updates use these API-backed
commands, without opening the browser or handling credentials themselves.

## Data and backups

Choose a different port or data directory:

```sh
uv run 0xtagger serve --port 8713 --data-dir /path/to/book
```

`OXTAGGER_DATA_DIR` sets the directory, and `OXTAGGER_TOKEN` supplies a token instead of `token.txt`. Restart the helper after changing its token and update that connection in the popup. Keep credentials and books outside the checkout.

In the browser, records live in the extension's IndexedDB database, keyed by book, network scope and address; the books themselves — their names, where each is kept, and any access keys — live in extension storage restricted to trusted contexts. The `unlimitedStorage` permission is what keeps that database exempt from being evicted under storage pressure, so do not remove it as redundant.

**Export book** on the full-page view downloads the selected book's records without credentials. For a complete server backup, stop the helper and copy `tags.sqlite3` and `token.txt`. Restore them to that installation's data directory before restarting. Switching APIs does not transfer or merge data.

## Updates and privacy

This is an unpacked development extension. After editing or pulling its code, reload 0xtagger on the extensions page and refresh enabled websites. The manifest pins a public `key`, so the extension keeps one id — `odmejkpnlpbgpbohiejgiappnlohlgbj` — and therefore its stored books, wherever the checkout sits. Moving the folder still needs a **Load unpacked** from the new location, but nothing is lost when you do. Restart the helper when its Python code changes. Address-book sync is independent of code reloads.

Displayed tags are part of the website's DOM and readable by that website. Credentials remain in trusted extension storage. A website's own stored address book is read only in response to **Import names from Safe** in the popup, through that site's adapter, and the names it returns are reviewed in the address-book tab before anything is written; nothing is read while you browse, and a website can neither start an import nor learn what your book already holds. Etherscan-family explorers and Safe have dedicated adapters; other enabled sites use full-address detection. Embedded views on the enabled website's own origin are included, such as Etherscan's token-transfer tabs; frames from other origins remain untouched. Inputs, signing controls, unresolved abbreviations, and ambiguous addresses are skipped. An inconsistent site integration pauses tagging and offers Retry in the popup.

## Development checks

```sh
uv sync --locked
npm ci
npx playwright install chromium
uv run pytest -q
npm test
npm run test:browser
```

On Linux, use `npx playwright install --with-deps chromium`. Tests use disposable books and browser profiles. They focus on identity, data integrity, credential boundaries, and native website behavior.

`npm run screenshots` reproduces the README examples using sample data and the actual extension. All extension colors live in `extension/colors.js`, including the light/dark palettes, accent tints, and toolbar states. After changing that palette or the mark in `extension/icons.js`, run `npm run assets` to regenerate the shared stylesheet, wordmark SVG, and toolbar PNGs, then reload the extension.

The app is in active development. Prefer hard cutovers over migrations and compatibility layers; see [AGENTS.md](AGENTS.md).
