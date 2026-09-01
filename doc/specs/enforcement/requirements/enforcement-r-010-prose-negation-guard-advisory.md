---
id: enforcement-r-010
type: requirement
concept: C-ENFORCEMENT
title: Prose-negation-guard warns when negation words are removed from surviving sentences
status: implemented
verification: unverified
criticality: should
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-010 — Prose-negation-guard warns when negation words are removed from surviving sentences {#enforcement-r-010}

If an Edit, Write, or MultiEdit call would remove the words `not`, `never`, `no`, `only`, or `except` from a sentence that survives the edit (≥40% vocabulary overlap between old and new sentence), then the enforcement hook **shall** emit an advisory allow response identifying the affected sentence and the removed negation word; the hook **shall not** deny the write; wholesale rewrites where vocabulary overlap falls below 40% **shall** pass through without advisory.

- **Why** — Caveman compression that drops "must not" to "must" inverts the instruction's meaning. In CLAUDE.md, skill files, and spec requirements, negation-bearing sentences carry safety semantics that determine orchestrator behaviour ("MUST NOT implement", "NEVER block"). A hook that merely fires on detection — without blocking — gives the model a write-time prompt to review the edit while avoiding false positives on complete rewrites where sentence identity cannot be matched. The 40% vocabulary threshold is documented in `hooks/lib/prose-helpers.mjs`; it is a deliberate design cliff, not a bug.
- **Fit criterion** — Running the hook with an Edit whose `old_string` contains "you must not delegate this" and `new_string` contains "you must delegate this" returns an allow response with `permissionDecisionReason` naming `not` as removed and citing the sentence. Running with a complete rewrite of the same sentence (below 40% overlap) returns empty stdout and exit 0.
- **Verification**: unverified — the hook is tested in `test/hooks/prose-negation-guard.test.ts`.
- **Criticality**: should
