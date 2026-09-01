---
id: enforcement-r-014
type: requirement
concept: C-ENFORCEMENT
title: Spec-guard warns and permits spec writes when no active ledger exists
status: implemented
verification: unverified
criticality: should
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-014 — Spec-guard warns and permits spec writes when no active ledger exists {#enforcement-r-014}

If an Edit, Write, or MultiEdit targets a path under `doc/specs/` or `docs/steering/` and no active run ledger is found for the current session, then the enforcement hook **shall** emit a WARN to stderr and permit the write (exit 0); when an active ledger is found, the hook **shall** pass through without modification.

Note: the RFC gate that would have blocked spec writes outside a tracked slice was removed in S6. The hook registration is retained as a stub for future re-enable. The current implemented behavior is warn-on-no-ledger only; writes with a ledger present are unconditional passthroughs. New requirements covering a re-enabled gate **shall** supersede this requirement.

- **Why** — Recording a warn-on-no-ledger ensures spec writes that happen outside any active run produce a stderr diagnostic rather than silent success. If the hook were removed entirely, a future RFC gate could not distinguish spec writes during a run from those outside one; the registration and warn path are the minimum viable foothold for that future gate. Cross-repo writes (targeting a path in a different project directory) are a known fail-open path: the relative-path check falls outside the project root, so `isGuarded = false` and the hook passes through without warning.
- **Fit criterion** — Running the hook with an Edit targeting `doc/specs/enforcement/index.md` and no ledger on disk produces a WARN on stderr and exits 0. Running with an Edit to `src/foo.ts` (unguarded path) produces no output and exits 0.
- **Verification**: unverified — the hook is tested in `test/hooks/spec-guard.test.ts`.
- **Criticality**: should
