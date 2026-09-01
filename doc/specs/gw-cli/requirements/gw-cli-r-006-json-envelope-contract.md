---
id: gw-cli-r-006
type: requirement
concept: C-GW-CLI
title: "--json envelope shape and stdout contract"
criticality: should
verification: unverified
status: open
---

## GW-CLI-R-006 — --json envelope shape and stdout contract {#gw-cli-r-006}

**When** `--json` is passed as an argument to `gw ledger`, the command **shall** write exactly one JSON-encoded line to stdout encoding the `GwEnvelope` type — `{"ok":true,"command":"…","data":…,"exit":0}` on success or `{"ok":false,"command":"…","error":{"code":"…","message":"…"},"exit":1|2}` on failure — and **shall** exit with the numeric value of the envelope's `exit` field.

- **Why** — Without a stable machine-parseable envelope, tooling and tests cannot reliably extract error codes or distinguish operational failures (exit 1) from usage errors (exit 2); both are non-zero but require different handling.
- **Fit criterion** — `gw ledger status --motive m --json` (against a missing ledger) produces a single parseable JSON line with `ok: false`, an `error.code` string, and `exit: 1`. `gw ledger status --motive m --json` (against a valid ledger) produces a single parseable JSON line with `ok: true` and `exit: 0`. In both cases `JSON.parse(stdout)` succeeds without error.
- **Verification**: automated — the envelope is serialised in `src/gw/cli/main.ts` for every command.

  1. Run `gw ledger status --motive m --json` against a non-existent run store; capture stdout; assert `JSON.parse(stdout)` succeeds; assert parsed `ok === false` and `exit === 1`.
  2. Run `gw ledger status --motive nosubcmd_test --json` (wrong subcmd spelling as a control); assert exit 2 and `error.code === "UNKNOWN_SUBCOMMAND"`.
  3. Confirm no extra lines are written to stdout (envelope is exactly one line).
- **Criticality**: should
