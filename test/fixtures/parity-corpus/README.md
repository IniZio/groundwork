# Parity Corpus — Groundwork Hook Fixtures

> **FROZEN** — This corpus is a pre-conversion recording from D-10. Fixture files must not be hand-edited or regenerated. The per-hook capture scripts are guarded to refuse execution when the target hook is a gw shim.

## Purpose

This directory contains a replayable scenario corpus capturing real verdicts from the 9 registered groundwork hooks. It is the ground truth for **AC-3 parity testing**: when the legacy `.mjs` hooks are rewritten in Bun/TypeScript, the new implementation must produce identical decisions against every scenario here.

Once the legacy hook code is deleted (D-10), these verdicts are unrecoverable from source. **The corpus IS the truth record.** Do not delete or hand-edit fixture files.

---

## Fixture Format

Each fixture is a JSON file with this schema:

```jsonc
{
  "hook": "<filename>.mjs",
  "hook_path": "hooks/<filename>.mjs",
  "event_type": "PreToolUse" | "PostToolUse" | "Stop" | "SessionStart",
  "scenario_name": "<snake_case_name>",
  "description": "<human-readable description>",
  "env": { "CLAUDE_PROJECT_DIR": "...", "...": "..." },
  "disk_state_setup": [
    { "path": "<relative-to-project-dir>", "content": { /* JSON object */ } }
  ],
  "stdin_payload": { /* JSON fed to the hook via stdin */ },
  "stdout": "...",
  "stderr": "...",
  "exit_code": 0,
  "decision": "PASS" | "DENY" | "ALLOW" | "WARN" | "INJECT" | "SIGNAL" | "NO-SIGNAL" | "BLOCK"
}
```

### Multi-invocation format (struggle-detector only)

struggle-detector scenarios that cross the signal threshold via accumulated calls use an `invocations` array instead of a single `stdin_payload`:

```jsonc
{
  "invocations": [
    { "stdin_payload": { ... }, "stdout": "...", "stderr": "...", "exit_code": 0 },
    ...
  ],
  "decision": "SIGNAL" | "NO-SIGNAL"
}
```

### stop-gate exit codes

stop-gate exits `0` for **both** allow and deny. The decision is in the stdout JSON:
- `{"decision": "block", ...}` → **DENY**
- `{"continue": true, ...}` → **ALLOW**

---

## Re-running Capture

```
node test/fixtures/parity-corpus/capture.mjs
```

> **WARNING:** This re-runs all hooks against freshly-constructed temp dirs and **overwrites** existing fixtures. Only run after a legitimate behavior change to the legacy hooks. Commit the fixtures before and after to diff what changed.

Pass `--dry-run` to forward that flag to each per-hook script without writing files.

---

## Hook × Scenario Audit Table

| Hook | Event | Trigger | Scenarios | ALLOW/PASS | DENY/BLOCK/SIGNAL |
|------|-------|---------|-----------|------------|-------------------|
| agent-model-guard | PreToolUse | Agent\|Task\|TaskCreate | 6 | 1 ALLOW, 1 INJECT | 4 DENY |
| nesting-guard | PreToolUse | Agent\|Task\|TaskCreate | 9 | 1 ALLOW | 8 DENY |
| ledger-guard | PreToolUse | Read\|Edit\|MultiEdit\|Write | 8 | 4 PASS | 4 DENY |
| ledger-bash-guard | PreToolUse | Bash | 8 | 5 PASS | 3 DENY |
| piped-exit-code-guard | PreToolUse | Bash | 8 | 5 PASS | 3 DENY |
| orchestrator-impl-guard | PreToolUse | Edit\|Write\|MultiEdit | 6 | 4 PASS | 2 WARN |
| stop-gate | Stop | — | 9 | 4 ALLOW | 5 BLOCK |
| struggle-detector | PostToolUse | Bash\|Edit\|Write | 6 | 3 NO-SIGNAL | 3 SIGNAL |
| session-reminder | SessionStart | — | 4 | 4 PASS | 0 |
| **Total** | | | **64** | | |

---

## How Future Parity Suite Should Replay (AC-3)

### Replay algorithm

For each fixture file, the parity test MUST:

1. Construct the disk state in a fresh temp dir using `disk_state_setup`.
2. Set env vars from the `env` field, with `CLAUDE_PROJECT_DIR` pointing to the temp dir.
3. Pipe `stdin_payload` (as JSON) to **both** the legacy hook and the new TS/Bun implementation.
4. Parse the output from each and extract the `decision` field.
5. Assert the decisions match.

### Decision assertion — not stdout equality

The parity assertion is on the **decision**, not on exact stdout text. A future implementation may format output differently — that is acceptable. What must match is whether the outcome is ALLOW / DENY / WARN / INJECT / SIGNAL / NO-SIGNAL / etc.

### stop-gate

Parse stdout as JSON and compare the `decision` field:
- `"block"` → DENY
- absent (or `continue: true`) → ALLOW

### struggle-detector multi-call scenarios

Replay each invocation in the `invocations` array in sequence against a **shared** temp dir (state accumulates across calls). After the final invocation, compare `signal_emitted` boolean and `signal_kind`.

### Critical: never assert on source text

Do **not** assert on the source code of the hook implementation — that defeats the purpose of a fixture corpus. Always execute both surfaces and diff verdicts. The corpus is the expected output (ground truth from the legacy implementation).

---

## Key Behavioral Notes

1. **stop-gate exit code is always 0** — both allow and deny exit 0; the verdict is in stdout JSON (`decision: "block"` = deny, `continue: true` = allow).
2. **orchestrator-impl-guard is non-blocking** — it uses `additionalContext` warn rather than a hard deny; decision label is `WARN`.
3. **agent-model-guard injects missing model** — when a model field is absent it injects the correct model into the returned `tool_input`; decision label is `INJECT`.
4. **struggle-detector always exits 0** — PostToolUse hooks cannot block; decision is `SIGNAL` (threshold crossed) or `NO-SIGNAL`.
5. **ledger `add` is NOT a mutating command in ledger-bash-guard** — only `init|set|complete|gate|abandon|autopilot|rm|scope-token` are treated as mutations; `add` passes through.
6. **struggle-detector session_id from stdin, not env** — reads `session_id` from the stdin JSON payload, not from `CLAUDE_SESSION_ID` env var.
