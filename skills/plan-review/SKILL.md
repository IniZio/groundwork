---
name: plan-review
description: READ-ONLY cross-artifact coverage map run BEFORE fan-out (spec-kit analyze analogue). Maps acceptance criteria / functional requirements / spec scenarios to slices; flags zero-coverage ACs, untestable ACs, spec↔plan contradictions, negative-scope violations, and missing seams. Use before fan-out on any non-trivial feature, or when advisor plan_soundness is low.
---

# Plan Review

Read-only pre-fan-out coverage analysis. Analogous to spec-kit `analyze`: map the approved motive charter + spec against the proposed slice decomposition **before** implementation waves start. This skill never edits code, never mutates the run ledger, and never writes slices.

It is the softer `analyze` path that complements the P1 HARD-GATE (a motive charter must exist before non-trivial impl). HARD-GATE asks "is there a charter?"; plan-review asks "does the charter actually cover the contract?"

## When to Use

- **Before fan-out** on any non-trivial feature (after the `interview` → `planner` pipeline produced a motive charter, and after `vertical-slice` proposed slices — before general-purpose agents start)
- When advisor scores **`plan_soundness` low** (≤1) or returns **REPLAN** and you need a structured gap list before re-entering `interview` or `vertical-slice`
- When the user asks to "check coverage", "analyze the plan", "are the slices complete?", or "did we miss an AC?"
- Optional mid-flight: after a wave lands and new coupling or scope drift is suspected — still read-only; route fixes through `vertical-slice` / `interview`, not this skill

**Skip for:** trivial/small-clear/docs/obvious-bug paths (direct → advisor). Those stay on the fast-path; plan-review is non-trivial-only.

## Inputs (read, do not invent)

Resolve what exists; missing inputs are themselves findings:

| Artifact | Typical path | Required? |
|----------|--------------|-----------|
| Motive charter (ACs + DECISION events) | `.groundwork/motives/<slug>/motive.md` (`motive_ref` in the ledger) | Yes — without ACs, emit CRITICAL and stop |
| Spec / functional requirements | `doc/specs/<concept-dir>/requirements/*.md` | Yes when referenced by the charter |
| Slice ledger / proposed slices | `.groundwork/runs/<session_id>.json`, vertical-slice output | Yes — nothing to map otherwise |
| Negative scope | charter negative_scope, interview "out of scope", rejection KB | Strongly preferred |

Prefer stable AC ids (`AC1`, `AC2`, …) from the feature/spec contract. If the spec only has prose bullets, assign ephemeral ids `AC1..N` for this review and cite the source line.

## Gap types (align with advisor `plan_soundness`)

Use these labels exactly — they feed Contract A `plan_soundness` and REPLAN payloads:

| Type | Meaning | Default severity |
|------|---------|------------------|
| `missing` | An AC / functional requirement / spec scenario has **no** slice covering it (zero-coverage) | **CRITICAL** |
| `partial` | A slice covers only part of an AC; remainder unowned or split without a seam | **WARN** (promote to CRITICAL if the unowned remainder is user-visible or blocking) |
| `contradicts` | Slice outcome, plan step, or AC text conflicts with another artifact (spec↔plan, plan↔slices, AC↔AC) | **CRITICAL** |
| `unrequested` | Slice does work outside spec **or** inside documented negative scope | **CRITICAL** when negative-scope; **WARN** when merely unstated extra |
| `untestable` | AC has no observable pass/fail signal (no scenario, no UI/CLI/API assertion, pure intent) | **WARN** (CRITICAL if it is a primary success criterion) |
| `missing_seam` | Cross-slice shared file/module with no ownership boundary, or an AC that requires a contract neither slice owns | **WARN** (CRITICAL if two impl slices would edit the same file) |

## Process

### 1. Collect artifacts

Read the motive charter, `doc/specs/` requirements, negative scope, and the proposed slice list. Do **not** explore the full codebase for implementation detail — this is a coverage map, not an arch review. If a path is missing, record `missing_artifact` and continue with what remains.

AC ids come from the charter (e.g. `AC1`, `AC2`). The ledger's `AC_COVERAGE` events carry the pair `(d.ac, d.slice)` — use these to pre-populate the coverage table and flag gaps.

### 2. Build the coverage table

For every AC in the charter, assign:

```text
AC id | summary | covering slice id | requirement id
```

Columns:
- **AC id** — stable id from the motive charter (e.g. `AC1`)
- **summary** — short restatement of the acceptance criterion
- **covering slice id** — ledger slice id(s) that implement this AC, or `—` if none
- **requirement id** — `doc/specs/` requirement id that grounds this AC, or `—` if charter-only

**Status values:**

| Status | Meaning |
|--------|---------|
| `covered` | ≥1 slice owns the behavior end-to-end |
| `partial` | Owned incompletely; note the gap |
| `uncovered` | Zero slices (`missing`) |
| `untestable` | No observable verification hook |
| `contradicts` | Conflicts with plan/spec/another AC |
| `out_of_scope` | Slice work maps to negative scope (`unrequested`) |

Also invert the map: for each slice, list ACs it claims. Slices with **zero** AC links are `unrequested` candidates unless they are pure `plan`/`design`/`diagnose` kinds.

### 3. Flag findings

Emit two lists — **CRITICAL** and **WARN** — each item:

```text
- [gap_type] <AC or slice id>: <one-line evidence> (artifacts: <paths or headings>)
```

Minimum checks (do all of them):

1. **Zero-coverage ACs** — every AC appears in ≥1 slice (`missing`)
2. **Untestable ACs** — no scenario, signal, or verification surface (`untestable`)
3. **Contradictions** — spec vs plan, plan vs slices, AC vs AC (`contradicts`)
4. **Negative-scope violations** — slice work ⊆ declared out-of-scope (`unrequested`)
5. **Missing seams** — shared files across slices, or AC with no owning interface (`missing_seam`)
6. **Orphan slices** — impl slice with no AC (`unrequested`)
7. **Wave / dependency sanity** — slice blocked_by cycles or impl before its plan/design dependency (WARN unless it guarantees a contradicting delivery order → CRITICAL)

### 4. Output format (mandatory shape)

Return **only** this structure to the orchestrator/user (keep it scannable):

```markdown
# Plan review — <feature or brief>

## Coverage

| AC id | Summary | Covering slice id | Requirement id |
|-------|---------|-------------------|----------------|
| AC1 | ... | S1, S3 | REQ-42 |
| AC2 | ... | — | REQ-43 |
| AC3 | ... | S2 | — |

## CRITICAL
- [missing] AC2: no slice covers <quote> (spec.md §…)
- [contradicts] S4 vs AC1: slice delivers X; spec requires Y

## WARN
- [untestable] AC5: no observable signal
- [missing_seam] S2∩S3 both touch `path/to/shared.ts`

## Verdict hint
- **Block implement** | **Proceed with warns** | **Re-enter interview** | **Re-enter vertical-slice**
- plan_soundness (suggested): 0–3 with one-line rationale
- If block/re-enter: name the re-entry skill and the gap_types driving it
```

**CRITICAL findings SHOULD block implement** — do not fan out general-purpose impl slices until CRITICAL is empty or the user explicitly overrides. This complements (does not replace) the P1 HARD-GATE and the advisor REPLAN path:

| Signal | Route |
|--------|--------|
| No motive charter / no charter ACs | HARD-GATE → feature-planning pipeline (`interview` → `planner`) — not this skill's job to create the charter |
| CRITICAL `missing` / `partial` heavy / bad decomposition | Re-enter **`vertical-slice`** |
| CRITICAL `contradicts` on spec intent, wrong problem | Re-enter **`interview`** |
| CRITICAL `unrequested` negative-scope | Strip slices or re-scope with user; do not impl |
| Only WARN | Orchestrator MAY proceed; surface WARNs in the run brief |
| Advisor later scores `plan_soundness` ≤ 1 | REPLAN → use this skill's table as the gap payload |

### 5. What this skill does **not** do

- Does **not** edit code, specs, plans, ledgers, or feature sidecars
- Does **not** mark ledger slices complete or call advisor APPROVE
- Does **not** replace `advisor-gate` completion review or `arch-review`
- Does **not** run codegen, tests, or builds
- Does **not** apply to the trivial fast-path

## Orchestrator integration

1. Non-trivial feature path: `interview` → `planner` → motive charter (`motive_ref`) → `vertical-slice` (ledger) → **`plan-review`** → fan-out only if no blocking CRITICAL (or user override).
2. On advisor **REPLAN** or low `plan_soundness`: run `plan-review` on the current spec + slices, attach the coverage table + gap_types to the re-entry prompt.
3. Record nothing mandatory in the ledger from this skill; the orchestrator may paste the verdict hint into the run `brief` or feature `history` if useful.

## Completion

After emitting the coverage table and CRITICAL/WARN lists:

- If CRITICAL is non-empty: state clearly that implement SHOULD be blocked and name the re-entry skill.
- If only WARN/empty: state that fan-out may proceed.
- Do not invoke implementation agents from this skill.
- Orchestrator still runs `advisor-gate` at the end of the overall task; plan-review is a pre-flight, not a completion gate.
