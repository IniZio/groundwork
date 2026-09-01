---
id: enforcement-r-013
type: requirement
concept: C-ENFORCEMENT
title: Doc-size-guard emits advisory when doc-class file exceeds budget without structure
status: implemented
verification: unverified
criticality: should
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-013 — Doc-size-guard emits advisory when doc-class file exceeds budget without structure {#enforcement-r-013}

If a Write, Edit, or MultiEdit results in a doc-class file that exceeds its class token budget AND is missing a summary header or section anchors, then the enforcement hook **shall** emit a violation message to stdout naming the path, class, measured tokens, budget, and the missing structural element; the hook **shall not** block the write (PostToolUse hooks cannot deny tool calls).

- **Why** — The `doc-read-guard`'s progressive-disclosure path relies on section anchors being present to make targeted reads useful. A doc-class file that grows over budget without anchors cannot be read efficiently: every Read is denied until a toc is run, but the toc output itself is unhelpful without anchors to target. The size guard provides a write-time signal that the file needs structural work before the next reader encounters it.
- **Fit criterion** — Writing a doc-class file that exceeds its class budget with no `## Summary` header and no `###`-level section anchors produces a non-empty stdout violation message from the PostToolUse hook, naming the path and the measured vs. budget token counts. Writing an under-budget doc-class file produces no output.
- **Verification**: unverified — the hook is tested in `test/hooks/doc-size-guard.test.ts`.
- **Criticality**: should
