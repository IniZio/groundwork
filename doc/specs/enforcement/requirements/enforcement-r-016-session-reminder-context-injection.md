---
id: enforcement-r-016
type: requirement
concept: C-ENFORCEMENT
title: Session-reminder injects ledger state and orchestrator rules at session start
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-016 — Session-reminder injects ledger state and orchestrator rules at session start {#enforcement-r-016}

If a SessionStart event fires (triggered by `startup`, `resume`, `clear`, or `compact`) and an active run ledger exists for the session, then the enforcement hook **shall** inject a structured context block into the session naming the outstanding slices, the stop-gate rules, the write token, and the fan-out constraints; if no active run ledger exists, the hook **shall** inject a minimal context block with session-level orientation only.

- **Why** — Claude Code does not persist conversation memory across sessions. An orchestrator that resumes a session without the ledger state has no knowledge of which slices are outstanding, what the write token is, or what the stop-gate will block. Without the session-reminder injection, every resumed session proceeds as if no run exists — the orchestrator re-plans from scratch, duplicates completed work, or ends the session without completing outstanding slices. This is the only mechanism that re-establishes run context at session start.
- **Fit criterion** — Starting a new session with an active ledger on disk produces a system-reminder block in the session that names at least one outstanding slice id and references the ledger write token. Starting a session with no active ledger produces a system-reminder block without ledger-specific fields (no slice ids, no write token).
- **Verification**: unverified — inject a representative active-ledger JSON into `CLAUDE_PROJECT_DIR`, start a session, and confirm the SessionStart injection names the outstanding slices. Automated coverage for specific injection content exists in `test/hooks/session-reminder.test.ts` if present.
- **Criticality**: must
