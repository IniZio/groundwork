/**
 * src/gw/hook/index.ts — Registry mapping hook names to their TypeScript implementations.
 *
 * Names match the hook IDs registered in hooks/hooks.json command registrations.
 */
import type { HookFn } from './types.js'
import { run as stopGate } from './stop-gate.js'
import { run as sessionReminder } from './session-reminder.js'
import { run as nestingGuard } from './nesting-guard.js'
import { run as agentModelGuard } from './agent-model-guard.js'
import { run as orchestratorImplGuard } from './orchestrator-impl-guard.js'
import { run as ledgerGuard } from './ledger-guard.js'
import { run as ledgerBashGuard } from './ledger-bash-guard.js'
import { run as pipedExitCodeGuard } from './piped-exit-code-guard.js'
import { run as struggleDetector } from './struggle-detector.js'
import { run as commentDensityGuard } from './comment-density-guard.js'

export const HOOKS: Record<string, HookFn> = {
  'stop-gate': stopGate,
  'session-reminder': sessionReminder,
  'nesting-guard': nestingGuard,
  'agent-model-guard': agentModelGuard,
  'orchestrator-impl-guard': orchestratorImplGuard,
  'ledger-guard': ledgerGuard,
  'ledger-bash-guard': ledgerBashGuard,
  'piped-exit-code-guard': pipedExitCodeGuard,
  'struggle-detector': struggleDetector,
  'comment-density-guard': commentDensityGuard,
}
