# Token Economy — Glossary

---

## ASD-STE100

A controlled-English standard developed by the Aerospace and Defence Industries Association of Europe (ASD) for technical documentation. Defines writing rules that reduce ambiguity and translation cost. Groundwork uses it as the upstream authority for prose compression rules covering modality preservation and scope-word handling. Required at v0.4.0 or later (see [[requirements/token-economy-r-007-asd-ste100-skill-is-at-v0-4-0-or-later|R-007]]).

---

## Caveman compression

An informal name for the word-level drop-rule set that removes articles, filler words, pleasantries, hedging-as-padding, tool-call narration, preamble, decorative tables, and standalone emoji from agent output. Does not remove claims, qualifiers, negations, or modal hedges. The name reflects the compressed register: dense, fragment-heavy, stripped of grammatical scaffolding — but semantically complete.

---

## Evidence surface

A zone in agent output where compression is forbidden. Evidence surfaces must be quoted or reproduced verbatim from their source. Enumerated surfaces: advisor citations, ledger entries, gate evidence, test output, `file:line` references, error text, code blocks. See [[design/concepts/evidence-surfaces]].

---

## Intensity level

A named tier of compression strength applied to a specific output surface. Three levels are defined:
- **`lite`** — drop filler only; keep articles, full sentences, conjunctions.
- **`full`** — drop articles; allow fragments; prefer shorter synonyms; omit narration and preamble.
- **`ultra`** — additionally strip conjunctions. **Banned in groundwork.**

See [[design/concepts/intensity-levels]].

---

## Modality hedge

A modal verb or phrase that encodes the author's confidence or conditionality: `may`, `could`, `might`, `sometimes`, `appears to`, `is likely to`. A hedge carries epistemic content; upgrading it to a stronger claim (`will`, `does`, `always`, `is`) changes the meaning of the sentence. Modality is preserved at all intensity levels — see [[requirements/token-economy-r-005-modality-is-preserved|R-005]].

---

## Normative verb

A verb that expresses a requirement's binding force. In groundwork specs, `shall` means mandatory (must-level), `should` means recommended (should-level), and `may` means optional. These verbs are never dropped or weakened by compression.

---

## Scope word

A word that bounds or restricts the applicability of a claim: `not`, `never`, `no`, `only`, `except`. Removing a scope word from an existing sentence changes the claim's meaning, often inverting it entirely. Scope words are inviolable at all intensity levels — see [[requirements/token-economy-r-004-negation-and-scope-words-are-preserved|R-004]].
