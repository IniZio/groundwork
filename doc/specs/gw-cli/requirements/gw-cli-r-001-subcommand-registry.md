---
id: gw-cli-r-001
type: requirement
concept: C-GW-CLI
title: "Subcommand registry — 19 subcommands, init guarded"
criticality: must
verification: automated
status: open
---

## GW-CLI-R-001 — Subcommand registry — 19 subcommands, init guarded {#gw-cli-r-001}

The `gw ledger` command **shall** accept exactly the following 19 subcommands: `init`, `status`, `add`, `set`, `complete`, `rm`, `show`, `view`, `gate`, `abandon`, `fog`, `frontier`, `claim`, `await-human`, `autopilot`, `checkpoint`, `hold`, `scope-token`, and `milestone-signoff`; and **when** an unknown subcommand is supplied, `gw ledger` **shall** exit 2 with an `UNKNOWN_SUBCOMMAND` error.

- **Why** — `init` is guarded: it requires a non-empty `--motive` slug and refuses to overwrite an existing active run without explicit confirmation. The unknown-subcommand guard remains: invoking a name not in the registry exits 2 with `UNKNOWN_SUBCOMMAND`, so scripted callers can detect typos at call time.
- **Fit criterion** — `gw ledger init --motive <slug>` is dispatched (does not exit with `UNKNOWN_SUBCOMMAND`). `gw ledger <truly-unknown>` exits 2 and emits `UNKNOWN_SUBCOMMAND`. `LEDGER_SUBCOMMANDS` in `src/gw/cli/commands/ledger.ts` contains exactly 19 entries matching the list above — verified by `test/gw-cli-r-001-subcommand-registry.test.ts`.
- **Verification**: automated — `test/gw-cli-r-001-subcommand-registry.test.ts` imports `LEDGER_SUBCOMMANDS` and asserts set-equality with the 19-name list above; fails if any name is added or removed without updating this spec.

  1. Run `npx vitest run test/gw-cli-r-001-subcommand-registry.test.ts`; all tests pass.
  2. Temporarily add a dummy entry to `LEDGER_SUBCOMMANDS`; confirm the test turns red.
- **Criticality**: must
