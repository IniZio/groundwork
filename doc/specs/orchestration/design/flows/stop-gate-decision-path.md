---
tags: [flow, orchestration, stop-gate]
source: hooks/stop-gate.mjs
---

# Stop-Gate Decision Path

> **Flow note.** This traces the exact branching logic of `hooks/stop-gate.mjs`. For a conceptual overview, see [[../concepts/stop-gate]]. To close out a run, see [[../recipes/release-stop-gate-after-advisor-approve]].

---

## Decision flowchart

_Derived from `hooks/stop-gate.mjs`. Do not modify this diagram without re-reading that file._

```mermaid
flowchart TD
    START([Stop hook fires]) --> READ[Read ledger from stdin]
    READ -->|parse error / null| A1([ALLOW — no ledger])

    READ -->|ledger parsed| ACTIVE{active === true?}
    ACTIVE -->|false| SEAL1{seal valid?}
    SEAL1 -->|yes / legacy| A2([ALLOW — run abandoned])
    SEAL1 -->|no| B1([BLOCK — seal invalid on abandon path])

    ACTIVE -->|true| SESSID{session_id matches\ncurrent session?}
    SESSID -->|mismatch| A3([ALLOW — foreign session])

    SESSID -->|match| AWAIT{awaiting_human\n=== true?}
    AWAIT -->|true| SEAL2{seal valid?}
    SEAL2 -->|yes / legacy| A4([ALLOW — hold active])
    SEAL2 -->|no| B2([BLOCK — seal invalid on hold])

    AWAIT -->|false| INCOMPLETE[Compute incomplete slices\nstatus ∉ {complete, skipped}]
    INCOMPLETE --> ADVISOR{gate.advisor\n=== APPROVE?}

    ADVISOR --> WORK{incomplete.length > 0\nOR !advisorApproved?}
    WORK -->|no work remains| SEAL3{seal valid?}
    SEAL3 -->|yes / legacy| A5([ALLOW — emit SESSION_END\n+ advisories])
    SEAL3 -->|no| B3([BLOCK — seal invalid\non completion path])

    WORK -->|work remains| PACING{pacing\nexhausted?}
    PACING -->|yes| A6([ALLOW — emit DIRECTIVE\npacing handoff])

    PACING -->|no| YIELD{detectYield:\nbackground tasks\nor yield markers?}
    YIELD -->|yielding| A7([ALLOW — orchestrator\nawaiting completion])

    YIELD -->|stalled| RCAP{reinforcement\ncap exceeded?}
    RCAP -->|yes| A8([ALLOW — release\nstuck session])
    RCAP -->|no| B4([BLOCK — increment\nreinforcements])

    style A1 fill:#4a4,color:#fff
    style A2 fill:#4a4,color:#fff
    style A3 fill:#4a4,color:#fff
    style A4 fill:#4a4,color:#fff
    style A5 fill:#4a4,color:#fff
    style A6 fill:#c84,color:#fff
    style A7 fill:#4a4,color:#fff
    style A8 fill:#c84,color:#fff
    style B1 fill:#c44,color:#fff
    style B2 fill:#c44,color:#fff
    style B3 fill:#c44,color:#fff
    style B4 fill:#c44,color:#fff
```

---

## Step table

| Step | Actor | Decision / action | Source location |
|------|-------|-------------------|----------------|
| 1 | Hook | Read ledger JSON from stdin | `stop-gate.mjs` — top of main |
| 2 | Hook | Parse failure or null → **ALLOW** | FAIL-OPEN guarantee |
| 3 | Hook | `active === false` → check seal → **ALLOW** if valid | `verifySeal()` in `lib/gate-seal.mjs` |
| 4 | Hook | `session_id` mismatch → **ALLOW** | SESSION-SCOPED guarantee |
| 5 | Hook | `awaiting_human === true` → check seal → **ALLOW** if valid | `ledger await-human` sets this |
| 6 | Hook | Compute `incomplete` = slices where status ∉ {complete, skipped} | In-memory filter |
| 7 | Hook | `advisorVerdict(gate)` — extract APPROVE from string or object form | `advisorVerdict()` helper |
| 8 | Hook | `incomplete.length === 0 && advisorApproved` → check seal → **ALLOW** + emit `SESSION_END` | Completion path |
| 9 | Hook | `isExhausted(pacing)` → **ALLOW** + emit `DIRECTIVE` pacing handoff | `lib/pacing.mjs` |
| 10 | Hook | `detectYield()` — background task tokens or yield markers present → **ALLOW** | YIELD-AWARE guarantee |
| 11 | Hook | Reinforcement counter ≥ cap (12) → **ALLOW** (release stuck session) | BOUNDED guarantee |
| 12 | Hook | Otherwise → **BLOCK**, increment `reinforcements`, re-inject directive | Default block path |

---

## Notes on the reinforcement counter

The counter tracks **consecutive** no-progress blocks. It resets to 0 whenever:
- A slice changes status
- A gate verdict flips

This means a session that is genuinely making progress is never permanently stuck by the cap — only a truly stalled session gets released.

---

## Related notes

- [[../concepts/stop-gate]] — conceptual overview and guarantees
- [[../concepts/delegation-hierarchy]] — what produces the slices being checked
- [[../components/gate-note]] — the `gate` object anatomy
- [[../recipes/release-stop-gate-after-advisor-approve]] — how to clear the gate
