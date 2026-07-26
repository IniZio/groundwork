# Steering

This directory contains human-authored steering documents for the groundwork project. Steering documents are not normative requirements; they are persistent context injected into agent sessions to orient new agents without re-explanation. They are authored by hand, not auto-generated.

## Contents

- **tech.md** — technology choices, runtime environment, key dependencies, tooling conventions
- **structure.md** — codebase directory layout, naming conventions, where to find things

## Purpose

Steering documents occupy the top-level tier of the §6.3 context budget (1000 tokens). They answer "what is this built with?" and "how is it laid out?" — facts that do not change often and that every agent session needs without having to re-explore the codebase.

## Authoring rules

- Keep each document concise. The combined budget is 1000 tokens.
- Write in the present tense. Describe what is, not what was planned.
- Do not duplicate information captured in the spec tree.
- Update these files when the underlying facts change (dependency upgrade, directory restructure).
