---
name: 0xtagger
description: Look up and maintain Ethereum address labels in a configured 0xtagger book, adding established names or applying user-requested corrections.
---

# 0xtagger

Use the configured API-backed CLI; credentials resolve internally. Never use the browser, inspect/pass tokens, construct ad-hoc API requests, or start `serve` for lookups. Labels are personal notes, not identity proof. Disclose only needed addresses and labels.

## Look up

Pass full addresses; use `--chain ID` for one network, `--find TEXT` to search tags, and `--json` for structured output.

```sh
0xtagger lookup ADDRESS --chain 1 --json
0xtagger lookup --find TEXT
```

First tag is preferred; others are aliases. Source means origin, not verification. Lookup exits: `0` includes absent addresses; `2` means unavailable, never untagged. Credential retry is internal; do not try another route.

## Write names

`add` creates records or appends aliases, keeping the preferred name. Add user-requested names or durable, useful names and aliases established by investigation. Skip guesses; write nothing if none qualify.

For user-requested corrections, `rename` replaces the primary name, preserving other aliases and source. Existing aliases promote without duplication. The record must exist in the exact scope.

```sh
0xtagger add 'ADDRESS=Established name'
0xtagger rename 'ADDRESS=Corrected name' 'OTHER_ADDRESS=Another name' --json
```

Both accept batches and `--file PATH` (`ADDRESS=Name` per line); rename takes one name/address. Concurrent edits reject the whole rename batch: look up and review before retrying.

Default to all networks: omit scope flags, or use `--global`. Use `--chain ID` when the user requests a network-specific label. For corrections, look up the existing record and pass its chain when it is scoped to one network. Writes affect exactly that scope; existing overrides remain.

Write exits: `1` means invalid input, missing rename targets, or configuration; `2` means failure or conflict; `3` from `add` names capacity omissions, not an outage. Unconfirmed writes may have landed: never retry blindly. Report only confirmed results or known omissions.
