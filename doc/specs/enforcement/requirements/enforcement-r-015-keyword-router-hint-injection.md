---
id: enforcement-r-015
type: requirement
concept: C-ENFORCEMENT
title: Keyword-router injects deterministic routing hints for user prompts
status: implemented
verification: unverified
criticality: should
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-015 — Keyword-router injects deterministic routing hints for user prompts {#enforcement-r-015}

If a UserPromptSubmit payload is authored by the human (not identified as a harness-injected turn), and the prompt text matches one or more registered routing patterns, then the enforcement hook **shall** inject a `[GROUNDWORK ROUTING]` system-reminder naming the matched agent type and routing instruction; if the prompt is identified as a non-user harness turn (beginning with `[SYSTEM NOTIFICATION`, `<task-notification>`, `<local-command-stdout>`, or `<context_window_compaction>`), then the hook **shall** suppress all routing hints and return an unmodified passthrough.

- **Why** — Without deterministic routing hints, the orchestrator relies solely on attention and pattern-matching to pick the correct specialist — a capability that degrades under context pressure and compaction. A harness-injected turn suppression rule is required because system notifications and task completions share the UserPromptSubmit event and could trigger spurious routing hints on non-user content, creating false-positive specialist redirects that interrupt legitimate automation flows.
- **Fit criterion** — Running the hook with a UserPromptSubmit payload whose prompt contains "this is broken, it doesn't work" returns a system-reminder injection containing a hint pointing to the diagnose skill and `groundwork:general-purpose`. Running with `[SYSTEM NOTIFICATION: run complete]` as the prompt returns empty stdout and exit 0.
- **Verification**: unverified — the hook is tested in `test/hooks/keyword-router.test.ts`.
- **Criticality**: should
