---
id: "agents-skills-r-005"
type: requirement
title: "Enforcement boundary — mechanical vs discipline-only"
concept: C-AGENTS-SKILLS
criticality: should
verification: manual
status: open
---

## AGENTS-SKILLS-R-005 — Enforcement boundary — mechanical vs discipline-only {#agents-skills-r-005}

Documentation of groundwork delegation rules **shall** accurately distinguish between rules that are mechanically enforced by hooks and rules that rely solely on agent discipline: (a) the prohibition on a `junior-orchestrator` relaying its task 1:1 to a single child without decomposition is **not** mechanically enforced — `nesting-guard` cannot observe whether substantive orchestration work occurred before the spawn, and never sees the child's inbound brief; (b) spawn depth beyond the declared maximum is **not** mechanically enforceable — a `PreToolUse` hook has no access to nesting depth or parent agent identity at dispatch time; (c) only the flat type-allowlist topology rules (see [[requirements/agents-skills-r-004-delegation-topology-enforcement|R-004]]) are mechanically enforced. No requirement **shall** assert a mechanical guarantee for a discipline-only rule.

- **Why** — Asserting a mechanical guarantee for an unenforceable rule creates false confidence. An orchestrator or reviewer who believes 1:1 forwarding is blocked by a hook will not audit for it; the defect survives undetected. Stating the boundary honestly ensures that discipline-only rules are treated as design expectations requiring human or agent review, not hook enforcement.
- **Fit criterion** — Two engineers independently reading the delegation documentation can correctly classify the three named rules (1:1-forwarding prohibition, depth limit, type-allowlist) as mechanical or discipline-only without consulting the hook source. No sentence in the spec asserts hook enforcement for a discipline-only rule.
- **Verification**: manual — Inspect `CLAUDE.md` and this spec; confirm language is hedged for discipline-only rules ("relies on agent discipline", "not mechanically enforceable") and uses definitive enforcement language only for hook-backed rules.
- **Criticality**: should
