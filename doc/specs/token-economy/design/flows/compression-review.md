---
tags: [flow, token-economy]
---

# Compression Review Flow

How to review an agent output or diff for compliance with token-economy compression rules.

---

## Trigger

Run this procedure when:
- reviewing a PR or diff that touches agent definition files (`agents-src/`, `agents/`, `skills/`)
- reviewing session transcripts for gate evidence
- auditing an advisor citation before recording APPROVE

---

## Steps

### 1. Identify the surface

Classify each prose block in the diff:
- **Sequencing prose** (wave ordering, `blocked_by` fields, gate sequences) → applies at `lite` maximum
- **Leaf agent output** (agent definition prose, skill instructions) → applies at `full`
- **Evidence surface** (advisor citation, ledger entry, test output, `file:line`, error, code block) → compression forbidden

### 2. Check evidence surfaces first (highest risk)

For each evidence surface:
1. Locate the original source (session transcript, ledger file, test runner output, source file).
2. Confirm the text is reproduced verbatim or removed entirely.
3. Flag any difference, even a single word.

**Stop here if any evidence surface is compressed.** Record the finding before continuing.

### 3. Check guard rails (apply at all intensity levels)

Scan the diff for:
- Removed `not`, `never`, `no`, `only`, `except` — flag each (R-004)
- Modal hedge (`may`, `could`, `sometimes`, `might`, `appears to`, `is likely to`) replaced by a stronger form (`will`, `does`, `always`, `is`) — flag each (R-005)
- Introduced ad-hoc abbreviations (`cfg`, `fn`, `req`, `impl`) — flag each (R-006)
- `AC`, `TBD`, `TBR` expanded to full forms — flag each (R-006)

### 4. Check intensity-level compliance

For **sequencing prose**:
- Conjunctions (`then`, `before`, `after`, `and then`, `so that`) must be present where present in original.
- Articles (`a`, `an`, `the`) must be present.
- Sentence fragments must be absent.

For **leaf agent output**:
- Articles should be absent.
- Filler words should be absent.
- Fragments are permitted where meaning is clear.

### 5. Record verdict

| Finding | Action |
|---|---|
| No violations | Pass — no further action |
| Evidence surface compressed | Block — must be corrected before merge |
| Guard-rail violation | Block — must be corrected before merge |
| Intensity-level violation | Block — must be corrected before merge |
