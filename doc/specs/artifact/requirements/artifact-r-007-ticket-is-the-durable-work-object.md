---
id: "artifact-r-007"
title: "Ticket is the durable work object"
concept: "[[artifact/index]]"
criticality: must
verification: unverified
ears_pattern: IF-THEN
verification_method: Test
design: "[[design/components/run-ledger-slice]]"
status: open
source: "groundwork-development#D-32"
---

## Statement

A groundwork ticket shall be a markdown document with the following required top-level sections in this order: Question, Context, Evidence, Decision, Ruled out, Revisions, Links. Each section shall be rendered as an H2 heading with an empty body when the ticket is first created, leaving the body for the author to fill. The run-ledger `Slice` schema shall accept an optional `ticket` field (string) naming the ticket id that this slice delivers against.

## Why

Slices are session-scoped scheduling projections that disappear when a run ledger is no longer active; a ticket is the cross-session artifact that carries the question, the evidence gathered, and the decision reached. Without a canonical document shape, tickets written by different authors or tools diverge structurally and cannot be machine-parsed for open-section reporting or MAP.md rendering.

## Fit criterion

A freshly created ticket file contains exactly the seven H2 headings (Question, Context, Evidence, Decision, Ruled out, Revisions, Links) with empty bodies; `ledger add s1 --ticket tkt-1` records `ticket: "tkt-1"` on slice `s1`; `ledger view` displays the ticket id alongside the slice; a ledger with no `ticket` fields on any slice continues to function without error (back-compat).

## Verification procedure

Automated — the ticket template renderer enforces the section set; the ledger schema accepts but does not require the `ticket` field; regression tests cover creation, linkage, and back-compat cases.
