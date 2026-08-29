---
id: "token-economy-r-004"
title: "Negation and scope words are preserved"
concept: "[[token-economy/index]]"
criticality: must
verification: unverified
ears_pattern: Ubiquitous
verification_method: Automated
status: open
source: "token-economy#D-1"
---

## Statement

Compression **shall** never remove `not`, `never`, `no`, `only`, or `except` from any prose, regardless of intensity level.

## Why

These words invert or bound the scope of a claim. Removing `not` from "must not delegate" produces "must delegate" — the opposite instruction. Flipping a negation costs more than any token saved; no token budget justifies it.

## Fit criterion

A diff of any agent output shows no removal of `not`, `never`, `no`, `only`, or `except` from an existing sentence. New sentences may omit them if the claim is positive; existing negations are inviolable.

## Verification procedure

**Automated** — a grep guard over changed files flags any hunk that removes a line containing a negation word and does not restore it in the replacement.
