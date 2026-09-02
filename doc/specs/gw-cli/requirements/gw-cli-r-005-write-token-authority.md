---
id: gw-cli-r-005
type: requirement
concept: C-GW-CLI
title: "Write-token authority on mutating subcommands"
criticality: must
verification: unverified
status: open
---

## GW-CLI-R-005 — Write-token authority on mutating subcommands {#gw-cli-r-005}

If any of the write-mutating subcommands (`set`, `complete`, `gate`, `abandon`, `await-human`, `autopilot`, `scope-token`, `milestone-signoff`) is invoked without `--token <value>` that matches the ledger's `write_token`, the CLI **shall** exit with an `AUTH_ERROR` envelope at exit code 1; the `complete` subcommand additionally **shall** accept a scoped token that owns all targeted slice IDs as an alternative to the master write token.

- **Why** — Without token enforcement, any process with filesystem access can record an advisor `APPROVE` verdict or mark slices complete, bypassing the orchestrator authority model. The stop-gate reads `gate.advisor` from the same ledger file; a write by an unauthorised caller would cause the gate to pass vacuously.
- **Fit criterion** — Given a ledger with a known `write_token`, running `gw ledger gate --motive m advisor APPROVE --token wrongtoken --json` exits 1 with `error.code === "AUTH_ERROR"`. Running the same command with the correct token exits 0.
- **Verification**: unverified — candidate: `assertWriteToken` is called at the top of every mutating subcommand branch.

  1. Create a throwaway ledger with a known `write_token`. Run `gw ledger abandon --motive m --token WRONG --json`; assert `exit === 1` and `error.code === "AUTH_ERROR"`.
  2. Repeat with `--token <correct_token>`; assert `exit === 0`.
  3. Confirm `rm` is read-only or mutating by inspecting its source branch for `assertWriteToken`; update this requirement if the source diverges.
- **Criticality**: must
