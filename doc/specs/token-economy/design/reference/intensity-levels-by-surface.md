---
tags: [reference, token-economy]
---

# Intensity Levels by Surface — Reference

Quick-lookup table for every groundwork surface and its compression assignment.

---

## Surface table

| Surface | Intensity | Drop articles | Fragments | Drop conjunctions | Drop filler |
|---|---|---|---|---|---|
| Leaf agent output prose | `full` | yes | permitted | no | yes |
| Orchestrator sequencing prose | `lite` max | no | no | no | yes |
| Wave-ordering lists | `lite` max | no | no | no | yes |
| `blocked_by` field values | `lite` max | no | no | no | yes |
| Gate sequences in `CLAUDE.md` | `lite` max | no | no | no | yes |
| Advisor citations | `none` (frozen) | frozen | frozen | frozen | frozen |
| Ledger entries | `none` (frozen) | frozen | frozen | frozen | frozen |
| Gate evidence blocks | `none` (frozen) | frozen | frozen | frozen | frozen |
| Test output | `none` (frozen) | frozen | frozen | frozen | frozen |
| `file:line` references | `none` (frozen) | frozen | frozen | frozen | frozen |
| Error messages | `none` (frozen) | frozen | frozen | frozen | frozen |
| Code blocks | `none` (frozen) | frozen | frozen | frozen | frozen |

## Guard rails — apply at all intensity levels

| Guard | Forbidden action |
|---|---|
| Negation words | Remove `not`, `never`, `no`, `only`, `except` |
| Modality | Upgrade `may`/`could`/`might`/`sometimes`/`appears to` → `will`/`does`/`always`/`is` |
| Invented abbreviations | Introduce `cfg`, `fn`, `req`, `impl` (as abbreviation) |
| Domain vocabulary | Expand `AC`/`TBD`/`TBR` or contract them further |

## Globally forbidden

`ultra` intensity (strip conjunctions) — banned on all surfaces.
