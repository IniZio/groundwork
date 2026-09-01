---
id: C-SPEC-TOOLING
type: moc
title: Spec Tooling
summary: Invariants, CLI contracts, and coverage model for the spec tooling that enforces corpus integrity.
parent: C-GROUNDWORK
status: draft
---

# Spec Tooling

The spec tooling (`bin/spec`, `hooks/spec.mjs`, `hooks/spec-lint.mjs`, `hooks/lib/spec-io.mjs`, `hooks/lib/verifies-scan.mjs`) maintains a corpus of concept nodes and requirement nodes under `doc/specs/`. It enforces structural invariants so the corpus remains consistent, navigable, and traceable.

This concept is itself unspecified until now. Five self-declared roots and twelve prefix-mismatched requirement files all passed `spec lint` cleanly before the hierarchy invariants were added, demonstrating the cost.

## Requirements

- [SPEC-TOOLING-R-001](requirements/spec-tooling-r-001-concept-node-identification.md) — Concept Node Identification
- [SPEC-TOOLING-R-002](requirements/spec-tooling-r-002-root-singularity.md) — Root Singularity
- [SPEC-TOOLING-R-003](requirements/spec-tooling-r-003-parent-resolution.md) — Parent Resolution
- [SPEC-TOOLING-R-004](requirements/spec-tooling-r-004-cycle-prohibition.md) — Cycle Prohibition
- [SPEC-TOOLING-R-005](requirements/spec-tooling-r-005-parent-field-presence.md) — Parent Field Presence
- [SPEC-TOOLING-R-006](requirements/spec-tooling-r-006-requirement-body-structure.md) — Requirement Body Structure
- [SPEC-TOOLING-R-007](requirements/spec-tooling-r-007-summary-length.md) — Summary Length
- [SPEC-TOOLING-R-008](requirements/spec-tooling-r-008-tree-completeness.md) — Tree Completeness
- [SPEC-TOOLING-R-009](requirements/spec-tooling-r-009-coverage-model.md) — Coverage Model
- [SPEC-TOOLING-R-010](requirements/spec-tooling-r-010-cli-invocation-contract.md) — CLI Invocation Contract

## Known Gap

`enforcement/requirements/` holds `pacing-r-*` (×11) and `seal-r-*` (×1) files whose id prefixes (`PACING`, `SEAL`) disagree with the concept id `C-ENFORCEMENT`. A rule enforcing prefix agreement would immediately red the existing tree. This is noted as a known gap and is not specified as a requirement here.
