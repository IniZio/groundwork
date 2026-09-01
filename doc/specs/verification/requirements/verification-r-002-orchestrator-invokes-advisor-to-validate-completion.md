---
id: "verification-r-002"
type: requirement
concept: C-VERIFICATION
title: "Orchestrator invokes advisor to validate completion"
criticality: must
verification: manual
status: open
---

## VERIFICATION-R-002 — Orchestrator invokes advisor to validate completion {#verification-r-002}

When a non-trivial task is complete, the orchestrator **shall** invoke the advisor (native `advisor()` tool, or `groundwork:advisor` if unavailable) to validate that the work is genuinely complete in the real world.

- **Why** — Tests passing and slices marked complete establish internal consistency, not real-world validity. A working API must be tested against a real server; a UI change must be pixel-checked against the design; a PR must be CI-watched to completion. The advisor executes these checks itself rather than trusting self-reports. This requirement captures the orchestrator's explicit obligation to perform that validation step, not to treat green tests as sufficient evidence of done.
- **Fit criterion** — Review the orchestrator's session transcript after a completed non-trivial task and confirm the advisor was invoked (via `advisor()` or a Task call to `groundwork:advisor`) before the session ended, and that the advisor performed real-world verification commands rather than accepting a self-report.
- **Verification**: manual — 
  1. At the end of a non-trivial session, open the session transcript.
  2. Search for an `advisor()` call or a `Task(subagent_type="groundwork:advisor", …)` call. Confirm it appears before the final session-end message.
  3. In the advisor's response, confirm that at least one real-world verification command was executed (e.g. `npx vitest run`, `node hooks/spec-lint.mjs`, a live API call, or a browser check) rather than a self-report.
  4. If both conditions hold, the requirement is satisfied for that session.

  See also: [[verification-r-001-stop-hook-blocks-session-end-while-slices-incomplete|R-001]]
- **Criticality**: must
