---
name: bdd-implement
description: BDD-first implementation skill. Validate behavior over implementation — visual inspection for UI, integration/e2e tests for non-UI. Build task graphs for parallel execution efficiency.
---

# BDD Implement

## Core Principle

**Validate behavior, not implementation.** Tests should confirm *what the system does* from the user's perspective, not *how the code is structured internally.*

- **UI work:** Visual inspection before/after (screenshots, accessibility snapshots)
- **Non-UI work:** Integration or end-to-end tests that exercise real behavior paths
- **Never:** Unit tests that mock internals to verify code structure

## When to Use

- Any bug fix (UI or non-UI)
- Any feature that changes observable behavior
- Any time a fix could be "correct per code but wrong in practice"
- When scoping implementation work into parallel execution waves

## Task Graph

Before implementing, decompose work into a **task dependency graph** for maximum parallelism:

1. **List atomic tasks** — each with a clear "done" definition
2. **Map dependencies** — hard ordering (A must finish before B) vs soft preferences
3. **Assign waves** — Wave 0 has no predecessors; Wave k requires all predecessors in waves < k
4. **Identify critical path** — longest chain that determines total time
5. **Flag resource conflicts** — tasks touching the same file/service must serialize despite parallel eligibility

Execute waves in order; within a wave, run tasks in parallel via `background_task`.

## Workflow

### 1. Capture Before State

- **Web:** `playwright_browser_snapshot` + `playwright_browser_take_screenshot` → `before-<description>.png`
- **macOS native:** XCUITest accessibility snapshot + `screenshot()` → `before-<description>.png`
- **Non-UI:** Run existing integration/e2e tests to capture baseline behavior. Note what passes/fails.

### 2. Implement

Minimal change. Follow YAGNI. Execute by task graph waves.

### 3. Capture After State

Same tools as Step 1. Label: `after-<description>.png` or after-state test results.

### 4. Validate

- **UI:** Side-by-side comparison — does visual output match requirement? Any unexpected changes? Accessibility tree correct?
- **Non-UI:** Do integration/e2e tests pass? Does observed behavior match the requirement?
- **Both:** If unexpected changes — stop, diagnose, fix, re-validate.

### 5. Completion Gate

Invoke `advisor-gate` with: before state, after state, what changed, what requirement is met.

**Do not declare done without this gate.**
