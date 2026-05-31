---
name: bdd-implement
description: BDD-first implementation skill. Validate behavior over implementation — visual inspection for UI, integration/e2e tests for non-UI. Decompose into vertical tracer-bullet slices for parallel execution. MANDATORY after PRD approval.
---

# BDD Implement

## Core Principle

**Validate behavior, not implementation.** Tests should confirm *what the system does* from the user's perspective, not *how the code is structured internally.*

- **UI work:** Visual inspection before/after (screenshots, accessibility snapshots)
- **Non-UI work:** Integration or end-to-end tests that exercise real behavior paths
- **Never:** Unit tests that mock internals to verify code structure

## When to Use

**MANDATORY** — invoke this skill in these cases:

- **After PRD approval** for features — before any implementation begins
- **After `interview`** for small changes — interview spec is the spec
- **Any feature that changes observable behavior**
- **When scoping implementation work into parallel execution waves**

**Do NOT use for:**
- **Bugs** — use `diagnose` instead. It owns the fix and regression test.
- **Trivial changes** (<1h, fully specified, ≤2 files) — implement directly, then `advisor-gate`. Default to direct; load skills only when routing names them.

**You do not have a choice.** If a PRD has been approved and implementation is starting, this skill must be followed.

## Two Modes of Operation

### Feature Mode (after PRD approval)

Decompose into vertical tracer-bullet slices from the PRD's acceptance criteria. Each slice delivers a complete, testable user behavior cutting through all layers.

### Small-Change Mode (after interview for <1 day work)

Lightweight decomposition into 3+ vertical slices for maximum parallelism. No PRD needed — the interview spec is the spec.

**Decision rule:** If a PRD exists → Feature Mode. Otherwise → Small-Change Mode.

## Vertical-Slice Decomposition

**The key insight:** each slice is a thin end-to-end tracer bullet through ALL layers for ONE user-facing behavior — not a horizontal layer.

**Horizontal (wrong):**
```
Wave 0: all types + all constants
Wave 1: all functions + all composables
Wave 2: all components + all UI
```
This delays validation to the last wave. No user behavior is testable until everything is built.

**Vertical (correct):**
```
Slice 1 (tracer): Add todo — Todo type → addTodo() → TodoInput.vue → e2e test
Slice 2: Complete + delete — toggleTodo(), deleteTodo() → TodoItem.vue → e2e tests
Slice 3: Filter + clear — filter, clearCompleted() → TodoFilter + TodoList → e2e tests
```
First slice proves the entire path works. Subsequent slices build on it.

### Decomposition Process

1. **Map acceptance criteria to slices.** Each criterion (or small group of related criteria) becomes one slice.
2. **Identify the tracer bullet.** The first slice should prove the end-to-end path: data model → logic → surface → test.
3. **Find parallelism.** Slices that don't depend on each other can run in parallel.
4. **Assign waves.** Wave 0 = tracer. Wave k = slices whose prerequisites are in earlier waves.

### Slice Template

Each slice contains everything needed for one vertical behavior:

```
Slice N: <behavior name>
  Types: <data structures needed>
  Logic: <functions/composables/services>
  Surface: <components/UI/API endpoints>
  Test: <e2e or integration test validating the behavior>
  Depends on: <slice IDs or "tracer">
```

### Wave Execution

**For orchestrator:** Within a wave, launch ALL slices in parallel via `task` with `subagent_type="coder"`:

```
# Wave 1: two independent slices
task(description="Slice 2: Complete + delete todo", prompt="...", subagent_type="coder")
task(description="Slice 3: Filter + clear completed", prompt="...", subagent_type="coder")
```

**For coder:** You may receive one or more slices as individual tasks. Implement each slice fully (types, logic, surface, test) in one pass.

**Maximize wave width.** If a wave has only 1 slice, look harder for decomposition or combine it with an adjacent wave. Every wave should have ≥3 slices unless the critical path genuinely has no parallelism. **Fan out aggressively — 5-15 parallel coder tasks per wave is the target.** More parallelism = faster delivery.

### Small-Change Decomposition

For work without a PRD, use the same vertical-slice approach but lighter:

1. Identify ALL user-facing behaviors from the interview spec (aim for maximum decomposition)
2. First behavior = tracer bullet (proves the path)
3. Remaining behaviors = parallel slices after tracer

**Minimum decomposition:** Even a "simple" change should produce ≥3 slices. If you can't decompose into 3+ slices, the change is probably trivial (use the Trivial path instead). **Target 5-15 slices for features** — more parallelism = faster delivery.

## Parallel Coder Delegation (Orchestrator Only)

> **Note:** Fan-out targets and wave decomposition are for the orchestrator. Coder agents receive individual slices and implement them end-to-end.

When launching a wave, send all wave slices to `coder` agents simultaneously:

```
# Orchestrator: fan out maximally — launch ALL independent slices simultaneously
task(description="Slice 2: Complete todo", prompt="...", subagent_type="coder")
task(description="Slice 3: Delete todo", prompt="...", subagent_type="coder")
task(description="Slice 4: Filter todos", prompt="...", subagent_type="coder")
task(description="Slice 5: Clear completed", prompt="...", subagent_type="coder")
task(description="Slice 6: Edit todo", prompt="...", subagent_type="coder")
# The more slices in parallel, the faster the total completion time

# Bad: sequential — never do this
task(...) → wait → task(...) → wait → ...
```

Each `coder` prompt must be **fully self-contained**: include file paths, requirements, acceptance criteria, and any context the coder needs. The coder has no shared context with you.

**Fan-out intensity targets:**
- Feature (PRD): 5-15 parallel slices per wave
- Small change: 3-5 parallel slices
- Single-slice waves are a code smell — decompose harder or combine waves

## Workflow

### 1. Decompose

- **Feature Mode:** Map PRD acceptance criteria to vertical slices. Identify tracer bullet. Build wave plan.
- **Small-Change Mode:** Identify 2-3 vertical behaviors from interview spec. First = tracer.

Present the decomposition to the user via `question` tool before implementing.

### 2. Pin Session Goal

Set the first `todowrite` item to the feature goal derived from acceptance criteria. This item stays at the top throughout implementation. After each wave, verify remaining work still serves this goal.

### 3. Capture Before State

- **UI work:** `playwright_browser_snapshot` + `playwright_browser_take_screenshot` → `before-<description>.png`
- **Non-UI work:** Run existing integration/e2e tests for baseline. Note what passes/fails.
- **Skip if:** Non-UI work with no existing tests AND the change is purely additive (no risk of breaking existing behavior). Document why you skipped.

### 4. Execute Waves

**For orchestrator:** Launch Wave 0 (tracer), wait for completion, verify, then launch Wave 1, etc. After each wave, update `todowrite` state.

**For coder:** Implement the slice(s) assigned to you fully (types, logic, surface, test) in one pass. Report completion with what was implemented and any blockers.

### 5. Capture After State

Same tools as Step 3. Label: `after-<description>.png` or after-state test results.

### 6. Validate

- **UI:** Side-by-side comparison — does visual output match requirement? Any unexpected changes?
- **Non-UI:** Do integration/e2e tests pass? Does observed behavior match the acceptance criteria?
- **Both:** If unexpected changes — stop, diagnose, fix, re-validate.

### 7. Capture Learnings

After validation, append any non-obvious gotchas discovered during implementation to `docs/learnings.md`:
- Surprising framework behavior
- Non-obvious configuration requirements
- Integration pitfalls
- Test setup complexity

**Format:** `- **<topic>**: <gotcha description>`

Lazy-create `docs/learnings.md` if it doesn't exist. Only add genuinely surprising, non-obvious things — not routine findings.

### 8. Completion Gate

Invoke `advisor-gate` with: before state, after state, what changed, which acceptance criteria are met.

**Do not declare done without this gate. This step is non-negotiable.**
