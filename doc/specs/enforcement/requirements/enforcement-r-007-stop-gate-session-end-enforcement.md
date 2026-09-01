---
id: enforcement-r-007
type: requirement
concept: C-ENFORCEMENT
title: Stop-gate blocks session end when run is incomplete or gate is unsealed
status: implemented
verification: unverified
criticality: must
design: "[[design/flows/stop-gate-decision-path]]"
---

## ENFORCEMENT-R-007 — Stop-gate blocks session end when run is incomplete or gate is unsealed {#enforcement-r-007}

If the Stop event fires and an active run ledger (`active:true`) exists with incomplete slices or with `gate.advisor` not equal to `APPROVE`, then the enforcement hook **shall** block session end and emit the outstanding slice list, the current gate state, and completion instructions; if all slices are complete and `gate.advisor` equals `APPROVE`, then the hook **shall** verify the ledger seal before releasing — if seal verification fails, it **shall** block with a seal-invalid message instructing the caller to re-run `bin/ledger gate advisor APPROVE`; the hook is read-only with respect to the ledger and **shall not** write ledger state directly.

- **Why** — Without the stop-gate, an orchestrator can end its session before delegated slices are verified or before the advisor has reviewed the output, leaving the run in a permanently ambiguous state with no recovery path. The seal check closes the path where a subagent writes `gate.advisor=APPROVE` directly without the write token (bypassing `ledger-bash-guard` via an undetected pattern): the seal is computed over the canonical ledger state using a key that only the CLI's gate path writes, so a directly-written APPROVE without a matching seal is detectable. Pacing (wave-budget policy), plan-ref validation, and consecutive-no-progress reinforcement are layered on top of the same Stop event; this requirement covers only the primary slice-complete + advisor-APPROVE gate.
- **Fit criterion** — Running the hook with an active ledger JSON passed via `CLAUDE_PROJECT_DIR` that has one incomplete slice and no `gate.advisor` produces a block response containing "GROUNDWORK STOP-GATE" and the incomplete slice id. Running with all slices complete and `gate.advisor:"APPROVE"` but a tampered or missing seal produces a block with "Seal verification failed". An abandoned ledger (`active:false`) produces an allow (exit 0, no block).
- **Verification**: unverified — the hook is tested in `test/hooks/stop-gate.test.ts`.
- **Criticality**: must
