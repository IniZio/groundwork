# Deslop Mode — Full Workflow Reference

## 7 Smell Categories

| Smell | Definition |
|---|---|
| **Duplication** | Repeated logic, copy-paste branches, redundant helpers |
| **Dead code** | Unused code, unreachable branches, stale flags, debug leftovers |
| **Needless abstraction** | Pass-through wrappers, speculative indirection, single-use helper layers |
| **Boundary violations** | Hidden coupling, misplaced responsibilities, wrong-layer imports or side effects |
| **Missing tests** | Behavior not locked, weak regression coverage, edge-case gaps |
| **UI/design defaults** | Generic visual patterns that make an AI-built interface feel unreviewed |
| **Redundant comments** | Narration (`// Let's...`, `// Now we...`), step markers (`// Step 1`), restatements of obvious code (`// increment counter` above `count++`), section-divider banners used as narration (restating what the next block does, step-marking), apologetic/hedging filler. **Note:** section-divider banners used as consistent structural markers throughout a file are house style and are not a finding — flag only dividers that narrate or step-mark. **Keep:** non-obvious *why* rationale, invariants/constraints, warnings/gotchas, issue/spec links, public API doc-comments |

Run `pnpm run check:comments` first — it pre-ranks the surface by comment density (ratio ≥ 45% of non-blank lines, or a single block occupying ≥ 20% of the file). Advisory only, exits 0. It measures SIZE only: narration, restatement, and step markers still require reading the flagged files. Start with the highest-ratio files from its output.

## Steps 1–8

**Step 1 — Protect current behavior (behavior lock)**
- Identify what must stay the same.
- Add or run the narrowest regression tests needed before editing.
- If tests cannot come first, record the verification plan explicitly before touching code.

**Step 2 — Scan & inventory**
Run `gw comment-density report` and `gw commit-lint report` before the manual sweep — they surface density violations and commit-convention failures as pre-ranked input to the backlog. (`GROUNDWORK_COMMENT_DENSITY=0` and `GROUNDWORK_COMMIT_LINT=0` disable the respective checks.) Sweep the scoped surface. Collect EVERY smell instance as a Finding — do not fix in place. Use the seven deslop categories above to recognize smells.

**Step 3 — Classify & score by severity**
Map each Finding to its smell category, then apply the severity rubric (consequence × blast-radius; context bumps ±1). Assemble the full backlog table sorted SEV1 → SEV4. Do not begin edits yet.

**Step 4 — Triage gate (user selection — mandatory)**
Present the prioritized backlog to the user, grouped by severity (SEV1 first). The user selects which Findings to clean:
- **Accept** — include in the cleanup pass
- **Defer** — record in the report; do not action now
- **Skip** — record in the report; do not action

ONLY user-selected (accepted) Findings enter the cleanup pass. Deferred and skipped Findings are recorded in the final report's Deferred/Skipped Backlog slot — never silently dropped and never silently expanded. This gate happens BEFORE any cleanup edits.

**Step 5 — Cleanup plan for selected findings**
Bound the plan to accepted Findings only. Order the work from safest deletion to riskier consolidation.

**Step 6 — Run one smell-focused pass at a time**
- **Pass 1: Dead code deletion**
- **Pass 2: Duplicate removal**
- **Pass 3: Naming and error-handling cleanup**
- **Pass 4: Comment cleanup** — remove narration, step markers, restatements; keep *why*, invariants, gotchas, doc-comments. A comment earns its place only if it states a *why* that is not evident from the code itself — a constraint, a gotcha, an invariant, an issue/spec link, or a public API doc-comment. Remove: narration (`// Let's...`, `// Now we...`), step markers (`// Step 1`), restatements of the line below, section-divider banners that narrate, commented-out code, apologetic hedging. Record the comment count before and after the pass (e.g. `grep -c '//' file.mjs` or the `check:comments` output ratio); the cleanup report MUST include both numbers so the reduction is observable.
- **Pass 5: Test reinforcement**
- Re-run targeted verification after EACH pass.
- Do not bundle unrelated refactors into the same edit set.
- If a pass finds no violations after an evidence-based scan, record the empty finding (which area was scanned, why nothing qualified) and proceed to the next pass. Do NOT manufacture deletions or changes to justify a pass. A clean pass is a valid result.

**Step 7 — Run quality gates**
- Keep regression tests green.
- Run the relevant lint, typecheck, and unit/integration tests for the touched area.
- Run existing static or security checks when available. For a deslop run: `pnpm run check:comments --strict` MUST pass (exits 0) after comment cleanup — if it fails, either reduce comments further or add `// check-comments-exempt` to a file whose high density is intentional (complex hook library, etc.). Run `gw commit-lint report` over the run's commit range — it must return clean before the advisor gate. Then run typecheck, lint, and security scanners as applicable.
- If a gate fails, fix the issue or back out the risky cleanup. Never force a cleanup through a failing gate.

**Step 8 — Close with the structured report**
Use this template exactly. Present it as the final deliverable.

````
## Housekeep Report

**Scope:** <files / directories covered>

**Behavior Lock:**
- <test(s) added or confirmed; or verification plan if tests could not come first>

**Triaged Backlog:**
- SEV1: <n> findings | SEV2: <n> | SEV3: <n> | SEV4: <n> | Total: <n>
- Accepted: <n> | Deferred: <n> | Skipped: <n>

**Selected For Cleanup:** <list of accepted Finding ids>

**Passes Completed:**
- Pass 1 (Dead code): <concise summary or "nothing qualified">
- Pass 2 (Duplication): <concise summary or "nothing qualified">
- Pass 3 (Naming/error-handling): <concise summary or "nothing qualified">
- Pass 4 (Comments): <concise summary or "nothing qualified">
- Pass 5 (Tests): <concise summary or "nothing qualified">

**Quality Gates:**
- Regression tests: PASS / FAIL
- Lint: PASS / FAIL
- Typecheck: PASS / FAIL
- `check:comments --strict`: PASS / FAIL
- `gw comment-density report`: PASS / FAIL
- `gw commit-lint report`: PASS / FAIL
- Other: <gate name>: PASS / FAIL

**Comment Reduction (Pass 4):**
| file | before ratio | after ratio | before count | after count |
|---|---|---|---|---|
| <path> | <x%> | <y%> | <n> | <m> |

**Changed Files:**
| file | simplification |
|---|---|
| <path> | <one-line description of what was removed/simplified> |

**Deferred/Skipped Backlog:**
| id | severity | finding | disposition | reason |
|---|---|---|---|---|
| <Fn> | <SEVn> | <finding> | Deferred / Skipped | <user-stated reason or "no reason given"> |

**Remaining Risks:** <known gaps, untested edges, deferred SEV1/2 items, scope not covered>
````

## Scoped File-List Usage

This skill can be bounded to an explicit file list or changed-file scope when the caller already knows the safe cleanup surface.
- Good fit: `housekeep src/auth/ src/models/`
- Good fit: a parent session handing off only the files changed in that session
- Preserve the regression-safe workflow even on a short file list.
- Do not silently expand a changed-file scope unless the user explicitly asks.

## What NOT to Do

- Do not change behavior unless the user explicitly asks for behavior changes.
- Do not bundle unrelated refactors into one pass.
- Do not introduce new dependencies during a cleanup pass.
- Do not skip regression tests before editing — lock behavior first.
- Do not silently expand a changed-file scope into broader cleanup.
- Do not force a cleanup through when a quality gate fails — back it out.
- Do not run sequential grep calls when one `ctx_batch_execute` covers discovery.
- Do not skip `advisor-gate` — every housekeep run ends at the gate.
- Do not begin edits before the triage gate — the user must select Findings first.
- Do not silently drop deferred or skipped Findings — record them in the report.
