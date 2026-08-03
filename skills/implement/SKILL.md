---
name: implement
description: Implementation orchestration skill. Decompose into vertical slices for maximum general-purpose fan-out, then validate behavior (not code structure). MANDATORY after a plan or interview. Use vertical-slice skill for conflict-free slice planning and the run ledger (.groundwork/runs/<session_id>.json).
---

# Implement

## Platform contract

The decomposition and validation method is shared. Delegation, plans, and
ledger enforcement are host-specific: use the host's documented native
interfaces when present. In Codex, do not assume a `task`, `question`, or
todo-writing tool; use available plan/delegation surfaces, or perform the work
sequentially and label fan-out and ledger state as advisory.

## Core Principle

**Decompose first, fan out maximally, validate behavior.**

Slice the work into independent end-to-end behaviors before launching any general-purpose agents. Fan out all independent slices simultaneously — 5-15 parallel general-purpose agents per wave is the target. Validate what the system *does* from the user's perspective, not how the code is structured.

```
<HARD-GATE>
For NON-TRIVIAL work (≥1 day estimated, OR ≥3 files, OR ≥2 behaviors, OR large verification surface (requires real hardware or physical devices; requires a multi-service or otherwise non-trivial live environment; involves >5 distinct QA scenarios; or spans ≥2 platforms or clients), OR anything classified
Feature/SmallRisky), do NOT begin creative implementation until a user-approved plan/spec is
grounded in a motive charter (motive_ref) OR an interview/planner session has produced one.
Trivial work (<1h, ≤2 files, fully specified, obvious typo/config, AND small verification surface (no real hardware, single platform, single-service or no live environment, ≤5 QA scenarios)) is EXEMPT — proceed directly.
If you are about to implement non-trivial work and no motive_ref exists, STOP and route to
`interview` or `planner` first.
</HARD-GATE>
```


## When to Use

**MANDATORY** in these cases:
- After a plan is approved — before any implementation begins
- After `interview` for small changes — interview spec is the spec
- Any feature that changes observable behavior
- Any task touching ≥3 files or ≥2 behaviors or with a large verification surface

**Do NOT use for:**
- **Bugs** — use `diagnose` instead. It owns the fix and regression test.
- **Trivial changes** (<1h, fully specified, ≤2 files, small verification surface) — delegate directly to general-purpose, then `advisor-gate`.

## Two Modes

### Feature Mode (a plan exists)
A plan is whatever concrete spec the work is grounded in: an `interview` synthesis, a
`planner` output, or the project's own planning artifact (see
`interview` for detecting project-level plan conventions). **A non-trivial feature MUST have a planning artifact (`motive_ref`) before `vertical-slice` fans out** — if missing, STOP and route to `interview` or `planner` first (HARD-GATE). Decompose its acceptance
criteria into vertical slices — each criterion → one slice. Record the motive slug as
`motive_ref` in the ledger.

### Small-Change Mode (after `interview`, no separate plan)
Lightweight decomposition into 3–5 vertical slices. The interview spec is the spec.

**Decision rule:** a plan/spec exists → Feature Mode. Otherwise → Small-Change Mode.

## Step 0: Banner

Emit the compliance banner as your first line: `GROUNDWORK ▸ ultrawork: <N> slices across <M> waves → .groundwork/runs/<session_id>.json`. This is the observable signal the workflow is engaged.

## Step 1: Decompose with `vertical-slice`

Run `vertical-slice` to produce a conflict-free slice table with wave assignments before launching agents. `vertical-slice` may also write a run ledger when the host provides that interface. In Codex, the ledger and advisor state are advisory unless a native host integration explicitly enforces them.

**Minimum decomposition:**
- Feature: ≥5 slices (target 5-15 per wave)
- Small change: ≥3 slices
- If you can't reach 3 slices, the change is trivial — skip this skill

Each slice is a thin end-to-end tracer through ALL layers for ONE user-facing behavior:

```
Wave 0: tracer bullet — proves full path (data model → logic → surface → test)
Wave 1+: remaining independent slices, all launched in parallel
```

Present the slice plan in the normal assistant response or the host's documented input interface before executing when user confirmation is needed.

## Step 2: Pin Session Goal

Keep the feature goal visible in the host's plan mechanism when one exists. After each wave, verify remaining work still serves this goal.

## Step 3: Capture Before State

- **UI work:** screenshot + accessibility snapshot before any change → `before-<description>.png`
- **Non-UI work:** run existing integration/e2e tests; note what passes/fails
- **Skip if:** purely additive non-UI change with no existing tests — document why

## Step 4: Execute Waves

**Fan out ALL slices in a wave simultaneously in ONE message:**

Use one native delegation call per independent slice when the host documents
parallel calls. Otherwise run the slices in dependency order; do not imitate a
host-specific task API in prose or tooling.

Each general-purpose prompt must be **fully self-contained**: file paths, requirements, acceptance criteria, context. Coders have no shared state.

Wait for wave completion before launching the next wave. Update the host's plan and ledger interfaces when available. In Codex, record incomplete slices in the plan or handoff artifact and do not claim that a Stop-gate will block session termination.

**Fan-out targets:**
- Feature: 5-15 parallel slices per wave
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

## Step 8: Report Evidence to Orchestrator

Return to the **orchestrator**: before state, after state, what changed, which acceptance criteria are met. The orchestrator invokes `advisor-gate` — do not invoke it yourself or simulate its verdict.

**Do not declare done to the user.** Evidence reporting is your final step; gating belongs to the orchestrator.
