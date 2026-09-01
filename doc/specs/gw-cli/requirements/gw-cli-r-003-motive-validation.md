---
id: gw-cli-r-003
type: requirement
concept: C-GW-CLI
title: "Motive slug validation against ledger"
criticality: must
verification: unverified
status: open
---

## GW-CLI-R-003 — Motive slug validation against ledger {#gw-cli-r-003}

If `--motive <slug>` is supplied and the loaded ledger's `motive` field is set and differs from `<slug>`, `gw ledger` **shall** exit 1 and emit a `MOTIVE_MISMATCH` error envelope.

- **Why** — Without cross-checking the flag against the stored motive, a caller passing the wrong slug could silently read or mutate a different session's ledger. The `MOTIVE_MISMATCH` error makes the mismatch visible rather than silently operating on the wrong run.
- **Fit criterion** — Given a ledger file with `"motive": "alpha"`, running `gw ledger status --motive beta --json` against that file exits 1 and produces `error.code === "MOTIVE_MISMATCH"`. Running `gw ledger status --motive alpha --json` against the same file does not produce `MOTIVE_MISMATCH`.
- **Verification**: automated — the motive check is a conditional in `status` (and only `status`) as implemented.

  1. Copy a real ledger JSON to a temp file, set `"motive": "alpha"` in it, run `gw ledger status --motive beta --json` pointed at that session; assert `exit === 1` and `error.code === "MOTIVE_MISMATCH"`.
  2. Run same command with `--motive alpha`; assert no `MOTIVE_MISMATCH`.
  3. Inspect source: confirm the motive check is skipped when `ledger.motive` is falsy (missing or empty string).
- **Criticality**: must
