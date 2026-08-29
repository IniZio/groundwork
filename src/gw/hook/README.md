# gw hook layer

TypeScript implementations of every groundwork hook, dispatched through `gw hook <name>`.

## Hook name → registered path mapping

| Hook name | hooks.json command | TypeScript source |
|---|---|---|
| `stop-gate` | `hooks/stop-gate.mjs` | `src/gw/hook/stop-gate.ts` |
| `session-reminder` | `hooks/session-start` | `src/gw/hook/session-reminder.ts` |
| `nesting-guard` | `hooks/nesting-guard.mjs` | `src/gw/hook/nesting-guard.ts` |
| `agent-model-guard` | `hooks/agent-model-guard.mjs` | `src/gw/hook/agent-model-guard.ts` |
| `orchestrator-impl-guard` | `hooks/orchestrator-impl-guard.mjs` | `src/gw/hook/orchestrator-impl-guard.ts` |
| `ledger-guard` | `hooks/ledger-guard.mjs` | `src/gw/hook/ledger-guard.ts` |
| `ledger-bash-guard` | `hooks/ledger-bash-guard.mjs` | `src/gw/hook/ledger-bash-guard.ts` |
| `piped-exit-code-guard` | `hooks/piped-exit-code-guard.mjs` | `src/gw/hook/piped-exit-code-guard.ts` |
| `struggle-detector` | `hooks/struggle-detector.mjs` | `src/gw/hook/struggle-detector.ts` |

## Shim strategy

Each `hooks/*.mjs` (and `hooks/session-start`) is a thin Node shim with two execution paths:

1. **Compiled binary** (`dist/gw`): if `dist/gw` exists, invoke it as `dist/gw hook <name>`. This
   is the production path after `pnpm run build:gw`.
2. **Bun source fallback**: if `dist/gw` is absent, invoke `bun src/gw/cli/main.ts hook <name>`.
   This is the development path (no build step required, bun must be installed).

Both paths read stdin, dispatch through `HOOKS[name]`, and write stdout/stderr before exiting.

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
