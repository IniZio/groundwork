---
id: enforcement-r-012
type: requirement
concept: C-ENFORCEMENT
title: Doc-read-guard enforces toc-first access for over-budget doc-class files
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-012 — Doc-read-guard enforces toc-first access for over-budget doc-class files {#enforcement-r-012}

If a Read tool call targets a doc-class file that exceeds its class token budget and no `doc toc` command has been issued for that path this session, then the enforcement hook **shall** deny it and instruct the caller to run `doc toc <path>` first; if a Bash tool call would `cat` or `head` a doc-class file over budget without a prior toc record for that session, then the enforcement hook **shall** deny it and instruct the caller to run `doc show <path>`; Grep calls **shall** always pass through; the hook **shall** record a toc as issued when it observes a Bash command matching the `doc toc <path>` pattern, enabling subsequent Read calls to pass through for that session.

- **Why** — Reading a large design document verbatim dumps its full token count into the orchestrator's context, consuming reasoning capacity for the rest of the session on raw bytes that a structured `toc + section` access would have provided at a fraction of the cost. The progressive-disclosure contract (toc first, then targeted sections) is the mechanism that keeps CLAUDE.md's "context protection" rules enforceable: without the gate, orchestrators routinely load multi-thousand-token files when one section was sufficient. Grep is pass-through because it returns only matching lines, not the full file content.
- **Fit criterion** — Running the hook with a Read payload targeting a doc-class file known to exceed its budget and no session toc record returns deny with "doc toc <path>" in the reason. After simulating a session toc record for that path (via a Bash payload matching `doc toc <path>`), re-running the Read returns passthrough. A Grep call on the same file always returns passthrough.
- **Verification**: unverified — the hook is tested in `test/hooks/doc-read-guard.test.ts`.
- **Criticality**: must
