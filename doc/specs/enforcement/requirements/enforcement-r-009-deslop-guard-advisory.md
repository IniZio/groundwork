---
id: enforcement-r-009
type: requirement
concept: C-ENFORCEMENT
title: Deslop-guard emits advisory on AI-fingerprint comment patterns
status: implemented
verification: unverified
criticality: should
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-009 — Deslop-guard emits advisory on AI-fingerprint comment patterns {#enforcement-r-009}

If an Edit, Write, or MultiEdit call contains AI-fingerprint comment patterns (restating comments, AI-opener phrases such as `// Let's`, step-marker comments such as `// Step 1`, commented-out code blocks, or AI emoji inside comments), then the enforcement hook **shall** emit an advisory allow response naming the detected patterns in `permissionDecisionReason`; the hook **shall not** deny the write under any circumstances.

- **Why** — Advisory-only — a PreToolUse hook can block, but slop detection relies on pure regex without AST or semantic context, making false-positive risk too high for a hard block. Slop markers accumulate silently across sessions; the advisory gives the model a write-time prompt to self-correct without blocking real work. The `GROUNDWORK_DESLOP_GUARD=0` env var and the `// deslop:disable` escape hatch allow intentional bypass for files that legitimately contain these patterns.
- **Fit criterion** — Running the hook with a Write payload whose `new_string` contains `// Let's initialize the database` returns an allow response with a non-empty `permissionDecisionReason` naming the slop match. Running with a clean payload returns empty stdout and exit 0.
- **Verification**: unverified — the hook is tested in `test/hooks/deslop-guard.test.ts`.
- **Criticality**: should
