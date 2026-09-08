---
id: token-economy-r-001
type: requirement
concept: C-TOKEN-ECONOMY
title: "Prose compression rules apply to agent output"
criticality: must
verification: unverified
status: open
---

## TOKEN-ECONOMY-R-001 — Prose compression rules apply to agent output {#token-economy-r-001}

Agent output prose **shall** apply the following compression rules sourced from the caveman project: drop definite and indefinite articles; drop filler words (`just`, `really`, `basically`, `actually`, `simply`); drop pleasantries (`happy to help`, `great question`, `of course`); drop hedging-as-padding (hedges that carry no information, such as `I think` or `it seems like` used as sentence openers without intent); allow sentence fragments; prefer shorter synonyms (`use` over `utilise`, `fix` over `remediate`); omit tool-call narration (`Let me read the file`); omit preamble and progress notes before or between tool calls; omit decorative tables and emoji; quote the shortest decisive line rather than dumping a log excerpt.

- **Why** — These rules target the highest-frequency token sources (articles, filler, narration) that add no information to the receiving agent's reasoning. Removing them reduces input-token cost without changing any claim.
- **Fit criterion** — A diff of any agent output prose shows no articles, no filler words from the enumerated set, no tool-call narration, no opening preamble, and no decorative tables or standalone emoji.
- **Verification**: unverified — actual rule application by agents at runtime is discipline-only; no mechanical check can intercept every agent response. A related parity test (`test/hooks/prose-rules-parity.test.ts`) does assert that the output-prose ruleset text (specifically the phrase "Negation and scope words are inviolable") is present in every generated agent definition under `agents/` and `agents-pi/`, catching silent drift between authority sources and mirror trees. That test does not carry a `@verifies TOKEN-ECONOMY-R-001` annotation and does not verify the fit criterion (agent output free of articles, filler, and narration).
- **Criticality**: must
