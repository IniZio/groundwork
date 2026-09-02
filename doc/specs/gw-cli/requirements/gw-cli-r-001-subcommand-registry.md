---
id: gw-cli-r-001
type: requirement
concept: C-GW-CLI
title: "Subcommand registry — 16 subcommands, no init"
criticality: must
verification: unverified
status: open
---

## GW-CLI-R-001 — Subcommand registry — 16 subcommands, no init {#gw-cli-r-001}

The `gw ledger` command **shall** accept exactly the following 16 subcommands: `status`, `add`, `set`, `complete`, `rm`, `show`, `view`, `gate`, `abandon`, `fog`, `frontier`, `claim`, `await-human`, `autopilot`, `scope-token`, and `milestone-signoff`; it **shall not** accept `init`; and **when** an unknown subcommand is supplied, `gw ledger` **shall** exit 2 with an `UNKNOWN_SUBCOMMAND` error.

- **Why** — `init` is absent because `gw ledger` targets the already-initialised legacy run store; invoking a non-existent subcommand silently succeeding would make scripted callers unable to detect typos in subcommand names at call time.
- **Fit criterion** — `gw ledger init --motive foo` exits 2 and emits `UNKNOWN_SUBCOMMAND` (verify with `--json`). `gw ledger status --motive <valid>` exits without `UNKNOWN_SUBCOMMAND`. Each of the 16 listed names is accepted (no `UNKNOWN_SUBCOMMAND` when run with a valid ledger).
- **Verification**: unverified — candidate: the subcommand registry is an enumerated constant in source.

  1. Run `gw ledger init --motive test --json`; assert `ok: false`, `error.code === "UNKNOWN_SUBCOMMAND"`, `exit === 2`.
  2. Run `gw ledger status --motive test --json` against a valid ledger; assert `error.code` is not `"UNKNOWN_SUBCOMMAND"`.
  3. Inspect `LEDGER_SUBCOMMANDS` in `src/gw/cli/commands/ledger.ts` and confirm `"init"` is absent and the array has exactly 16 members.
- **Criticality**: must
