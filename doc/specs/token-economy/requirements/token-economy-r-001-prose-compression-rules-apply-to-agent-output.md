---
id: "token-economy-r-001"
title: "Prose compression rules apply to agent output"
concept: "[[token-economy/index]]"
criticality: must
verification: unverified
ears_pattern: Ubiquitous
verification_method: Automated
status: open
source: "token-economy#D-1"
---

## Statement

Agent output prose **shall** apply the following compression rules sourced from the caveman project: drop definite and indefinite articles; drop filler words (`just`, `really`, `basically`, `actually`, `simply`); drop pleasantries (`happy to help`, `great question`, `of course`); drop hedging-as-padding (hedges that carry no information, such as `I think` or `it seems like` used as sentence openers without intent); allow sentence fragments; prefer shorter synonyms (`use` over `utilise`, `fix` over `remediate`); omit tool-call narration (`Let me read the file`); omit preamble and progress notes before or between tool calls; omit decorative tables and emoji; quote the shortest decisive line rather than dumping a log excerpt.

## Why

These rules target the highest-frequency token sources (articles, filler, narration) that add no information to the receiving agent's reasoning. Removing them reduces input-token cost without changing any claim.

## Fit criterion

A diff of any agent output prose shows no articles, no filler words from the enumerated set, no tool-call narration, no opening preamble, and no decorative tables or standalone emoji.

## Verification procedure

**Automated** — enforced by parity test asserting guard-rail text is present in every regenerated agent definition; a mirror tree cannot drift silently.
