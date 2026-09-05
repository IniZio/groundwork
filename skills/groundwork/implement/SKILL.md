---
name: implement
description: Decompose a motive into vertical slices, fan out parallel agent waves, and gate completion with behavioral evidence. Use after a plan is approved or after `quick-interview` for a small change.
---

# Implement

**Trigger:** motive classified Feature or SmallRisky with an approved plan, or after `quick-interview` for small changes. Skip for trivial tasks (≤2 files, <1h, small verification surface) — delegate directly to `general-purpose`.

## Failure Modes

**Structural validation.** A test that asserts file content or import structure — rather than the observable behavior it should enforce — passes even when behavior is broken. Tests confirm *what the system does* from the user's perspective. Never: unit tests that mock internals to verify code structure. Always: integration or e2e tests that exercise real behavior paths.

**1:1 forwarding.** A `junior-orchestrator` that relays its brief unchanged to a single child adds latency with no decomposition benefit. Genuine orchestration means multiple children with distinct, non-overlapping scopes.

**Uncommitted-wave accumulation.** A later wave's `git stash` silently reverts prior uncommitted slices. Commit each verified wave before fanning out the next.

**Platform mismatch.** Prose that imitates a host-specific task API — writing `Task(...)` calls in a skill body — invents syntax that may not exist in every host. Use the host's documented native delegation interface; when none is available, execute slices in dependency order.

## Modes

**Feature mode** (plan exists): a non-trivial feature must have an approved plan (`motive_ref`) before fanning out — route to `feature-interview` → `planner` first if missing. Then run `vertical-slice` → conflict-free slice table → execute waves.

**Small-change mode** (after `quick-interview`, no plan): decompose into ≥3 slices. If you can't reach 3 slices, the change is trivial — skip this skill.

## Orchestration Flow

### 1. Banner
Emit the compliance banner as your first line: `GROUNDWORK ▸ ultrawork: <N> slices across <M> waves → .groundwork/runs/<session_id>.json`.

### 2. Decompose
Run `vertical-slice` to produce a conflict-free slice table with wave assignments before launching agents. Slice the work into independent end-to-end behaviors before launching agents. Minimum: ≥5 slices for a Feature, ≥3 for a small change. Link each slice to its ticket and acceptance criteria. See `vertical-slice` for ticket naming, `--ticket`, `--covers-ac`, and `--decisions` linkage.

### 3. Fan out
Fan out all independent slices simultaneously — 5–20 parallel agents per wave is the target (junior-orchestrators by default; general-purpose only for leaf carve-outs). Single-slice wave = code smell — decompose harder or merge with adjacent wave. For small changes: 3–5 agents per wave.

### 4. Agent selection
Dispatch `junior-orchestrator` by **default** to own a domain end-to-end. The carve-out to `general-purpose` (leaf implementer, cannot spawn further general-purpose workers) applies ONLY when ALL of the following hold: single domain with no sub-domains, ≤2 files, no internal sequencing, small verification surface. If ANY clause fails → `junior-orchestrator`.

### 5. Self-contained prompts
Each agent prompt must be **fully self-contained**: file paths, requirements, acceptance criteria, context. Agents have no shared state.

### 6. Wave gate
Wait for wave completion before launching the next wave. Mark each verified slice complete in the ledger. Commit the verified wave before proceeding.

### 7. Worktree conflict-fallback
When slices share files and would otherwise be serialized, use the worktree isolation mechanism documented in `vertical-slice` to preserve parallel width; reconcile serially after the wave lands.

## Validate Behavior

Exercise each behavior end-to-end after each wave: run tests, invoke the CLI, observe the UI. Validate what the system *does* from the user's perspective, not how the code is structured. Do not read test files to verify correctness — run them.

**BDD contract:** given the acceptance criterion in the ticket, when the behavior is exercised from outside the implementation boundary, then the observable output matches the specification. A test that passes against a stub of the system under test proves nothing about the real system.

## Completion

Observable: all ledger slices `complete`, no slice `in_progress`, advisor gate `APPROVE`, each wave committed to git.
