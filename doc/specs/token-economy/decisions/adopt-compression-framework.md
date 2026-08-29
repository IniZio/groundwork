---
id: "token-economy#D-1"
title: "Adopt caveman compression framework for agent output"
status: "accepted"
date: "2026-08-28"
concept: "[[token-economy/index]]"
---

# Decision: Adopt Caveman Compression Framework

## Context

Agent output re-enters the orchestrator's context window on every turn. High-frequency token sources — articles, filler words, pleasantries, tool-call narration, preamble — add no information to the receiving agent's reasoning but consume budget that could instead hold more evidence or a larger fan-out.

Two existing resources apply here: the caveman compression ruleset (word-level drop rules) and ASD-STE100 (a controlled-English standard used in aerospace technical writing that targets similar waste patterns). Both target the same failure mode: verbose prose that dilutes signal density.

## Decision

Adopt the caveman compression framework as the normative model for groundwork agent output. Encode it as a set of drop rules, intensity levels, and guard rails in `doc/specs/token-economy/`. Define three intensity levels (`lite`, `full`, `ultra`) and assign each to an output surface. Ban `ultra` globally — stripping conjunctions makes orchestration sequencing ambiguous.

## Consequences

- Agent definitions and skill files must be authored or reviewed against the compression rules.
- Mirror trees must stay in sync; parity tests enforce the guard-rail text in every regenerated definition.
- Evidence surfaces are declared off-limits for compression; verbatim reproduction is required there.
- ASD-STE100 skill must be at v0.4.0 or later to cover modality preservation and scope-word rules (see token-economy#D-5).

## Related decisions

| Id | Title |
|---|---|
| token-economy#D-2 | Surface-level intensity caps |
| token-economy#D-3 | Evidence surfaces are forbidden zones |
| token-economy#D-4 | No invented abbreviations |
| token-economy#D-5 | ASD-STE100 skill version requirement |
| token-economy#D-6 | Explicit-path git staging in this motive |
