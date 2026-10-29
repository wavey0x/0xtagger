<h1 align="center">0xtagger</h1>
<p align="center"><strong>Your tags belong to you.</strong><br>A private, agent-friendly address book for Ethereum addresses, kept in your browser or on a server you control.</p>
<p align="center"><a href="#get-started">Get started</a> · <a href="INSTALL.md">Setup guide</a> · <a href="LICENSE">MIT</a></p>

![Adding address tags on Etherscan, revealing the original addresses, and choosing a preferred tag](docs/images/demo.gif)

Carry your own address labels across Etherscan, Safe, and other enabled sites. No 0xtagger account or analytics.

### What it includes

- **Browser extension and site adapters.** Tag addresses in place. Etherscan and Safe have dedicated adapters; other enabled sites can recognize full addresses. A book stored in the browser works without a server.
- **Optional self-hosted server.** Keep a separate SQLite book available across devices through an API and a browser address-book view.
- **Optional descriptions.** Keep useful wallet context in the address-book editor, with a 1,024-character limit. Descriptions stay out of website annotations and are preserved when names change.
- **CLI.** `0xtagger serve` runs the server; `lookup`, `add`, `rename`, and `describe` work with a configured server book through its API, with JSON output for agents and scripts.
- **Agent skill.** The [0xtagger skill](skills/0xtagger/SKILL.md) guides lookups, additions, and requested name corrections, including network scope and failure handling. For Codex, copy its folder into `~/.codex/skills/` to use it.

Adopt existing Etherscan and Safe labels as you tag, or import Safe's saved address book after review.

### Privacy

**Full custody.** You choose where each book lives, can export its records, and can run the server yourself. A browser book stays on your device unless you explicitly copy or import it into a server book. **Websites can read tags displayed on their pages.**

Safe's stored address book is read only when you request an import; you review names before saving.

### Get started

```sh
git clone https://github.com/wavey0x/0xtagger.git
```

1. Open `brave://extensions` or `chrome://extensions`, enable **Developer mode**, and **Load unpacked** → this project's `extension` folder.
2. Enable the website in the popup. Click the purple tag glyph beside an address, or use the popup's search field to find and tag any full `0x` address.

#### Sharing a book between devices

Run a server, with Python 3.10+ and [uv](https://docs.astral.sh/uv/getting-started/installation/):

```sh
uv run 0xtagger serve
```

Open the address book menu → **Connect to a server**, then paste the link the server prints.

For a private browser view of that same book, [serve it through Tailscale](INSTALL.md#browse-privately-through-tailscale).
Your Tailscale identity opens it directly, with no key in the bookmark.

![The compact translucent editor adding a tag directly to a transfer list](docs/images/editor.png)

<sub>Editor screenshot uses sample data.</sub>

Early development; installed as an unpacked extension. See the [setup guide](INSTALL.md) for remote hosting, backups, updates, and development checks.
