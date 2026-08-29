---
tags: [concept, token-economy]
---

# Intensity Levels

Three compression intensity levels are defined. Each level is a superset of the one below — `full` does everything `lite` does, plus more.

---

## Level definitions

### `lite`
Drop filler words only (`just`, `really`, `basically`, `actually`, `simply`, pleasantries, hedging-as-padding). Keep articles. Keep full sentences. Keep conjunctions.

Use on: orchestrator sequencing prose where ordering is semantically load-bearing.

### `full`
Everything in `lite`, plus: drop articles (`a`, `an`, `the`); permit sentence fragments; prefer shorter synonyms (`use` over `utilise`); omit tool-call narration and preamble; omit decorative tables and emoji; quote shortest decisive line.

Use on: leaf agent output prose.

### `ultra` — **not permitted in groundwork**
Everything in `full`, plus: strip conjunctions (`then`, `before`, `after`, `and then`, `so that`).

`ultra` is banned because removing conjunctions makes step order ambiguous. Orchestration sequencing depends on unambiguous ordering. This level must not appear on any surface.

---

## Surface assignments

| Surface | Intensity |
|---|---|
| Leaf agent output prose | `full` |
| Orchestrator sequencing prose (wave ordering, `blocked_by`, gate sequences) | `lite` maximum |
| Evidence surfaces | `none` — compression forbidden |

See [[evidence-surfaces]] for the definition of evidence surfaces.

See [[../requirements/token-economy-r-002-intensity-level-is-bounded-per-surface|R-002]] for the normative statement.
