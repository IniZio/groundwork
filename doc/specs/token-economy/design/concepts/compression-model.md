---
tags: [concept, token-economy]
---

# Compression Model

Compression in groundwork operates at the **word and sentence level**, not the idea level.

The goal is to remove tokens that add no information to the receiving agent's reasoning, not to shorten the set of claims being made. Every claim, every qualifier, every negation must survive.

---

## What compression targets

| Category | Examples | Rationale |
|---|---|---|
| Articles | `a`, `an`, `the` | Highest-frequency zero-information tokens |
| Filler words | `just`, `really`, `basically`, `actually`, `simply` | Add hedging without adding confidence signal |
| Pleasantries | `happy to help`, `great question`, `of course` | Social lubricant; meaningless between agents |
| Hedging-as-padding | `I think` (as opener), `it seems like` (without intent) | Uncertainty openers that carry no calibrated estimate |
| Tool-call narration | `Let me read the file`, `I'll now check` | Pre-announces what the tool call already shows |
| Preamble | Progress notes before the first tool call | Context the receiver already has |
| Decorative tables | Tables added for visual structure without data | Structure noise |
| Standalone emoji | Used decoratively rather than semantically | Zero token saving; visual noise for agent consumers |

## What compression does not touch

- Claims and their supporting evidence
- Negations and scope words (inviolable — see [[../requirements/token-economy-r-004-negation-and-scope-words-are-preserved|R-004]])
- Modal hedges (confidence is content — see [[../requirements/token-economy-r-005-modality-is-preserved|R-005]])
- Evidence surfaces (forbidden zones — see [[../requirements/token-economy-r-003-compression-is-forbidden-on-evidence-surfaces|R-003]])
- Domain vocabulary (`AC`, `TBD`, `TBR` — see [[../requirements/token-economy-r-006-no-invented-abbreviations-domain-vocabulary-preserved|R-006]])

## Sentence fragments

At `full` intensity, sentence fragments are permitted where meaning is clear. The fragment must preserve the full claim; only the grammatical scaffolding (subject, verb, copula) may be dropped when the reader can reconstruct it from context.
