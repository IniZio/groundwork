---
id: C-TOKEN-ECONOMY
type: concept
title: Token Economy
summary: "Groundwork defines prose-compression rules, per-surface intensity levels, and forbidden zones so that agent output stays terse without fabricating evidence or erasing meaning."
parent: C-GROUNDWORK
origin_decision_ref: token-economy#D-1
---

# Token Economy

The token-economy model governs how groundwork agents compress prose output to reduce input-token cost without introducing false claims or erasing meaning. It distinguishes three compression intensities, assigns each to a surface, and marks zones where compression is forbidden entirely.

## Compression model

Compression operates at the word and sentence level, not the idea level. Rules target high-frequency fillers (articles, hedging-as-padding, pleasantries) and structural waste (tool-call narration, preamble, progress notes, decorative tables). The content model is preserved: every claim, every qualifier, every negation must survive.

## Intensity levels

Three named levels are defined:

- **`lite`** — drop filler words only; keep articles and full sentences.
- **`full`** — drop articles; sentence fragments are permitted; prefer shorter synonyms.
- **`ultra`** — additionally strip conjunctions. **Not permitted anywhere in groundwork** — removing conjunctions makes step order ambiguous, and orchestration sequencing depends on unambiguous ordering.

Surface assignments:

| Surface | Intensity |
|---|---|
| Leaf agent output prose | `full` |
| Orchestrator sequencing prose (wave ordering, `blocked_by`, gate sequences) | `lite` maximum |
| Evidence surfaces (see forbidden zones) | none — compression forbidden |

## Forbidden zones

Compression **must not** alter advisor citations, ledger entries, gate evidence, test output, `file:line` references, error text, or code blocks. Terse summaries that upgrade "tests appear to pass" to "tests pass" manufacture false APPROVEs — a failure mode documented in this repo's memory.

## Guard rails

Three rules bound the compression model regardless of intensity level:

1. **Negation and scope words are inviolable.** Never drop `not`, `never`, `no`, `only`, or `except`. Flipping a negation costs more than any token saved.
2. **Modality is content.** Hedges (`may`, `could`, `sometimes`, `is likely to`) carry the author's confidence, and confidence is content. A shorter sentence that upgrades a hedge to a fact is not a simplification — it is a different claim.
3. **No invented abbreviations.** Ad-hoc contractions (`cfg`, `impl`, `req`, `fn`) save no tokens — the tokenizer splits them identically to the full word — while imposing a real decode cost. Groundwork's existing domain vocabulary (`AC`, `TBD`, `TBR`) is defined terms-of-art and must be left unchanged; this rule targets ad-hoc contractions only.
