---
id: enforcement-r-004
type: requirement
concept: C-ENFORCEMENT
title: Ledger-guard blocks direct tool access to run-ledger and seal-key files
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-004 — Ledger-guard blocks direct tool access to run-ledger and seal-key files {#enforcement-r-004}

If a Read, Edit, or MultiEdit call targets a path matching the run-ledger pattern (`.groundwork/run.json` or `.groundwork/runs/<id>.json`) or the seal-key pattern (`.groundwork/runs/<id>.seal.key`), then the enforcement hook **shall** deny it for all callers; if a Write call targets the run-ledger path and the caller is identified as a subagent, then the enforcement hook **shall** deny it; Write calls to the run-ledger from the primary orchestrator (not identified as a subagent) **shall** pass through to support the one-shot `ledger init` workflow.

- **Why** — Reading the ledger directly loads the full JSON into the orchestrator's context window, consuming thousands of tokens for every status check instead of the single-line output `ledger status` provides. Editing the ledger bypasses the CLI's file-lock and atomic-write guarantees, creating race conditions with the stop-gate's concurrent reads. Writing the seal key directly allows any caller to forge or invalidate the gate credential without going through the authenticated gate path, which is the stop-gate-token-bypass attack documented in the session memory.
- **Fit criterion** — Running the hook with `{"tool_name":"Read","tool_input":{"file_path":".groundwork/runs/test-session.json"}}` returns a deny response for all callers. Running with `{"tool_name":"Write","tool_input":{"file_path":".groundwork/runs/test-session.json"},"agent_type":"general-purpose"}` (subagent) returns deny. Running the same Write with no `agent_type` or `agent_id` (primary orchestrator) returns passthrough.
- **Verification**: unverified — the hook is tested in `test/hooks/ledger-guard.test.ts`.
- **Criticality**: must
