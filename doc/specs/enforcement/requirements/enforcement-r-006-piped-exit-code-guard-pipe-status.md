---
id: enforcement-r-006
type: requirement
concept: C-ENFORCEMENT
title: Piped-exit-code-guard blocks reading $? after piping through a filter
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-006 — Piped-exit-code-guard blocks reading $? after piping through a filter {#enforcement-r-006}

If a Bash command reads `$?` after piping the output of a preceding command through a filter (`head`, `tail`, `grep`, `sort`, `uniq`, `wc`, `cut`, `awk`, or `sed`), then the enforcement hook **shall** deny the command and advise the caller to use `${PIPESTATUS[0]}` or to restructure the command to avoid the pipe.

- **Why** — `$?` after a pipe captures the last pipeline element's exit code — the filter — not the upstream command's. Filter commands almost always exit 0, so the `$?` check is a silent no-op that masks upstream failures. This class of bug caused a real masked failure in this codebase: a `tsc` invocation piped through `tail` reported success while `tsc` was actually exiting 1, blocking detection indefinitely across multiple sessions (documented in the `pipe-to-tail-hides-exit-code` session memory note).
- **Fit criterion** — Running the hook with `{"tool_name":"Bash","tool_input":{"command":"npm test | head -5; echo $?"}}` returns a deny with `permissionDecision:"deny"` and a reason citing `${PIPESTATUS[0]}`. Verified against live hook:
  
  ```
  $ echo '{"tool_name":"Bash","tool_input":{"command":"npm test | head -5; echo $?"}}' \
      | CLAUDE_PLUGIN_ROOT=. bin/gw-hook hook piped-exit-code-guard
  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
  "permissionDecisionReason":"This command reads $? after piping through a filter
  (head/tail/grep/sort/uniq/wc/cut/awk/sed). $? captures the last pipeline element —
  the filter — not the upstream command. Filter commands almost always exit 0, so the
  check is a silent no-op. Remedies: (1) use ${PIPESTATUS[0]} to read the first
  command's exit status; (2) drop the pipe and capture a count: n=$(cmd | wc -l);
  echo $n."}}
  EXIT: 0
  ```
  
  Running with `{"tool_name":"Bash","tool_input":{"command":"npm test; echo $?"}}` (no pipe) returns empty stdout and exit 0.
- **Verification**: unverified — the hook is tested in `test/hooks/piped-exit-code-guard.test.ts`.
- **Criticality**: must
