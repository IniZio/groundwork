# Pi plugin

Groundwork's **only compiled-TypeScript Pi extension**. Everything under `pi/` is the oh-my-pi / pi-coding-agent surface: tools, slash commands, session handlers, and custom model providers.

## How it loads

`package.json` declares:

```json
"pi": {
  "extensions": ["./pi/pi.ts"],
  "skills": ["./.pi/skills"]
}
```

- **Entry:** `./pi/pi.ts` (default export `function (pi: ExtensionAPI)`).
- This is the **only** compiled-TS extension in the package. Other host platforms ship static `.<platform>-plugin/plugin.json` (or equivalent) layouts — they do not go through this TS entry.

## Folder layout

```
pi/
├── pi.ts              # Extension entry: registers tools, commands, handlers, providers
├── pi-commands/       # Slash-command factories consumed by pi.registerCommand(...)
│   ├── goal.ts        # /goal — check or manage the active project goal
│   └── handoff.ts     # /handoff — build a handoff prompt for a new session
└── pi-tools/          # Tool factories consumed by pi.registerTool(...)
    ├── deps.ts        # Shared PiToolDeps ({ directory }) for tool factories
    ├── handoff-session.ts  # handoff_session tool
    └── set-goal.ts         # set_goal tool
```

## Registered surface

Exact counts from `pi/pi.ts` (do not drift without updating this doc):

| Kind | Count | Registration API |
|------|------:|------------------|
| Tools | **2** | `pi.registerTool(...)` |
| Commands | **2** | `pi.registerCommand(...)` |
| Event handlers | **4** | `pi.on(...)` |
| Providers | **3** | `registerGroundworkProviders(pi)` → `pi.registerProvider(...)` in `src/lib/provider-registry.ts` |

### Tools (2)

| Name | Source | Purpose |
|------|--------|---------|
| `handoff_session` | `pi-tools/handoff-session.ts` → `createHandoffSessionTool` | Create a handoff prompt for continuing work in a new session (formatted message + optional `@file` refs). |
| `set_goal` | `pi-tools/set-goal.ts` → `createSetGoalTool` | Manage the active session goal (set / status / pause / resume / achieve / clear); injected into messages as a reminder. |

### Commands (2)

| Name | Source | Purpose |
|------|--------|---------|
| `handoff` | `pi-commands/handoff.ts` → `createHandoffCommand` | Create a handoff prompt for a new session (`buildHandoffInstructions`). |
| `goal` | `pi-commands/goal.ts` → `createGoalCommand` | Check or manage the active project goal (reads via `readGoal` / `formatGoal`). |

### Event handlers (4)

| Event | Purpose |
|-------|---------|
| `session_start` | Sets `runtime.cwd`; calls **`exportSessionEnv(sessionId, directory)`** so hooks see the session. |
| `session_shutdown` | Best-effort warning if an active ledger's advisor gate is not `APPROVE`. |
| `before_agent_start` | Main session only: injects orchestrator hard-rules + bootstrap into the system prompt (skips subagents / already-injected prompts). |
| `context` | Injects goal reminders + subagent bootstrap into message parts; main-session delegation nudge + stop-gate warning when the ledger is ungated. |

### Providers (3)

Registered via `registerGroundworkProviders(pi)` (`src/lib/provider-registry.ts`). Provider keys are for custom model backends registered with Pi; **agents-pi roster entries do not embed `model:` from `model-registry.json`** — they are model-neutral and inherit the OMP/Pi session model.

| Provider name | Role (as documented in registry) |
|---------------|----------------------------------|
| `kimi-for-coding` | Moonshot / Kimi implementation model |
| `opencode-go` | DeepSeek explorer model |
| `cursor-agent` | Cursor proxy → Anthropic (designer model) |

`neuralwatt` is **not** registered here — the separate `pi-neuralwatt` extension owns it.

## Environment exports

Set in the default export of `pi/pi.ts`:

| Variable | Where | Value / effect |
|----------|-------|----------------|
| `PI_SUBAGENTS_EXTRA_AGENTS_DIR` | extension init | Appends `<repo>/agents-pi` (resolved next to `pi/`) so pi-subagents load the **model-neutral** Groundwork agent roster (session-inherited models; no registry `pi` column). Separate from OpenCode/Claude Code agents under `agents/`. |
| `CLAUDE_CODE_SESSION_ID` | `exportSessionEnv` on `session_start` | Current Pi session id (when present). |
| `CLAUDE_PROJECT_DIR` | `exportSessionEnv` on `session_start` | Project directory passed into the extension. |

`exportSessionEnv` is **exported** from `pi/pi.ts` and is load-bearing — do not remove the function or its single `session_start` call site.

## Load-bearing chain (session → ledger)

```
session_start handler
  → exportSessionEnv(sessionId, projectDir)
    → process.env.CLAUDE_CODE_SESSION_ID
    → process.env.CLAUDE_PROJECT_DIR
      → hooks/ledger.mjs resolveSessionId
        → .groundwork/runs/<session_id>.json
```

omp has no `CLAUDE_ENV_FILE`, so this path is how bash-spawned hooks resolve the **per-session** ledger instead of collapsing every session onto the legacy `.groundwork/run.json`.

## CRITICAL invariant — omp `xd://` devices

oh-my-pi (omp) exposes `xd://<name>` tool-devices that are **character-for-character reflections** of Pi extension registrations (tools, commands, handlers, providers).

- **Never strip or rename a registration's identity/description.** Removing a registration deletes the corresponding omp device.
- The **only** proven-dead surface, `pi/pi-commands/agents.ts`, was **already removed** in the `pi/` relocate. Anything else is presumed live until proven dead by **(a)** zero grep usages **and** **(b)** no matching omp `xd://` device description.

### Must preserve in `pi/pi.ts`

- `exportSessionEnv` definition **and** its `session_start` call.
- `PI_SUBAGENTS_EXTRA_AGENTS_DIR` export pointing at `agents-pi/`.
- All `pi.registerTool` / `pi.registerCommand` / `pi.on` / provider registrations (including those delegated through `registerGroundworkProviders`).
