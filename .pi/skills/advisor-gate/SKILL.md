---
name: advisor-gate
description: Executor-first workflow with advisor checkpoints at hard decisions AND mandatory gate approval before declaring any task complete. The advisor operates as a strategic technical consultant — providing deep architectural insight, trade-off analysis, and effort-aware recommendations — not just a yes/no gate. ALWAYS required before claiming done.
---

# Advisor Gate

If you think there is even a 1% chance this skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF THE SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

## Purpose

Executor-first loop with two gate types:
1. **Decision gates** — escalate hard decisions mid-task to advisor for strategic insight
2. **Completion gate** — advisor must nod before any task is declared done

The advisor is a **read-only strategic consultant**. It provides deep technical analysis with pragmatic minimalism — not just approval/denial. It is invoked when the executor hits complexity ceilings that require elevated reasoning.

## Advisor Identity

The advisor agent (`agents/advisor.md`) is a **read-only strategic consultant** with pragmatic minimalism principles. It operates with bias toward simplicity, leverages existing code, prioritizes DX, presents one clear path, tags effort estimates, and practices strict scope discipline. See the agent definition for the full identity.

**Key principle:** The advisor NEVER uses `task` tool. It is read-only. It gives guidance — the executor implements.

## Decision Escalation Checkpoints

Escalate when any of these are true:

- Architecture trade-off with high downstream cost
- Repeated failure after two materially different attempts
- Ambiguous requirements with multiple plausible interpretations
- Security, data-loss, migration, or destructive-operation risk
- Performance bottleneck where root cause is uncertain
- Multi-system tradeoffs requiring cross-cutting analysis
- After completing significant implementation (self-review)
- When the executor has no "one clear path" forward

Do not escalate for routine edits, straightforward refactors, or mechanical changes.

### Uncertainty Management

When the request is ambiguous, the advisor must either:
- Ask exactly **1-2 clarifying questions** (blocking only), OR
- State its interpretation explicitly before proceeding with the recommendation

If two interpretations differ significantly in effort (2x rule), the advisor MUST ask for clarification rather than guess.

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
- **CORRECTION** — approach is flawed; specific fix needed
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

## Response Format

All advisor responses use a tiered structure to maximize signal density:

### Essential Tier (always present)

```
Type: PLAN | CORRECTION | STOP | APPROVE | GAPS
Decision: <single clear recommendation, 2-3 sentences max>
Rationale: <why — brief, anchored to specific code/requirements>
Actions:
1. <step one>
2. <step two>
Risks to watch:
- <risk>
Effort: Quick | Short | Medium | Large
```

### Expanded Tier (when complexity warrants)

```
Why this approach:
- <trade-off analysis, max 4 bullets>
Escalation triggers:
- <conditions that would justify a more complex solution>
Alternative sketch:
- <high-level outline of a different path, if warranted>
```

### Anchoring Requirements

The advisor MUST anchor claims to specific artifacts:
- Reference file paths and line numbers (e.g., "In `auth.ts:42`...")
- Quote function signatures or configuration values
- Cite specific PRD requirements by section
- Never make vague claims like "the codebase uses..." without pointing to evidence

## Implementation Notes

- Invoke the advisor using the builtin `task` tool with `agent: "advisor"`. The advisor agent has full read access and strategic analysis capabilities. You MUST use exactly `agent: "advisor"`.
  - **The advisor agent reads files directly** — point it to files to inspect. It will read and ground its advice in actual code.
- **The `task` tool blocks until the advisor responds, returning the result directly.**
- **Advisor is READ-ONLY. The advisor MUST NOT call `task`, `delegate`, or any other subagent tools.** The advisor provides strategic guidance only; it does not execute work or delegate to other agents.
- **Output is persisted automatically** — the task result is returned directly.
- Track escalation count; avoid uncontrolled loops (max 3 escalations per task before surfacing to user).
- Fallback only if `advisor` is unavailable: clearly label "simulated advisor checkpoint" and state why.

## Additional Resources

- See `reference.md` for invocation templates and examples.
