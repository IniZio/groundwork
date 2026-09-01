---
id: pacing-r-003
type: requirement
concept: C-ENFORCEMENT
title: `ledger complete` is never blocked by pacing
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## PACING-R-003 — `ledger complete` is never blocked by pacing {#pacing-r-003}

When `ledger complete` is invoked for any slice, the ledger CLI **shall** record the completion without restriction, regardless of pacing state or budget exhaustion.

- **Why** — Refusing to record finished work would be a lie in the ledger (violates P-B). A slice that is genuinely done must be recorded as complete regardless of whether the session has exceeded its pace budget; blocking `complete` would strand the audit trail and prevent the advisor gate from reading accurate state. Pacing blocks *starting* new units of work; it never reverses or suppresses work that already happened. Pacing gates *starting* units of work via `claim` and `set --status in_progress` only; `add` and `complete` are deliberately ungated (P-B: refusing to record finished work would falsify the ledger).
- **Fit criterion** — With pacing budget exhausted (`resolved_units >= budget + grant.range`), invoking `ledger complete <id>` for any slice exits 0 and sets that slice's status to `complete` in the ledger.
- **Verification**: unverified — with pacing budget exhausted, invoke `ledger complete <id>` and confirm exit 0 and the slice's status reads `complete`.
- **Criticality**: must
