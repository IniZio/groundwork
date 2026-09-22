/**
 * src/gw/store/run/index.ts — Shared run-ledger store adapter (S84).
 *
 * Provides the single module that reads / writes run ledgers in the new
 * Obsidian-native note layout. Wave-33 slices (S93 ledger.ts, S94 stop-gate.ts)
 * will switch their callers to use this module; in wave 32 no production
 * consumer is switched yet — this module exists to define the contract and
 * make the tests green.
 *
 * PRECEDENCE (loadRun):
 *   1. Gate note + slice notes for sessionId under any motive dir → 'notes'
 *   2. Legacy JSON at .groundwork/runs/<sessionId>.json              → 'legacy-json'
 *   3. null
 *
 * ERROR CODES:
 *   RUN_STORE_MOTIVE_REQUIRED — thrown by initRun when ledger.motive is absent.
 *   RUN_STORE_INVALID_TOKEN   — thrown by saveRun when token mismatch.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_TRACKER_PATH, motiveDir as motiveDirFn } from '../../schema/layout.js'
import { writeSlice, bySession } from '../slice/index.js'
import { writeGate, readGate } from '../gate/index.js'
import type { Slice } from '../../schema/slice.js'
import type { Gate } from '../../schema/gate.js'

export interface LedgerJson {
  session_id: string
  motive: string
  active: boolean
  schema_version?: number
  write_token?: string
  scoped_tokens?: Array<{ scope: string; token: string }>
  awaiting_human?: boolean
  checkpoint_hold?: string
  pacing?: Record<string, unknown>
  base_commit?: string
  brief?: string
  plan_ref?: string
  claimed_by?: string
  slices: Slice[]
  gate?: Partial<Gate> & { seal?: string; [k: string]: unknown }
  [k: string]: unknown
}

export type RunResult = LedgerJson & { source: 'notes' | 'legacy-json' }

export class RunStoreMissingMotiveError extends Error {
  readonly code = 'RUN_STORE_MOTIVE_REQUIRED' as const
  constructor() {
    super('initRun: ledger.motive is required but was absent or empty')
    this.name = 'RunStoreMissingMotiveError'
  }
}

export function legacyFallbackPath(projectDir: string, sessionId: string): string {
  return join(projectDir, '.groundwork', 'runs', `${sessionId}.json`)
}

export function initRun(
  ledger: LedgerJson,
  opts?: { projectDir?: string; tracker?: string },
): void {
  const motive = ledger.motive
  if (!motive || typeof motive !== 'string') {
    throw new RunStoreMissingMotiveError()
  }

  const projectDir =
    opts?.projectDir ?? process.env['CLAUDE_PROJECT_DIR'] ?? process.cwd()
  const tracker = opts?.tracker ?? DEFAULT_TRACKER_PATH

  const mDir = motiveDirFn(projectDir, tracker, motive)
  mkdirSync(mDir, { recursive: true })

  for (const slice of ledger.slices ?? []) {
    if (!slice.id) continue
    writeSlice({ repoRoot: projectDir, tracker, motive, slice, label: slice.id })
  }

  const gate: Gate = {
    session: ledger.session_id,
    motive,
    ...(ledger.active !== undefined ? { active: ledger.active } : {}),
    ...(ledger.write_token !== undefined ? { write_token: ledger.write_token } : {}),
    ...(ledger.scoped_tokens !== undefined ? { scoped_tokens: ledger.scoped_tokens } : {}),
    ...(ledger.awaiting_human !== undefined ? { awaiting_human: ledger.awaiting_human } : {}),
    ...(ledger.checkpoint_hold !== undefined ? { checkpoint_hold: ledger.checkpoint_hold } : {}),
    ...(ledger.pacing !== undefined ? { pacing: ledger.pacing } : {}),
    ...(ledger.base_commit !== undefined ? { base_commit: ledger.base_commit } : {}),
    ...(ledger.brief !== undefined ? { brief: ledger.brief } : {}),
    ...(ledger.plan_ref !== undefined ? { plan_ref: ledger.plan_ref } : {}),
    ...(ledger.claimed_by !== undefined ? { claimed_by: ledger.claimed_by } : {}),
    ...(ledger.gate?.advisor !== undefined ? { advisor: ledger.gate.advisor as Gate['advisor'] } : {}),
    ...(ledger.gate?.verifier !== undefined ? { verifier: ledger.gate.verifier as string } : {}),
    ...(ledger.gate?.qa !== undefined ? { qa: ledger.gate.qa as string } : {}),
    ...(ledger.gate?.phases !== undefined ? { phases: ledger.gate.phases as Gate['phases'] } : {}),
    ...(ledger.gate?.created_at !== undefined ? { created_at: ledger.gate.created_at as string } : {}),
  }

  writeGate({ repoRoot: projectDir, tracker, motive, gate })
}

export function loadRun(opts: {
  projectDir: string
  sessionId: string
  tracker?: string
}): RunResult | null {
  const { projectDir, sessionId } = opts
  const tracker = opts.tracker ?? DEFAULT_TRACKER_PATH

  const motivesRoot = join(projectDir, tracker, 'motives')
  if (existsSync(motivesRoot)) {
    let motiveEntries: string[]
    try { motiveEntries = readdirSync(motivesRoot) } catch { motiveEntries = [] }

    for (const motive of motiveEntries) {
      const gate = readGate(projectDir, tracker, motive, sessionId)
      if (!gate) continue

      const slices = bySession(projectDir, tracker, motive, sessionId)

      const ledger: RunResult = {
        session_id: sessionId,
        motive,
        active: gate.active ?? false,
        write_token: gate.write_token,
        scoped_tokens: gate.scoped_tokens,
        awaiting_human: gate.awaiting_human,
        checkpoint_hold: gate.checkpoint_hold,
        pacing: gate.pacing as Record<string, unknown> | undefined,
        base_commit: gate.base_commit,
        brief: gate.brief,
        plan_ref: gate.plan_ref,
        claimed_by: gate.claimed_by,
        slices,
        gate: {
          session: gate.session,
          motive: gate.motive,
          advisor: gate.advisor,
          verifier: gate.verifier,
          qa: gate.qa,
          phases: gate.phases,
          created_at: gate.created_at,
          sealed: gate.sealed,
        },
        source: 'notes',
      }
      return ledger
    }
  }

  const legacyPath = legacyFallbackPath(projectDir, sessionId)
  if (existsSync(legacyPath)) {
    try {
      const raw = readFileSync(legacyPath, 'utf8')
      const parsed = JSON.parse(raw) as LedgerJson
      return { ...parsed, source: 'legacy-json' }
    } catch {
      // malformed JSON — fall through
    }
  }

  return null
}

export function saveRun(
  ledger: LedgerJson,
  opts?: { projectDir?: string; tracker?: string; token?: string },
): void {
  if (opts?.token !== undefined && ledger.write_token !== undefined) {
    if (opts.token !== ledger.write_token) {
      const err = Object.assign(
        new Error('saveRun: invalid write token'),
        { code: 'RUN_STORE_INVALID_TOKEN' as const },
      )
      throw err
    }
  }
  initRun(ledger, { projectDir: opts?.projectDir, tracker: opts?.tracker })
}
