---
name: advisor-gate
description: Executor-first workflow with advisor checkpoints at hard decisions AND mandatory gate approval before declaring any task complete. Use when architecture trade-offs, ambiguity, high-risk operations, or potential rework are present. ALWAYS required before claiming done.
---

# Advisor Gate

If you think there is even a 1% chance this skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

## Purpose

Executor-first loop with two gate types:
1. **Decision gates** — escalate hard decisions mid-task to advisor
2. **Completion gate** — advisor must nod before any task is declared done

## Non-Negotiable Rules

1. Keep one executor accountable for end-to-end progress.
2. Advisor gives guidance only: plan, correction, or stop signal.
3. Advisor does not own user-facing output and does not run task tools directly.
4. At escalation checkpoints, invoke the `advisor` subagent for guidance.
5. Escalate only when the executor cannot confidently choose a safe next move.
6. Record each escalation reason and the chosen follow-up action.
7. **NEVER declare a task complete without a completion gate advisor nod.**
8. Never treat "another skill applies" as a reason to skip advisor checkpoints when risk/ambiguity exists.

## Workflow

1. Start in executor mode and attempt the task normally.
2. At each checkpoint, ask: "Can I proceed confidently without escalation?"
3. If no, invoke `advisor` subagent with decision context (see reference.md).
4. Accept advisor response: Plan / Correction / Stop.
5. Resume executor mode, implement, and verify outcomes.
6. **Before claiming done: invoke completion gate (see below).**
7. Only after advisor nod: declare task complete to user.

## Decision Escalation Checkpoints

Escalate when any of these are true:

- Architecture trade-off with high downstream cost
- Repeated failure after two materially different attempts
- Ambiguous requirements with multiple plausible interpretations
- Security, data-loss, migration, or destructive-operation risk
- Performance bottleneck where root cause is uncertain

Do not escalate for routine edits, straightforward refactors, or mechanical changes.

### 1% Chance Heuristic

If there is even a 1% chance the current decision is high-impact, irreversible, ambiguous, or likely to cause rework — consult `advisor`. When in doubt, escalate once early.

## Completion Gate (MANDATORY)

Before telling the user the task is done, always invoke `advisor` with this finishness check:

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
- **GAPS** — list of unmet requirements; executor resumes
- **STOP** — blocker that needs user decision; surface it

**Do not skip the completion gate even if you are confident.** Confidence without verification is an anti-pattern.

## Verification Pushback Rules

When the executor skips or waives any verification step, the advisor MUST challenge the justification before approving. The advisor's default stance when verification was skipped is **GAPS** or **CORRECTION**, not APPROVE.

### What counts as a waived verification

- Skipping e2e or integration tests
- Not running the test suite at all
- Claiming a test "cannot be run" or "fixture not ready"
- Claiming a server or service "isn't up" and therefore cannot be tested against
- Marking a requirement as met without running the relevant verification command
- Substituting manual reasoning ("looks correct") for actual execution

### How the advisor must respond

1. **Default to CORRECTION** when any verification step was waived without a demonstrated attempt to resolve the blocker. Use GAPS only when the executor addressed all verification but missed a requirement.
2. **Require investigation before acceptance.** If the executor says "fixture not ready", the advisor should direct them to investigate how to set up the fixture — not waive the test.
3. **Require concrete evidence of effort.** "Tried X and it failed with error Y" is acceptable with a suggested alternative. "Couldn't do X" with no detail is not.
4. **Suggest specific alternatives.** The advisor should research and propose concrete next steps: how to start the server, how to prepare the fixture, how to set up the test environment, which commands to run.

### The only acceptable reason to waive verification

A verification step may only be waived if:
- The executor demonstrates they attempted at least one concrete approach to enable it, AND
- The advisor can confirm the blocker is genuinely outside the executor's control (e.g., external service down, missing credentials the user must provide), AND
- The advisor explicitly documents the gap and flags it to the user as part of the APPROVE.

Otherwise, the advisor must push back.

## Response Contract

Structure responses in this order:
1. Objective and current state
2. 1-2 key clarifying questions (only if blocking)
3. Options with trade-offs
4. Recommendation
5. Next action

Keep responses concise and actionable.

## Implementation Notes

- Invoke `advisor` subagent using `background_task` tool with agent `"advisor"`.
- Track escalation count; avoid uncontrolled loops (max 3 escalations per task before surfacing to user).
- Fallback only if `advisor` is unavailable: clearly label "simulated advisor checkpoint" and state why.

## Additional Resources

- See `reference.md` for invocation templates and examples.
