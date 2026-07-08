---
name: advisor-gate
description: Executor-first workflow with advisor checkpoints at hard decisions AND mandatory gate approval before declaring any task complete. The advisor operates as a strategic technical consultant — providing deep architectural insight, trade-off analysis, and effort-aware recommendations — not just a yes/no gate. ALWAYS required before claiming done.
---

# Advisor Gate

If you think there is even a 1% chance this skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF THE SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

> **ORCHESTRATOR-ONLY.** Executor agents (general-purpose) must never load this skill, invoke the advisor completion gate, or self-issue verdicts. Completion gating is the orchestrator's responsibility.

## Purpose

Executor-first loop with two gate types:
1. **Decision gates** — escalate hard decisions mid-task to advisor for strategic insight
2. **Completion gate** — advisor must APPROVE before any task is declared done

## When to Escalate (Decision Gate)

Escalate when any of these are true:
- Architecture trade-off with high downstream cost
- Repeated failure after two materially different attempts
- Ambiguous requirements with multiple plausible interpretations
- Security, data-loss, migration, or destructive-operation risk
- After completing significant implementation (self-review)
- When the executor has no "one clear path" forward

Do not escalate for routine edits, straightforward refactors, or mechanical changes.

## Completion Gate (MANDATORY)

Before telling the user the task is done, invoke `advisor` with:

```
## Completion Gate Request
Task: <what was asked>
What was done: <summary of changes>
Verification run: <commands run and their output>
Requirements from spec/PRD: <list each requirement>
Each requirement met: <yes/no per item>
Anything uncertain or skipped: <list or "none">
Question: Is this complete and correct?
```

Advisor returns one of:
- **APPROVE** — executor may declare done to user
- **GAPS** — unmet requirements; executor resumes
- **CORRECTION** — approach is flawed; specific fix needed
- **STOP** — blocker that needs user decision; surface it

**Do not skip the completion gate even if you are confident.**

## Risk-Tiered Completion Flow

| Tier | Condition | Flow |
|------|-----------|------|
| **Trivial** | ≤2 files, ≤1 user-facing behavior, <1h | advisor directly |
| **Small** | Localized, clear, low blast radius | `advisor` |
| **Feature / non-trivial** | ≥3 files OR ≥2 behaviors OR shared code | `[qa if interactive UI] → advisor` |

## Recording the Verdict in the Run Ledger

If a run ledger exists (`.groundwork/run.json`), record the gate result via the `ledger` CLI so the Stop-gate hook releases the session:

```bash
${CLAUDE_PLUGIN_ROOT}/hooks/ledger.mjs gate advisor APPROVE \
  --rubric groundwork-completion-v1 --citation none \
  --axes-correctness 3 --axes-completeness 3 --axes-over_engineering 0
```

Verdict mapping for the ledger:
- **APPROVE** → `verdict: "APPROVE"` — session may end
- **GAPS / CORRECTION** → `verdict: "REVISE"` with failing axes + citation; gate stays closed
- **STOP** → `verdict: "REJECT"` with citation; surface blocker to user; gate stays closed. If this is a durable out-of-scope decision, write `.groundwork/out-of-scope/<concept-slug>.md`.

The advisor is read-only and never edits the ledger — the orchestrator records the verdict after receiving it.

## Implementation Notes

- Invoke via `task(subagent_type="groundwork:advisor", ...)`. The advisor reads files directly — point it to relevant files.
- Track escalation count; avoid uncontrolled loops (max 3 escalations per task before surfacing to user).
- Fallback only if `advisor` is unavailable: label "simulated advisor checkpoint" and state why.
- Run the gate deterministically: fixed model at `temperature: 0` with the rubric id recorded in the verdict.
