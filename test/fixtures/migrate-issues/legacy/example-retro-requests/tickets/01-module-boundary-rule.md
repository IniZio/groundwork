---
title: Module-boundary rule backed by an existing engine
---

# Module-boundary rule backed by an existing engine

Status: needs-triage
Type: task
Source: peer-a retro, 2026-10-12 (owner's headline ask, rank 1)

## Problem

The app maintains tools/layers: ~450 lines of custom parser code plus tools/layers.tsv. It enforces "module X may use only modules Y via example-crate::" and bans Instant::now/SystemTime::now outside one module.

Gaps:
- No `#[cfg(test)] mod testing;` awareness, so test-only modules get production rules. The fake clock had to be routed through SystemClock.
- A tsv format change (#17) broke a parallel PR's new row (#18), which only CI on the merge ref caught.

## Request

A language-agnostic boundary rule in groundwork/house-rules, with a declarative allow-list per module and test-scope awareness. Back it with an existing engine (ast-grep rules, or per-language adapters such as import-linter, dependency-cruiser or a Cargo crate split), not a per-repo bespoke binary.

Sub-ask: before anyone writes a custom tool, suggest the native linter's ban mechanism (for example lint.toml `disallowed-methods` for the clock ban).
