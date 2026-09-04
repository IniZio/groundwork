# gw hook layer

TypeScript implementations of every groundwork hook, dispatched through `gw hook <name>`.

## Hook name → registered path mapping

| Hook name | hooks.json command | TypeScript source |
|---|---|---|
| `stop-gate` | `${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook stop-gate` | `src/gw/hook/stop-gate.ts` |
| `session-reminder` | `hooks/session-start` | `src/gw/hook/session-reminder.ts` |
| `nesting-guard` | `${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook nesting-guard` | `src/gw/hook/nesting-guard.ts` |
| `agent-model-guard` | `${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook agent-model-guard` | `src/gw/hook/agent-model-guard.ts` |
| `orchestrator-impl-guard` | `${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook orchestrator-impl-guard` | `src/gw/hook/orchestrator-impl-guard.ts` |
| `ledger-guard` | `${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook ledger-guard` | `src/gw/hook/ledger-guard.ts` |
| `ledger-bash-guard` | `${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook ledger-bash-guard` | `src/gw/hook/ledger-bash-guard.ts` |
| `piped-exit-code-guard` | `${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook piped-exit-code-guard` | `src/gw/hook/piped-exit-code-guard.ts` |
| `struggle-detector` | `${CLAUDE_PLUGIN_ROOT}/bin/gw-hook hook struggle-detector` | `src/gw/hook/struggle-detector.ts` |

## Dispatch strategy

`bin/gw-hook hook <name>` is the registered command for all TypeScript-ported guards. It reads
stdin, resolves the hook by name from `src/gw/hook/`, and writes stdout/stderr before exiting.
Two execution paths:

1. **Compiled binary** (`dist/gw`): if `dist/gw` exists, invoke it as `dist/gw hook <name>`. This
   is the production path after `pnpm run build:gw`.
2. **Bun source fallback**: if `dist/gw` is absent, invoke `bun src/gw/cli/main.ts hook <name>`.
   This is the development path (no build step required, bun must be installed).

The legacy `hooks/*.mjs` shims for the seven ported guards (stop-gate, nesting-guard,
agent-model-guard, orchestrator-impl-guard, ledger-guard, ledger-bash-guard, piped-exit-code-guard)
were deleted in wave 2 of the groundwork-hardening motive. `hooks/session-start` remains as a
standalone shim. `struggle-detector` is registered via `bin/gw-hook` in hooks.json like all other
TypeScript-ported guards; `hooks/struggle-detector.mjs` exists on disk but is not the live entrypoint.

## stop-gate: new-layout vs legacy precedence

`stop-gate.ts` reads run-ledger state in two phases, new-layout first:

1. **New-layout store** (`.groundwork/next/`): `bySession(sessionId)` from `src/gw/store/slice`
   returns slices indexed under `.groundwork/next/motives/*/slices/`. `readGate(repoRoot, tracker, motive, sessionId)` from
   `src/gw/store/gate` reads the advisor gate note from `.groundwork/next/motives/<slug>/gates/<session>.md`.
   If the active unit and its pacing state are readable via the new-layout path, the stop-gate uses
   them exclusively.

2. **Legacy JSON ledger** (`.groundwork/runs/<sessionId>.json` or `.groundwork/run.json`): falls
   back to this when no new-layout session is found (`bySession()` returns null / throws). The
   legacy path reads the flat ledger JSON directly and applies identical stop/pacing semantics.

The two paths must produce identical observable behavior — the same block/pass decision and the
same stdout JSON — for equivalent ledger state. This is validated by `test/gw/hook/corpus-replay.test.ts`.

`session-reminder.ts` is currently a delegation stub that forks `hooks/session-reminder.mjs` (the
legacy implementation) via `spawnSync`. It preserves the existing behaviour while keeping the new
dispatch layer compilable. A full port replaces the spawnSync body with native TypeScript logic and
removes the `LEGACY_MJS` reference.
