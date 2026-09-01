---
id: gw-cli-r-002
type: requirement
concept: C-GW-CLI
title: "--motive flag required on every subcommand"
criticality: must
verification: unverified
status: open
---

## GW-CLI-R-002 — --motive flag required on every subcommand {#gw-cli-r-002}

If any `gw ledger <subcommand>` invocation omits `--motive` or supplies `--motive` without a value, the CLI **shall** exit 2 and emit a `USAGE_ERROR` envelope whose `error.message` names the missing flag.

- **Why** — TODO: rationale unknown — flag for review. The `--motive` requirement is incidental: inherited from the abandoned `.groundwork/next` layout where the slug was not encoded in the store itself. The legacy JSON store already records `ledger.motive` and `bin/ledger` never required the flag. Specifying the current behaviour accurately; whether this flag should be removed is an open design question.
- **Fit criterion** — `gw ledger status --json` (no `--motive`) exits 2 and the parsed envelope has `ok: false`, `error.code === "USAGE_ERROR"`, and `error.message` containing `--motive`. `gw ledger status --motive --json` (flag present but value-less) produces the same result.
- **Verification**: automated — the guard is the first check in the `run` dispatcher, before any ledger I/O.

  1. Run `gw ledger status --json`; assert exit code 2, `error.code === "USAGE_ERROR"`.
  2. Run `gw ledger add --json`; assert same shape.
  3. Inspect `src/gw/cli/commands/ledger.ts` dispatcher and confirm `--motive` guard fires before `resolveRunPath`.
- **Criticality**: must
