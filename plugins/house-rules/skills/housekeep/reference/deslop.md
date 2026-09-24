# Deslop mode

Load when user selects `deslop` (default). Shared spine, finding format, severity rubric, triage gate, and completion gate in `SKILL.md` apply.

## 7 smell categories

| Smell | Definition |
|---|---|
| **Duplication** | Repeated logic, copy-paste branches, redundant helpers |
| **Dead code** | Unused code, unreachable branches, stale flags, debug leftovers |
| **Needless abstraction** | Pass-through wrappers, speculative indirection, single-use helper layers |
| **Boundary violations** | Hidden coupling, misplaced responsibilities, wrong-layer imports or side effects |
| **Missing tests** | Behavior not locked, weak regression coverage, edge-case gaps |
| **UI/design defaults** | Generic visual patterns that make an AI-built interface feel unreviewed |
| **Redundant comments** | Narration, step markers, restatements. Keep: non-obvious *why*, invariants, gotchas, spec links, doc-comments |

Run `pnpm run check:comments` first — pre-ranks surface by comment density. Start with highest-ratio files.

## Steps 1–8

**Step 1 — Behavior lock.** Identify what must stay the same. Add or run narrowest regression tests before editing.

**Step 2 — Scan.** Sweep the scoped surface. Collect every smell as a Finding — do not fix in place.

**Step 3 — Classify.** Map each Finding to its category and severity. Assemble backlog sorted SEV1 → SEV4.

**Step 4 — Triage gate (mandatory).** Present backlog grouped by severity. User selects Accept / Defer / Skip. Only accepted Findings proceed. Deferred and skipped Findings go in the final report — never dropped silently.

**Step 5 — Cleanup plan.** Bound to accepted Findings only. Order from safest deletion to riskier consolidation.

**Step 6 — One smell-focused pass at a time.**
- Pass 1: Dead code deletion
- Pass 2: Duplicate removal
- Pass 3: Naming and error-handling cleanup
- Pass 4: Comment cleanup — remove narration, step markers, restatements; keep *why* rationale
- Pass 5: Test reinforcement
- Re-run targeted verification after each pass.

**Step 7 — Quality gates.** Keep regression tests green. Run `pnpm run check:comments --strict` after comment cleanup (exits 0). Run typecheck, lint, and security scanners as applicable.

**Step 8 — Report.**

```
## Housekeep Report

**Scope:** <files / directories covered>

**Behavior Lock:**
- <test(s) added or confirmed>

**Triaged Backlog:**
- SEV1: <n> | SEV2: <n> | SEV3: <n> | SEV4: <n> | Total: <n>
- Accepted: <n> | Deferred: <n> | Skipped: <n>

**Passes Completed:**
- Pass 1 (Dead code): <summary or "nothing qualified">
- Pass 2 (Duplication): <summary or "nothing qualified">
- Pass 3 (Naming/error-handling): <summary or "nothing qualified">
- Pass 4 (Comments): <summary or "nothing qualified">
- Pass 5 (Tests): <summary or "nothing qualified">

**Quality Gates:**
- Regression tests: PASS / FAIL
- Lint: PASS / FAIL
- Typecheck: PASS / FAIL
- `check:comments --strict`: PASS / FAIL

**Changed Files:**
| file | simplification |
|---|---|

**Deferred/Skipped Backlog:**
| id | severity | finding | disposition | reason |
|---|---|---|---|---|

**Remaining Risks:** <known gaps, deferred SEV1/2 items>
```
