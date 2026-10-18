---
name: 0xtagger
description: Look up labels for Ethereum addresses in a configured 0xtagger book and record durable, evidence-backed names established by an investigation.
---

# 0xtagger

Use the installed, configured CLI to consult the book during Ethereum address investigations. Its labels are personal notes, not proof of identity.

## Look up

Pass full addresses and `--chain ID` when the question concerns one network. `--find TEXT` searches tags; `--json` gives structured output.

```sh
0xtagger lookup ADDRESS --chain 1 --json
0xtagger lookup --find TEXT
```

The first tag is the preferred name; later tags are aliases. A source names where a record began, not independent verification. Exit `0` includes absent addresses. Exit `2` means the book was unavailable: nothing was learned. Do not call an address untagged or retry by another route; the CLI handles credential retry.

## Add established names

Near the end of an investigation, add only durable names or useful aliases backed by its evidence. Skip guesses; make no write if none qualify. Use `--chain ID` for network-specific names and `--global` only for identities established across chains. Existing preferred names stay first.

```sh
0xtagger add --chain 1 'ADDRESS=Established name'
```

The CLI reads credentials internally; never inspect or pass a token or write through the API. Exit `2` can mean a write landed without confirmation, so do not retry blindly. Exit `3` reports tags omitted because a record is full, not an outage. Report only confirmed additions or known omissions.

Do not start `0xtagger serve` merely for a lookup. Disclose only the addresses and labels needed for the task.
