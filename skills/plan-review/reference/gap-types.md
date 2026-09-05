# Gap Types Reference

## Gap type labels (align with advisor `plan_soundness`)

Use these labels exactly — they feed Contract A `plan_soundness` and REPLAN payloads:

| Type | Meaning | Default severity |
|------|---------|------------------|
| `missing` | An AC / functional requirement / spec scenario has **no** slice covering it (zero-coverage) | **CRITICAL** |
| `partial` | A slice covers only part of an AC; remainder unowned or split without a seam | **WARN** (promote to CRITICAL if the unowned remainder is user-visible or blocking) |
| `contradicts` | Slice outcome, plan step, or AC text conflicts with another artifact (spec↔plan, plan↔slices, AC↔AC) | **CRITICAL** |
| `unrequested` | Slice does work outside spec **or** inside documented negative scope | **CRITICAL** when negative-scope; **WARN** when merely unstated extra |
| `untestable` | AC has no observable pass/fail signal (no scenario, no UI/CLI/API assertion, pure intent) | **WARN** (CRITICAL if it is a primary success criterion) |
| `missing_seam` | Cross-slice shared file/module with no ownership boundary, or an AC that requires a contract neither slice owns | **WARN** (CRITICAL if two impl slices would edit the same file) |
| `missing-structure-decision` | No accepted journal decision with `data.kind = "structure"` and ≥2 alternatives recorded before slices were cut — planner recorded no structure decision | **CRITICAL** |
| `missing-test-strategy-decision` | No accepted journal decision with `data.kind = "test-strategy"` and ≥2 alternatives recorded before slices were cut — planner recorded no test-strategy decision | **CRITICAL** |

## Coverage table column definitions

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

## Minimum checks 1–7 full definitions

1. **Zero-coverage ACs** — every AC appears in ≥1 slice (`missing`)
2. **Untestable ACs** — no scenario, signal, or verification surface (`untestable`)
3. **Contradictions** — spec vs plan, plan vs slices, AC vs AC (`contradicts`)
4. **Negative-scope violations** — slice work ⊆ declared out-of-scope (`unrequested`)
5. **Missing seams** — shared files across slices, or AC with no owning interface (`missing_seam`)
6. **Orphan slices** — impl slice with no AC (`unrequested`)
7. **Wave / dependency sanity** — slice blocked_by cycles or impl before its plan/design dependency (WARN unless it guarantees a contradicting delivery order → CRITICAL)

## Routing by CRITICAL signal

**CRITICAL findings SHOULD block implement** — do not fan out implementation slices until CRITICAL is empty or the user explicitly overrides. This complements (does not replace) the P1 HARD-GATE and the advisor REPLAN path:

| Signal | Route |
|--------|--------|
| No motive charter / no charter ACs | HARD-GATE → feature-planning pipeline (`feature-interview` → `planner`) — not this skill's job to create the charter |
| CRITICAL `missing` / `partial` heavy / bad decomposition | Re-enter **`vertical-slice`** |
| CRITICAL `contradicts` on spec intent, wrong problem | Re-enter **`feature-interview`** |
| CRITICAL `unrequested` negative-scope | Strip slices or re-scope with user; do not impl |
| Only WARN | Orchestrator MAY proceed; surface WARNs in the run brief |
| Advisor later scores `plan_soundness` ≤ 1 | REPLAN → use this skill's table as the gap payload |

## Inputs table

| Artifact | Typical path | Required? |
|----------|--------------|-----------|
| Motive charter (ACs + DECISION events) | `.groundwork/motives/<slug>/motive.md` (`motive_ref` in the ledger is the **slug**, not the path) | Yes — without ACs, emit CRITICAL and stop |
| Spec / functional requirements | `doc/specs/<concept-dir>/requirements/*.md` | Yes when referenced by the charter |
| Slice ledger / proposed slices | `.groundwork/runs/<session_id>.json`, vertical-slice output | Yes — nothing to map otherwise |
| Negative scope | charter negative_scope, interview "out of scope", rejection KB | Strongly preferred |
