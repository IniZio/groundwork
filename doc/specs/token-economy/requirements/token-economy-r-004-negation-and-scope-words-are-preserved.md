---
id: token-economy-r-004
type: requirement
concept: C-TOKEN-ECONOMY
title: "Negation and scope words are preserved"
criticality: must
verification: automated
status: open
---

## TOKEN-ECONOMY-R-004 — Negation and scope words are preserved {#token-economy-r-004}

Compression **shall** never remove `not`, `never`, `no`, `only`, or `except` from any prose, regardless of intensity level.

- **Why** — These words invert or bound the scope of a claim. Removing `not` from "must not delegate" produces "must delegate" — the opposite instruction. Flipping a negation costs more than any token saved; no token budget justifies it.
- **Fit criterion** — A diff of any agent output shows no removal of `not`, `never`, `no`, `only`, or `except` from an existing sentence. New sentences may omit them if the claim is positive; existing negations are inviolable.
- **Verification**: automated — `hooks/prose-negation-guard.mjs` (PreToolUse) intercepts Edit/Write/MultiEdit calls on prose files, uses sentence-similarity via `hooks/lib/prose-helpers.mjs` (Jaccard ≥ 0.4) to align old/new sentences, and fires an advisory when a negation word (`not`, `never`, `no`, `only`, `except`) is removed from a matched sentence. Covered by `test/hooks/prose-guard-helpers-parity.test.ts` (`@verifies TOKEN-ECONOMY-R-004`), which runs the real guard entry point as a child process and asserts it fires on negation removal in `.md` files and passes through code files and wholesale rewrites below the similarity threshold.
- **Criticality**: must
