---
tags: [component, token-economy]
---

# Compression Rules

The complete rule set for groundwork prose compression. Rules are grouped by category.

---

## Drop rules (remove these elements)

| Rule | Element | Applies at | Guard |
|---|---|---|---|
| Drop articles | `a`, `an`, `the` | `full` | Never drop from evidence surfaces |
| Drop filler words | `just`, `really`, `basically`, `actually`, `simply` | `lite` and above | — |
| Drop pleasantries | `happy to help`, `great question`, `of course` | `lite` and above | — |
| Drop hedging-as-padding | `I think`, `it seems like` as openers without intent | `lite` and above | Do not drop calibrated hedges (R-005) |
| Drop tool-call narration | `Let me read the file`, `I'll now check` | `full` | — |
| Drop preamble | Progress notes before first tool call | `full` | — |
| Drop decorative tables | Tables with no data value | `full` | Do not drop evidence tables |
| Drop standalone emoji | Decorative emoji | `full` | — |

## Prefer rules (substitute these)

| Rule | Prefer | Over | Applies at |
|---|---|---|---|
| Shorter synonyms | `use` | `utilise` | `full` |
| Shorter synonyms | `fix` | `remediate` | `full` |
| Shortest decisive excerpt | Quoted decisive line | Full log dump | `full` |
| Sentence fragments | Fragment (meaning clear) | Full sentence | `full` |

## Inviolable guard rails (all intensity levels)

| Rule | Requirement |
|---|---|
| Negation words preserved | Never remove `not`, `never`, `no`, `only`, `except` (R-004) |
| Modality preserved | Never upgrade `may`/`could`/`might`/`sometimes`/`appears to` → `will`/`does`/`always`/`is` (R-005) |
| No invented abbreviations | Never introduce `cfg`, `fn`, `req`, `impl` as abbreviations (R-006) |
| Domain vocabulary unchanged | `AC`, `TBD`, `TBR` left as-is — neither expanded nor contracted (R-006) |

## Forbidden

| Prohibition | Reason |
|---|---|
| `ultra` intensity (strip conjunctions) | Makes step order ambiguous (R-002) |
| Compression on evidence surfaces | Manufactures false evidence (R-003) |
