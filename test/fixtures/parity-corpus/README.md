# Parity Corpus — Groundwork Hook Fixtures

> **FROZEN** — Fixture files must not be hand-edited or regenerated. The per-hook capture scripts are guarded to refuse execution when the target hook is a gw shim.

## Purpose

This directory contains a replayable scenario corpus capturing real verdicts from groundwork hooks. It is the ground truth for **AC-3 parity testing**: when legacy `.mjs` hooks are rewritten in Bun/TypeScript, the new implementation must produce identical decisions against every scenario here.

Once legacy hook code is deleted, these verdicts are unrecoverable from source. **The corpus IS the truth record.** Do not delete or hand-edit fixture files.

### PENDING_PORT hooks

Eight hooks exist only as `.mjs` files (not yet ported to the gw TypeScript registry). The parity harness replays these via `node hooks/<name>.mjs` instead of `bun src/gw/cli/main.ts hook <name>`. Remove an entry from `PENDING_PORT_HOOKS` in `test/gw/parity/corpus-loader.ts` once the TypeScript port lands.

Current PENDING_PORT hooks: `spec-guard`, `deslop-guard`, `prose-negation-guard`, `prose-modality-guard`, `doc-read-guard`, `doc-size-guard`, `keyword-router`, `prose-abbreviation-guard`

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

| Hook | Port | Event | Scenarios |
|------|------|-------|-----------|
| agent-model-guard | gw TS | PreToolUse | 6 |
| comment-density-guard | gw TS | PostToolUse | 3 |
| commit-message-guard | gw TS | PostToolUse | 2 |
| deslop-guard | **PENDING** | PostToolUse | 20 |
| doc-read-guard | **PENDING** | PreToolUse | 18 |
| doc-size-guard | **PENDING** | PostToolUse | 18 |
| keyword-router | **PENDING** | SessionStart | 31 |
| ledger-bash-guard | gw TS | PreToolUse | 8 |
| ledger-guard | gw TS | PreToolUse | 8 |
| nesting-guard | gw TS | PreToolUse | 9 |
| orchestrator-impl-guard | gw TS | PreToolUse | 6 |
| piped-exit-code-guard | gw TS | PreToolUse | 8 |
| prose-abbreviation-guard | **PENDING** | PostToolUse | 22 |
| prose-modality-guard | **PENDING** | PostToolUse | 17 |
| prose-negation-guard | **PENDING** | PostToolUse | 13 |
| session-commit-msg-installer | gw TS | SessionStart | 1 |
| session-reminder | gw TS | SessionStart | 4 |
| spec-guard | **PENDING** | PreToolUse | 9 |
| stop-gate | gw TS | Stop | 9 |
| **Total** | | | **212** |

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

### Critical: never assert on source text

Do **not** assert on the source code of the hook implementation — that defeats the purpose of a fixture corpus. Always execute both surfaces and diff verdicts. The corpus is the expected output (ground truth from the legacy implementation).

---

## Key Behavioral Notes

1. **stop-gate exit code is always 0** — both allow and deny exit 0; the verdict is in stdout JSON (`decision: "block"` = deny, `continue: true` = allow).
2. **orchestrator-impl-guard is non-blocking** — it uses `additionalContext` warn rather than a hard deny; decision label is `WARN`.
3. **agent-model-guard injects missing model** — when a model field is absent it injects the correct model into the returned `tool_input`; decision label is `INJECT`.
4. **ledger `add` is NOT a mutating command in ledger-bash-guard** — only `init|set|complete|gate|abandon|autopilot|rm|scope-token` are treated as mutations; `add` passes through.
