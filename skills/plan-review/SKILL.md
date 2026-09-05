---
name: plan-review
description: Audit plan coverage — map charter ACs to ledger slices and flag gaps before fan-out.
---

# Plan Review

Read-only pre-fan-out coverage audit. Never edits code, ledger, or charter.

## When to Use

Run between `vertical-slice` and fan-out on any non-trivial feature; when advisor returns **REPLAN** or scores `plan_soundness` ≤1; or when the user asks to check coverage or slice completeness. Optional mid-flight after scope drift is suspected — still read-only.

**Skip for:** trivial/small-clear/docs/obvious-bug paths (direct → advisor).

## Inputs (read, do not invent)

Motive charter (`.groundwork/motives/<slug>/motive.md`), `doc/specs/` requirements, proposed slices from `vertical-slice`, negative scope (charter `negative_scope`, rejection KB). Missing inputs are themselves findings; without charter ACs, emit CRITICAL and stop.

## Process

### 1. Collect artifacts

Read the motive charter, `doc/specs/` requirements, negative scope, and the proposed slice list. Do **not** explore the full codebase for implementation detail — this is a coverage map, not an arch review. If a path is missing, record `missing_artifact` and continue with what remains.

### 2. Build the coverage table

For every AC in the charter, assign:

```text
AC id | summary | covering slice id | requirement id
```

Also invert the map: for each slice, list ACs it claims. Slices with **zero** AC links are `unrequested` candidates unless they are pure `plan`/`design`/`diagnose` kinds. Column definitions and status values: see `reference/gap-types.md`.

### 3. Flag findings

Emit two lists — **CRITICAL** and **WARN** — each item:

```text
- [gap_type] <AC or slice id>: <one-line evidence> (artifacts: <paths or headings>)
```

Minimum checks (do all of them):

1. **Zero-coverage ACs** (`missing`)
2. **Untestable ACs** (`untestable`)
3. **Contradictions** (`contradicts`)
4. **Negative-scope violations** (`unrequested`)
5. **Missing seams** (`missing_seam`)
6. **Orphan slices** (`unrequested`)
7. **Wave / dependency sanity** (WARN → CRITICAL if delivery order contradicted)

For checks 1–7 full definitions: see `reference/gap-types.md`.

8. **Premise-provenance gate (D-82)** — Wave-1 impl slice with premise tagged `unverified-assumption`: flag CRITICAL (`missing`), move to Wave 2+, add a verify-first slice in Wave 1. If `research_tickets_cited` is non-empty, cross-check each ticket under `.groundwork/motives/<slug>/tickets/`; missing ticket file is a WARN.
9. **Missing structure decision** — run `bin/journal compile <slug> --json`; look in `agent.decision_log` for an accepted entry whose `kind` is `"structure"` (appended by the planner as `data.kind`) with `alternatives` length ≥2. Absent → flag CRITICAL (`missing-structure-decision`). Planner recorded no structure decision. Correct by re-entering the planner citing `groundwork:engineering-judgment`. Trivial (no-ledger) work is exempt.
10. **Missing test-strategy decision** — same check: look in `agent.decision_log` for an accepted entry whose `kind` is `"test-strategy"` (appended by the planner as `data.kind`) with `alternatives` length ≥2. Absent → flag CRITICAL (`missing-test-strategy-decision`). Planner recorded no test-strategy decision. Correct by re-entering the planner citing `groundwork:engineering-judgment`. Trivial (no-ledger) work is exempt.

### 4. Output format (mandatory shape)

Return **only** this structure to the orchestrator/user (keep it scannable):

```markdown
# Plan review — <feature or brief>

## Coverage

| AC id | Summary | Covering slice id | Requirement id |
|-------|---------|-------------------|----------------|
| AC1   | ...     | S1, S3            | REQ-42         |

## CRITICAL
- [missing] AC2: no slice covers <quote> (spec.md §…)
- [contradicts] S4 vs AC1: slice delivers X; spec requires Y

## WARN
- [untestable] AC5: no observable signal
- [missing_seam] S2∩S3 both touch `path/to/shared.ts`

## Verdict hint
- **Block implement** | **Proceed with warns** | **Re-enter feature-interview** | **Re-enter vertical-slice**
- plan_soundness (suggested): 0–3 with one-line rationale
- If block/re-enter: name the re-entry skill and the gap_types driving it
```

**CRITICAL findings SHOULD block implement** — do not fan out implementation slices until CRITICAL is empty or the user explicitly overrides. Routing by signal: see `reference/gap-types.md`.

### 5. What this skill does **not** do

Does not edit code, ledger, or charter; does not call advisor APPROVE; does not apply to the trivial fast-path.

## Orchestrator integration

Non-trivial path: `feature-interview` → `planner` → `vertical-slice` → **`plan-review`** → fan-out only if no blocking CRITICAL (or user override). On advisor **REPLAN** or `plan_soundness` ≤1: attach the coverage table + gap_types to the re-entry prompt. Record nothing mandatory in the ledger.

## Completion

Output delivered: coverage table present for every charter AC; CRITICAL/WARN lists populated (or explicitly empty); verdict hint states `plan_soundness` score and names re-entry skill if blocking.
