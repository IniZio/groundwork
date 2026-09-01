---
id: enforcement-r-008
type: requirement
concept: C-ENFORCEMENT
title: Struggle-detector emits FAILURE journal event on consecutive tool failures
status: implemented
verification: automated
criticality: should
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-008 — Struggle-detector emits FAILURE journal event on consecutive tool failures {#enforcement-r-008}

If consecutive PostToolUse events for the same tool type and file fingerprint (tool + file_path) accumulate at or above the configurable threshold (default: 3, overridable via `GROUNDWORK_STRUGGLE_THRESHOLD`), then the enforcement hook **shall** emit a `FAILURE` journal event recording the kind, fingerprint, and detail; subsequent failures for the same fingerprint within the same session **shall** not re-emit a duplicate signal (deduplication by fingerprint key).

- **Why** — Without the struggle-detector, an orchestrator can loop indefinitely on a failing edit or bash command with no durable record — the session ends with no journal trace of the repeated-failure pattern, and the next session has no signal that the area is stuck. The FAILURE event is the input to human triage and the `escalate-after-3-failures` rule in CLAUDE.md. A session-scoped dedup prevents signal flooding when the orchestrator continues past the threshold.
- **Fit criterion** — Injecting 3 consecutive PostToolUse payloads with non-zero exit_code for the same (Bash, script fingerprint) pair produces exactly one `FAILURE` journal event under `.groundwork/`. A 4th payload for the same fingerprint in the same session produces no additional event. Injecting the 3 payloads for a different fingerprint produces a second `FAILURE` event.
- **Verification**: automated — the hook is tested in `test/hooks/struggle-detector-events.test.ts`.
- **Criticality**: should
