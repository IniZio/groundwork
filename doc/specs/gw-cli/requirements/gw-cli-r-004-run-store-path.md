---
id: gw-cli-r-004
type: requirement
concept: C-GW-CLI
title: "Run-store path contract matches legacy hooks"
criticality: must
verification: unverified
status: open
---

## GW-CLI-R-004 — Run-store path contract matches legacy hooks {#gw-cli-r-004}

The `gw ledger` command **shall** resolve the active run store at `<project-dir>/.groundwork/runs/<session_id>.json` when `<session_id>` satisfies `[A-Za-z0-9_-]{1,128}`, and **shall** fall back to `<project-dir>/.groundwork/run.json` otherwise — the same path formula as `resolveLedgerPath` in `hooks/lib/ledger-io.mjs`. `<project-dir>` is `process.env.CLAUDE_PROJECT_DIR` when set, otherwise `process.cwd()`.

- **Why** — The legacy stop-gate hook reads only `hooks/lib/ledger-io.mjs:resolveLedgerPath`. If `gw ledger` resolves a different path, writes made via `gw` are invisible to the stop-gate: the gate sees a stale or absent ledger, the advisor verdict check passes vacuously, and the session closes with work unverified.
- **Fit criterion** — Two sub-criteria, both automated:

  1. **No-session failure (the defect detector):** invoke `gw ledger status --motive m` with `CLAUDE_CODE_SESSION_ID` absent from the environment (not set, not overridden). The CLI **must** exit non-zero and write a diagnostic naming `CLAUDE_CODE_SESSION_ID` to stderr. A silent exit-0 with resolution to any path (including `default.json`) is a failure. This test fails against the pre-fix behaviour and passes after — proving the bite.

  2. **Valid-session path resolution:** pre-seed `.groundwork/runs/testsession123.json` with `{"motive":"tm","slices":[],"active":true,"session_id":"testsession123"}` in a git-rooted tmpdir. Run `gw ledger status --motive tm` with `CLAUDE_CODE_SESSION_ID=testsession123` (the documented interface — no `--session` flag). Assert exit 0 and `ok: true`. This confirms the CLI honours the env-var authority when present.

- **Verification**: automated — see `test/gw/cli/commands.test.ts` → `GW-CLI-R-004`.
- **Criticality**: must
