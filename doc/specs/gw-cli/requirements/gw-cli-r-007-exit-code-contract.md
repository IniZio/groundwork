---
id: gw-cli-r-007
type: requirement
concept: C-GW-CLI
title: "Exit-code semantics: 0 / 1 / 2"
criticality: must
verification: unverified
status: open
---

## GW-CLI-R-007 — Exit-code semantics: 0 / 1 / 2 {#gw-cli-r-007}

The `gw ledger` command **shall** exit 0 on success, exit 1 on operational failure (ledger not found, auth error, motive mismatch, or an unexpected internal error), and exit 2 on usage error (unknown subcommand or missing required flag).

- **Why** — Shell callers and CI scripts distinguish failure modes by exit code; if `gw` used inconsistent or undocumented codes, a script catching exit 1 would silently swallow usage errors (exit 2), and a script checking `if [ $? -ne 0 ]` could not tell whether it supplied wrong arguments or the ledger was genuinely absent.
- **Fit criterion** — Three distinct observable outcomes: (a) `gw ledger status --motive m --json` against a valid ledger exits 0; (b) `gw ledger status --motive m --json` against a missing ledger exits 1 with `error.code === "NOT_FOUND"`; (c) `gw ledger badcmd --motive m --json` exits 2 with `error.code === "UNKNOWN_SUBCOMMAND"`.
- **Verification**: unverified — candidate: `process.exit(envelope.exit)` in `src/gw/cli/main.ts` propagates the envelope exit code unconditionally.

  1. Run `gw ledger status --motive m --json` with a valid ledger; `echo $?` → `0`.
  2. Run `gw ledger status --motive m --json` with no ledger on disk; `echo $?` → `1`.
  3. Run `gw ledger nosuchcmd --motive m --json`; `echo $?` → `2`.
  4. Run `gw ledger status --json` (no `--motive`); `echo $?` → `2`.
- **Criticality**: must
