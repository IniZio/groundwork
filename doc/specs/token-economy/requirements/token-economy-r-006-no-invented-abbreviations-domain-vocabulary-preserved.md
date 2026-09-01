---
id: token-economy-r-006
type: requirement
concept: C-TOKEN-ECONOMY
title: "No invented abbreviations; domain vocabulary preserved"
criticality: must
verification: unverified
status: open
---

## TOKEN-ECONOMY-R-006 — No invented abbreviations; domain vocabulary preserved {#token-economy-r-006}

Compression **shall not** introduce ad-hoc abbreviations or contractions (`cfg`, `fn`, `req`) as substitutes for their full forms. Groundwork's existing domain vocabulary (`AC`, `TBD`, `TBR`) **shall** be left unchanged — neither expanded nor further contracted.

- **Why** — Ad-hoc abbreviations save no tokens: the tokenizer splits `cfg` and `config` identically, so the substitution provides zero saving while imposing a real decode cost on the reader. Domain vocabulary (`AC`, `TBD`, `TBR`) is defined terms-of-art with stable meaning in `doc/specs/` and the motive corpus; expanding or contracting them changes search recall and breaks requirement tracing.
- **Fit criterion** — A diff shows no introduced instances of `cfg`, `fn`, `req`, `impl` (when used as abbreviation for implementation), or other ad-hoc contractions. Existing uses of `AC`, `TBD`, `TBR` are unchanged.
- **Verification**: unverified — a grep guard over changed files flags newly introduced instances of the prohibited abbreviation set; a separate guard flags any diff that expands `AC`, `TBD`, or `TBR` to their full forms.
- **Criticality**: must
