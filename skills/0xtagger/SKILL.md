---
name: 0xtagger
description: Look up and maintain Ethereum address labels in a configured 0xtagger book, adding established names or applying user-requested corrections.
---

# 0xtagger

Use the installed, configured, API-backed CLI for lookups and agent updates. Do not use the browser for this workflow. Labels are personal notes, not proof of identity.

## Look up

Pass full addresses and `--chain ID` when the question concerns one network. `--find TEXT` searches tags; `--json` gives structured output.

```sh
0xtagger lookup ADDRESS --chain 1 --json
0xtagger lookup --find TEXT
```

The first tag is the preferred name; later tags are aliases. A source names where a record began, not independent verification. Exit `0` includes absent addresses. Exit `2` means the book was unavailable: nothing was learned. Do not call an address untagged or retry by another route; the CLI handles credential retry.

## Add established names

Add names the user requests, or durable names and useful aliases established by an investigation. Skip guesses; make no write if none qualify. `add` creates missing records or appends aliases, preserving existing preferred names.

```sh
0xtagger add --chain 1 'ADDRESS=Established name'
```

## Correct a preferred name

For user-requested corrections, use `rename`, not `add`. It replaces the first tag and removes the old primary name, preserving other aliases and the original source. An existing alias can become the preferred name without duplication. Missing records must be added first.

```sh
0xtagger rename --global 'ADDRESS=Corrected name' 'OTHER_ADDRESS=Another name' --json
```

Both writes accept batches and `--file PATH` (`ADDRESS=Name` per line). Rename takes one name per address and uses version checks: a concurrent edit rejects the entire batch. Look up and review conflicts before trying again.

Choose `--chain ID` for network-specific roles and `--global` for identities established across chains or explicitly requested for all networks. Each command affects exactly that scope; existing network overrides remain. Do not infer a global identity just because the chain is unclear.

The CLI resolves the book and credentials internally; never inspect or pass a token or construct ad-hoc API requests. Exit `1` is invalid input, missing rename targets, or local configuration. Exit `2` is a read/write failure or conflict; an unconfirmed write may have landed, so do not retry blindly. Exit `3` from `add` reports tags omitted because a record is full, not an outage. Report only confirmed results or known omissions.

Do not start `0xtagger serve` merely for a lookup. Disclose only the addresses and labels needed for the task.
