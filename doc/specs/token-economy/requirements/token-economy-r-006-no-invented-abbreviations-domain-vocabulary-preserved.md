---
id: token-economy-r-006
type: requirement
concept: C-TOKEN-ECONOMY
title: "No invented abbreviations; domain vocabulary preserved"
criticality: must
verification: automated
status: open
---

## TOKEN-ECONOMY-R-006 — No invented abbreviations; domain vocabulary preserved {#token-economy-r-006}

Compression **shall not** introduce ad-hoc abbreviations or contractions (`cfg`, `fn`, `req`) as substitutes for their full forms. Groundwork's existing domain vocabulary (`AC`, `TBD`, `TBR`, `impl`) **shall** be left unchanged — neither expanded nor further contracted. (D-4: these four are defined terms-of-art; `impl` is preserved domain vocabulary, not a prohibited abbreviation.)

- **Why** — Ad-hoc abbreviations save no tokens: the tokenizer splits `cfg` and `config` identically, so the substitution provides zero saving while imposing a real decode cost on the reader. Domain vocabulary (`AC`, `TBD`, `TBR`, `impl`) is defined terms-of-art with stable meaning in `doc/specs/` and the motive corpus; expanding or contracting them changes search recall and breaks requirement tracing.
- **Fit criterion** — A diff shows no introduced instances of `cfg`, `fn`, `req`, or other ad-hoc contractions. Existing uses of `AC`, `TBD`, `TBR`, `impl` are unchanged — neither expanded to their full English forms nor further contracted.
- **Verification**: automated — `hooks/prose-abbreviation-guard.mjs` (PreToolUse, Edit/Write/MultiEdit on prose surfaces) fires in two directions: (1) contraction — new content introduces a prohibited standalone abbreviation (`cfg`, `fn`, `req`); (2) expansion — new content replaces domain vocabulary (`AC`, `TBD`, `TBR`, `impl`) with its full English form without retaining the short form. Test: `test/hooks/prose-abbreviation-guard.test.ts` (`@verifies TOKEN-ECONOMY-R-006`).
- **Criticality**: must
