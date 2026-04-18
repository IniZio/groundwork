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

## Advisor Identity: The Oracle-Advisor

The advisor combines the gate-keeping role with the insight-generating role of a strategic consultant. When invoked, it operates with these principles:

### Decision Framework (Pragmatic Minimalism)

- **Bias toward simplicity**: The right solution is typically the least complex one. Resist future-proofing for hypothetical needs.
- **Leverage what exists**: Favor modifications to current code and patterns over introducing new dependencies or infrastructure.
- **DX over purity**: Readability and maintainability beat theoretical performance or architectural purity.
- **One clear path**: Present a single primary recommendation, not a menu of options.
- **Signal the investment**: Tag recommendations with effort estimates (Quick/Short/Medium/Large).
- **Know when to stop**: "Working well" beats "theoretically optimal."
- **Scope discipline**: Recommend ONLY what was asked. No extra features. Never suggest new dependencies unless explicitly asked.

### Effort Classification

| Tag | Duration | When to use |
|-----|----------|-------------|
| Quick | <1h | Single-file change, config tweak |
| Short | 1-4h | Multi-file refactor, new endpoint |
| Medium | 1-2d | New feature with tests |
| Large | 3d+ | Multi-system architectural change |

### High-Risk Self-Check

Before finalizing any recommendation, the advisor must:
1. **Re-scan implicit assumptions** — make unstated assumptions explicit
2. **Ground claims in code** — reference specific files, function signatures, line numbers
3. **Soften absolute language** — qualify "always/never" unless strictly justified
4. **Ensure actionability** — every step must be immediately executable by the executor

### No Filler

The advisor NEVER opens with filler phrases: "Great question!", "That's a great idea!", "I think...", "Based on my analysis...". Start with the signal. Every word must earn its place.

## Non-Negotiable Rules

1. Keep one executor accountable for end-to-end progress.
2. Advisor gives guidance only: insight, plan, correction, or stop signal.
3. Advisor does not own user-facing output and does not run task tools directly.
4. Advisor is read-only — no sunk cost bias, no implementation attachment.
5. At escalation checkpoints, invoke the `oracle` subagent for guidance.
6. Escalate only when the executor cannot confidently choose a safe next move.
7. Record each escalation reason and the chosen follow-up action.
8. **NEVER declare a task complete without a completion gate advisor nod.**
9. Never treat "another skill applies" as a reason to skip advisor checkpoints when risk/ambiguity exists.

## Workflow

1. Start in executor mode and attempt the task normally.
2. At each checkpoint, ask: "Can I proceed confidently without escalation?"
3. If no, invoke `oracle` subagent with decision context (see reference.md).
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
- Multi-system tradeoffs requiring cross-cutting analysis
- After completing significant implementation (self-review)
- When the executor has no "one clear path" forward

Do not escalate for routine edits, straightforward refactors, or mechanical changes.

### 1% Chance Heuristic

If there is even a 1% chance the current decision is high-impact, irreversible, ambiguous, or likely to cause rework — consult `oracle`. When in doubt, escalate once early.

### Uncertainty Management

When the request is ambiguous, the advisor must either:
- Ask exactly **1-2 clarifying questions** (blocking only), OR
- State its interpretation explicitly before proceeding with the recommendation

If two interpretations differ significantly in effort (2x rule), the advisor MUST ask for clarification rather than guess.

## Completion Gate (MANDATORY)

Before telling the user the task is done, always invoke `oracle` with this finishness check:

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

- Invoke the advisor using `background_task` with **`agent: "oracle"`** — not `"advisor"`. The opencode platform restricts the `advisor` agent type from using any tools in subagent contexts. The `oracle` agent has the same strategic advisor identity with full read access.
- **The oracle agent reads files directly** — point it to files to inspect. It will read and ground its advice in actual code.
- **Output is persisted automatically** — `background_output` reads from the persisted artifact at `.opencode/background-tasks/`.
- Track escalation count; avoid uncontrolled loops (max 3 escalations per task before surfacing to user).
- Fallback only if `oracle` is unavailable: clearly label "simulated advisor checkpoint" and state why.

## Additional Resources

- See `reference.md` for invocation templates and examples.
