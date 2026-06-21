---
name: implement
description: Implementation orchestration skill. Decompose into vertical slices for maximum coder fan-out, then validate behavior (not code structure). MANDATORY after a plan or interview. Use vertical-slice skill for conflict-free slice planning and the .groundwork/run.json ledger.
---

# Implement

## Core Principle

**Decompose first, fan out maximally, validate behavior.**

Slice the work into independent end-to-end behaviors before launching any coders. Fan out all independent slices simultaneously — 5-15 parallel coders per wave is the target. Validate what the system *does* from the user's perspective, not how the code is structured.

## When to Use

**MANDATORY** in these cases:
- After a plan is approved — before any implementation begins
- After `interview` for small changes — interview spec is the spec
- Any feature that changes observable behavior
- Any task touching ≥3 files or ≥2 behaviors

**Do NOT use for:**
- **Bugs** — use `diagnose` instead. It owns the fix and regression test.
- **Trivial changes** (<1h, fully specified, ≤2 files) — delegate directly to coder, then `advisor-gate`.

## Two Modes

### Feature Mode (a plan exists)
A plan is whatever concrete spec the work is grounded in: an `interview` synthesis, a
`planner` plan under `.groundwork/plans/`, or the project's own planning artifact (see
`interview` for detecting project-level plan conventions). Decompose its acceptance
criteria into vertical slices — each criterion → one slice. Record the plan path as
`plan_ref` in the ledger.

### Small-Change Mode (after `interview`, no separate plan)
Lightweight decomposition into 3–5 vertical slices. The interview spec is the spec.

**Decision rule:** a plan/spec exists → Feature Mode. Otherwise → Small-Change Mode.

## Step 0: Banner

Emit the compliance banner as your first line: `GROUNDWORK ▸ ultrawork: <N> slices across <M> waves → .groundwork/run.json`. This is the observable signal the workflow is engaged.

## Step 1: Decompose with `vertical-slice`

Run `vertical-slice` to produce a conflict-free slice table with wave assignments before launching any coders. This is the most important step — skipping it causes sequential execution and merge conflicts. `vertical-slice` also writes the **`.groundwork/run.json` ledger** (all slices `pending`) — the artifact the Stop-gate hook enforces. The session will not be allowed to end until every slice is `complete` and the advisor gate approves.

**Minimum decomposition:**
- Feature: ≥5 slices (target 5-15 per wave)
- Small change: ≥3 slices
- If you can't reach 3 slices, the change is trivial — skip this skill

Each slice is a thin end-to-end tracer through ALL layers for ONE user-facing behavior:

```
Wave 0: tracer bullet — proves full path (data model → logic → surface → test)
Wave 1+: remaining independent slices, all launched in parallel
```

Present the slice plan to the user via `question` tool before executing.

## Step 2: Pin Session Goal

Set the first `todowrite` item to the feature goal from acceptance criteria. This stays at the top throughout. After each wave, verify remaining work still serves this goal.

## Step 3: Capture Before State

- **UI work:** screenshot + accessibility snapshot before any change → `before-<description>.png`
- **Non-UI work:** run existing integration/e2e tests; note what passes/fails
- **Skip if:** purely additive non-UI change with no existing tests — document why

## Step 4: Execute Waves

**Fan out ALL slices in a wave simultaneously in ONE message:**

```
# Wave 1: launch all independent slices at once
task(description="Slice 2: Complete + delete", prompt="...", subagent_type="coder")
task(description="Slice 3: Filter + clear", prompt="...", subagent_type="coder")
task(description="Slice 4: Edit item", prompt="...", subagent_type="coder")
task(description="Slice 5: Persist state", prompt="...", subagent_type="coder")
# Never: task → wait → task → wait (sequential = wasted time)
```

Each coder prompt must be **fully self-contained**: file paths, requirements, acceptance criteria, context. Coders have no shared state.

Wait for wave completion, verify, then launch the next wave. Update `todowrite` after each wave **and set each verified slice's `status` to `complete` in `.groundwork/run.json`** (Edit the file). The Stop-gate hook reads this on every stop attempt — slices left `pending` will block the session from ending.

**Fan-out targets:**
- Feature (PRD): 5-15 parallel slices per wave
- Small change: 3-5 parallel slices
- Single-slice wave = code smell — decompose harder or merge with adjacent wave

## Step 5: Capture After State

Same tools as Step 3. Label: `after-<description>.png` or after-state test results.

## Step 6: Validate Behavior

- **UI:** side-by-side comparison — does visual output match the requirement? Any unexpected regressions?
- **Non-UI:** do integration/e2e tests pass? Does observed behavior match acceptance criteria?
- **Both:** unexpected changes → stop, diagnose, fix, re-validate

**Validation is behavioral:**
- Tests confirm *what the system does* from the user's perspective
- Never: unit tests that mock internals to verify code structure
- Always: integration or e2e tests that exercise real behavior paths

## Step 7: Capture Learnings

Append non-obvious gotchas to `docs/learnings.md`:
- Surprising framework behavior
- Non-obvious configuration requirements
- Integration pitfalls discovered during implementation
- Test setup complexity

Format: `- **<topic>**: <description>`. Only genuinely surprising things — not routine findings.

## Step 8: Advisor Gate

Invoke `advisor-gate` with: before state, after state, what changed, which acceptance criteria are met. On APPROVE, record `gate.advisor = "APPROVE"` in `.groundwork/run.json`. With every slice `complete` and the advisor approved, the Stop-gate releases the session.

**Non-negotiable. Do not declare done without this gate.**
