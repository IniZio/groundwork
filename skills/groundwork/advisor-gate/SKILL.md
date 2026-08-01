---
name: advisor-gate
description: ORCHESTRATOR-ONLY skill. Executor/subagent agents MUST NOT invoke this. Advisor completion gate: mandatory APPROVE/REVISE/REJECT verdict before the orchestrator declares any task complete, plus decision-gate escalation for hard architectural trade-offs.
disable-model-invocation: true
---

# Advisor Gate

## Platform contract

Advisor review is a workflow checkpoint. Use a documented native advisor or
subagent interface when the host provides one. In Codex, do not assume an
advisor agent, `task` tool, ledger CLI, or Stop-gate; perform a clearly labeled
manual self-review and report it as advisory.

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
Per-acceptance-criterion verification: for each AC, cite the scenario/test that exercised it (or mark uncovered)
Plan soundness: are the slices still the right decomposition? State gap-types (missing|partial|contradicts|unrequested) if any.
Anything uncertain or skipped: <list or "none">
Question: Is this complete and correct?
```

Advisor returns one of:
- **APPROVE** — executor may declare done to user
- **GAPS** — unmet requirements; executor resumes
- **CORRECTION** — approach is flawed; specific fix needed
- **STOP** — blocker that needs user decision; surface it
- **REPLAN** — slices/plan unsound; re-enter interview or vertical-slice (non-terminal; do not resume impl)

**Do not skip the completion gate even if you are confident.**

## Risk-Tiered Completion Flow

| Tier | Condition | Flow |
|------|-----------|------|
| **Trivial** | ≤2 files, ≤1 user-facing behavior, <1h, AND small verification surface (no real hardware, single platform, single-service or no live environment, ≤5 QA scenarios) | advisor directly |
| **Small** | Localized, clear, low blast radius | `advisor` |
| **Feature / non-trivial** | ≥3 files OR ≥2 behaviors OR shared code OR large verification surface (requires real hardware or physical devices; requires a multi-service or otherwise non-trivial live environment; involves >5 distinct QA scenarios; or spans ≥2 platforms or clients) | `[qa if interactive UI] → advisor` |

## Recording the Verdict in the Run Ledger

If a host-provided run ledger exists, record the gate result through its
documented interface. In Codex, record the verdict in the plan or handoff
artifact; it does not mechanically release or block session termination:

```text
advisor: APPROVE | REVISE | REJECT | REPLAN
rubric: groundwork-completion-v2
citation: <verification evidence>
```

Verdict mapping for the ledger:

- **APPROVE** → `verdict: "APPROVE"` — session may end
- **GAPS / CORRECTION** → `verdict: "REVISE"` with failing axes + citation; gate stays closed
- **STOP** → `verdict: "REJECT"` with citation; surface blocker to user; gate stays closed. If this is a durable out-of-scope decision, write `.groundwork/out-of-scope/<concept-slug>.md`.
- **REPLAN** → `verdict: "REPLAN"` (non-terminal; stop-gate routes orchestrator to interview/vertical-slice)

The advisor is read-only and never edits the ledger — the orchestrator records the verdict after receiving it.

## Implementation Notes

- Invoke the host's documented advisor/delegation interface when available.
  Otherwise perform a manual, clearly labeled advisor checkpoint.
- Track escalation count; avoid uncontrolled loops (max 3 escalations per task before surfacing to user).
- Fallback only if `advisor` is unavailable: label "simulated advisor checkpoint" and state why.
- Run the gate deterministically: fixed model at `temperature: 0` with the rubric id recorded in the verdict.
