---
id: "artifact-glossary"
title: "Artifact Model — Glossary"
tags: [glossary, artifact]
---

# Artifact Model — Glossary

| Term | Definition |
|---|---|
| **Artifact** | Any file-backed groundwork record that persists across sessions: run ledgers, journal events, spec requirements, and tickets. |
| **Run ledger** | A JSON file at `.groundwork/runs/<session_id>.json` that tracks the slices and gate verdict for one orchestration session. |
| **Slice** | The atomic scheduling unit inside a run ledger. A slice has an id, kind, status, and optional links to tickets and decisions. |
| **Gate** | The advisor-verdict record inside a run ledger (`gate.advisor`). The Stop hook reads this to decide whether to allow session end. |
| **Write token** | An opaque string printed at ledger init and required by the `ledger complete` and `ledger gate` commands. Never passed to subagents. |
| **Session journal** | An append-only JSONL event log at `.groundwork/journal/<session_id>.jsonl`. Written by `hooks/journal.mjs`. |
| **DECISION event** | A journal event of type `DECISION`, requiring `data.id`, `data.decision`, and `data.rationale`. The primary mechanism for recording architectural choices. |
| **Spec tree** | The `doc/specs/` directory tree of committed EARS-pattern requirements, organised by concept. |
| **Ticket** | A durable markdown work object with canonical sections (Question, Context, Evidence, Decision, Ruled out, Revisions, Links), stored at `.groundwork/motives/<slug>/tickets/` or a committed `tickets_dir`. |
| **Motive** | A named goal tracked under `.groundwork/motives/<slug>/`, containing a charter, MAP.md, tickets, and journal events. |
| **MAP.md** | The auto-generated map-of-content file for a motive, regenerated from the ticket corpus with ledger status overlay. |
| **`completed_at`** | ISO-8601 timestamp set by `ledger complete` on a slice; required by the Stop hook (ARTIFACT-R-001). |
| **No-delete invariant** | The rule that no groundwork code path removes a markdown file it did not itself generate; hand-authored files are always preserved (ARTIFACT-R-008). |
| **`revises`** | A `data.revises` field on a DECISION event that marks an intentional same-id refinement, suppressing the `unmarked_collision` flag (ARTIFACT-R-011). |
| **`unmarked_collision`** | A flag set by `journal compile` on merged DECISION entries where no contributing event carries `data.revises`; indicates a likely duplicate id (ARTIFACT-R-011). |
| **`tickets_dir`** | Optional motive-charter field that overrides the default ticket directory, enabling committed (version-controlled) ticket corpora (ARTIFACT-R-009). |
| **EARS pattern** | Easy Approach to Requirements Syntax; the structured sentence form (WHEN/IF-THEN/WHERE/etc.) used for all spec requirements. |
| **Pacing budget** | The one-impl-wave-per-session constraint; `impl` and `design` slice kinds consume it; `plan`, `diagnose`, and `fog` kinds are exempt. |
| **Seal** | An HMAC-SHA256 tamper-evident check on the gate-release state, computed by `hooks/lib/gate-seal.mjs` and stored as `gate.seal` in the ledger. |
