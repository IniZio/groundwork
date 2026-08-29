---
tags: [recipe, token-economy]
---

# Recipe: Apply Compression to Agent Output

Apply token-economy compression rules to a draft agent output.

---

## Before you start

- Know which surface you are writing for (leaf agent output or orchestrator sequencing prose).
- Have the [[../components/compression-rules|compression rules]] and [[../reference/intensity-levels-by-surface|intensity reference]] open.

---

## Steps

### 1. Identify evidence surfaces and skip them

Scan your draft for: advisor citations, ledger entries, gate evidence, test output, `file:line` references, error text, code blocks. Mark these as **frozen** — do not touch them.

### 2. Determine the intensity level

| Surface | Level |
|---|---|
| Leaf agent output prose | `full` |
| Orchestrator sequencing prose | `lite` |

### 3. Apply drop rules for your level

**At `lite`:**
- Remove filler words: `just`, `really`, `basically`, `actually`, `simply`
- Remove pleasantries: `happy to help`, `great question`, `of course`
- Remove hedging-as-padding openers: `I think`, `it seems like` (when no calibrated estimate follows)

**At `full` (also do `lite` drops above):**
- Remove articles: `a`, `an`, `the`
- Remove tool-call narration: `Let me read the file`, `I'll check`, `Now I will`
- Remove preamble and progress notes
- Remove decorative tables (keep data tables)
- Remove standalone emoji

### 4. Apply prefer rules (full only)

- Replace `utilise` → `use`, `remediate` → `fix`, and similar.
- Replace full log dumps → quote the shortest decisive line.
- Replace full sentences where a fragment communicates the same claim clearly.

### 5. Run the guard-rail check

For every sentence you changed:
- [ ] No `not`, `never`, `no`, `only`, `except` was removed (R-004)
- [ ] No modal hedge was upgraded to a stronger form (R-005)
- [ ] No ad-hoc abbreviation was introduced (R-006)
- [ ] No `AC`, `TBD`, `TBR` was expanded or contracted (R-006)
- [ ] No conjunction was removed from sequencing prose (R-002)

### 6. Verify frozen surfaces

Re-read each frozen evidence surface against its original source. Confirm verbatim reproduction.
