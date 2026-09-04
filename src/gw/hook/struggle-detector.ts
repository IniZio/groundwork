/**
 * Groundwork PostToolUse struggle detector — TypeScript port of hooks/struggle-detector.mjs.
 *
 * Fires on every Bash, Edit, and Write tool-use completion. Keeps a
 * session-scoped tally and emits cross-session signals when a threshold is crossed.
 * All helpers from hooks/lib/ are inlined.
 */

import path from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, openSync, writeSync, closeSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { HookFn } from './types.js'

// ──────────────────────────────────────────────────────────────────────────────
// Inlined from hooks/lib/concept-slug.mjs
// ──────────────────────────────────────────────────────────────────────────────

export function toSlug(str: string): string {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function shortHash(str: string): string {
  return createHash('sha1').update(String(str).slice(0, 200)).digest('hex').slice(0, 12)
}

function isVariantToken(tok: string): boolean {
  if (tok.startsWith('/') || tok.startsWith('./') || tok.startsWith('../')) return true
  if (/^[0-9a-f]{7,64}$/i.test(tok)) return true
  return false
}

export function normalizeCommand(cmd: string): string {
  const stripped = cmd.replace(/^(\s*[A-Z_][A-Z0-9_]*=\S*\s+)+/i, '')
  const tokens = stripped.trim().split(/\s+/)
  const kept: string[] = []
  let inFlagValue = false
  for (const tok of tokens) {
    if (tok.startsWith('-')) { inFlagValue = !tok.includes('='); continue }
    if (inFlagValue) { continue }
    if (isVariantToken(tok)) { continue }
    inFlagValue = false
    kept.push(tok)
  }
  return kept.join(' ').trim()
}

export function commandFingerprint(cmd: string): string {
  return shortHash(normalizeCommand(cmd))
}

// ──────────────────────────────────────────────────────────────────────────────
// Inlined from hooks/lib/signals-io.mjs — appendSignal
// ──────────────────────────────────────────────────────────────────────────────

function appendSignal(projectDir: string, signalObj: Record<string, unknown>): void {
  const filePath = path.join(projectDir, '.groundwork', 'struggle-signals.jsonl')
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true })
  appendFileSync(filePath, `${JSON.stringify(signalObj)}\n`, 'utf8')
}

// ──────────────────────────────────────────────────────────────────────────────
// Journal helpers (ported from hooks/lib/journal-io.mjs — same contract)
// ──────────────────────────────────────────────────────────────────────────────

const SAFE_SESSION = /^[a-zA-Z0-9_-]{1,128}$/
const VALID_TYPES = [
  'SIGNAL','FAILURE','DECISION','BASELINE','TBD','TBR','OBJECTIVE',
  'PAUSE','RESUME','ARCHIVE','MOTIVE','AC_COVERAGE','PACING',
  'PACING_NUDGE','GATE','WAVE_START','WAVE_COMPLETE','SLICE_START',
  'SLICE_COMPLETE','SLICE_FAIL','PLAN_START','PLAN_COMPLETE',
  'HANDOFF','RETROSPECTIVE','SESSION_START',
]

function resolveShardPath(projectDir: string, sessionId: string, date?: string): string {
  const safeId = SAFE_SESSION.test(sessionId ?? '') ? sessionId : 'default'
  const d = date ?? new Date().toISOString().slice(0, 10)
  return path.join(projectDir, '.groundwork', 'journal', `${d}-${safeId}.jsonl`)
}

function appendEvent(shardPath: string, event: Record<string, unknown>): void {
  mkdirSync(path.dirname(shardPath), { recursive: true })
  const buf = Buffer.from(JSON.stringify(event) + '\n', 'utf8')
  const fd = openSync(shardPath, 'a')
  try {
    writeSync(fd, buf)
  } finally {
    closeSync(fd)
  }
}

function resolveMotive(opts: { projectDir?: string; sessionId?: string; ledger?: Record<string, unknown> | null }): { motive: string; provenance: string } {
  const { projectDir, sessionId, ledger } = opts
  if (process.env.GROUNDWORK_MOTIVE) {
    return { motive: process.env.GROUNDWORK_MOTIVE, provenance: 'env' }
  }
  let l: Record<string, unknown> | null | undefined = ledger
  if (l === undefined) {
    const dir = projectDir ?? process.cwd()
    l = null
    try {
      l = JSON.parse(readFileSync(path.join(dir, '.groundwork', 'run.json'), 'utf8'))
    } catch { l = null }
    if (!(l as Record<string, unknown> | null)?.active) {
      let files: string[] = []
      try { files = readdirSync(path.join(dir, '.groundwork', 'runs')) } catch { /* none */ }
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const candidate = JSON.parse(readFileSync(path.join(dir, '.groundwork', 'runs', f), 'utf8'))
          if (candidate.active && (!sessionId || candidate.session_id === sessionId)) {
            l = candidate; break
          }
        } catch { /* skip malformed */ }
      }
    }
  }
  const lx = l as Record<string, unknown> | null
  if (lx?.motive) return { motive: lx.motive as string, provenance: 'ledger.motive' }
  if (lx?.rfc_ref) return { motive: lx.rfc_ref as string, provenance: 'ledger.rfc_ref' }
  const sid = sessionId ?? 'unknown'
  return { motive: `session:${sid}`, provenance: 'synthetic' }
}

function emitHookEvent(opts: {
  projectDir: string
  sessionId?: string
  type: string
  msg: string
  source: string
  data?: unknown
  ledger?: Record<string, unknown> | null
  date?: string
}): void {
  try {
    if (!VALID_TYPES.includes(opts.type)) {
      process.stderr.write(`journal: emitHookEvent: invalid type "${opts.type}" — event not written\n`)
      return
    }
    const { motive } = resolveMotive({ projectDir: opts.projectDir, sessionId: opts.sessionId })
    const event: Record<string, unknown> = {
      ts: new Date().toISOString(),
      session: opts.sessionId ?? 'unknown',
      motive,
      type: opts.type,
      msg: opts.msg,
      source: opts.source,
    }
    if (opts.data !== undefined) event.data = opts.data
    const shardPath = resolveShardPath(opts.projectDir, opts.sessionId ?? 'unknown', opts.date)
    appendEvent(shardPath, event)
  } catch {
    /* fail-open */
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tally types and helpers
// ──────────────────────────────────────────────────────────────────────────────

type TallyRecord = {
  count: number
  lastExitCode: number
  lastCmd: string
  fails: number
}

type Tally = {
  fingerprints: Record<string, TallyRecord>
  errorSigs: Record<string, number>
  emitted: Record<string, boolean>
}

function tallyPath(projectDir: string, sessionId: string): string {
  return path.join(projectDir, '.groundwork', 'runs', `${sessionId}.detector.json`)
}

function readTally(tallyFile: string): Tally {
  try {
    const raw = readFileSync(tallyFile, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object') return parsed as Tally
  } catch {
    /* missing or corrupt — start fresh */
  }
  return { fingerprints: {}, errorSigs: {}, emitted: {} }
}

function writeTally(tallyFile: string, tally: Tally): void {
  try {
    mkdirSync(path.dirname(tallyFile), { recursive: true })
    writeFileSync(tallyFile, JSON.stringify(tally), 'utf8')
  } catch {
    /* swallow — must not crash the hook */
  }
}

function maybeEmit(
  tally: Tally,
  projectDir: string,
  sessionId: string,
  kind: string,
  fingerprint: string,
  detail: Record<string, unknown>,
): boolean {
  const key = `${kind}:${fingerprint}`
  if (tally.emitted[key]) return false
  tally.emitted[key] = true
  try {
    appendSignal(projectDir, {
      ts: new Date().toISOString(),
      session_id: sessionId,
      kind,
      fingerprint,
      detail,
    })
  } catch {
    /* swallow — fail-open */
  }
  emitHookEvent({
    projectDir,
    sessionId,
    type: 'FAILURE',
    msg: `struggle detected: ${kind} on ${fingerprint}`,
    source: 'hook:struggle-detector',
    data: { kind, fingerprint, ...detail },
  })
  return true
}

// ──────────────────────────────────────────────────────────────────────────────
// Core detection logic — exported for testing
// ──────────────────────────────────────────────────────────────────────────────

function resolveThreshold(opts?: { threshold?: number }): number {
  if (opts && typeof opts.threshold === 'number') return opts.threshold
  const raw = process.env.GROUNDWORK_STRUGGLE_THRESHOLD
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : 3
}

type SignalRecord = { kind: string; fingerprint: string; detail: Record<string, unknown> }

/**
 * Process one PostToolUse payload object.
 *
 * Pure detection function: reads/writes the tally and may append to the signals
 * store. Does NOT call process.exit() so tests can call it directly.
 *
 * Returns the list of signals freshly emitted this invocation (empty when none
 * fired or when the dedup map blocked re-emission).
 *
 * `opts.threshold` lets tests override THRESHOLD without touching env.
 */
export async function processPayload(
  input: unknown,
  opts?: { threshold?: number },
): Promise<SignalRecord[]> {
  const threshold = resolveThreshold(opts)
  const fired: SignalRecord[] = []

  if (!input || typeof input !== 'object') return fired

  const inp = input as Record<string, unknown>
  const toolName = typeof inp.tool_name === 'string' ? inp.tool_name : ''
  if (!['Bash', 'Edit', 'Write'].includes(toolName)) return fired

  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ||
    (typeof inp.cwd === 'string' ? inp.cwd : '') ||
    ''
  if (!projectDir) return fired

  const sessionId = typeof inp.session_id === 'string' ? inp.session_id : ''
  if (!sessionId) return fired

  const toolInput = inp.tool_input as Record<string, unknown> | undefined
  const toolResponse = inp.tool_response as Record<string, unknown> | undefined

  const tFile = tallyPath(projectDir, sessionId)
  const tally = readTally(tFile)
  if (!tally.fingerprints) tally.fingerprints = {}
  if (!tally.errorSigs) tally.errorSigs = {}
  if (!tally.emitted) tally.emitted = {}

  function emit(kind: string, fingerprint: string, detail: Record<string, unknown>): void {
    if (maybeEmit(tally, projectDir, sessionId, kind, fingerprint, detail)) {
      fired.push({ kind, fingerprint, detail })
    }
  }

  if (toolName === 'Bash') {
    const cmd = typeof toolInput?.command === 'string' ? toolInput.command : ''
    if (!cmd) {
      writeTally(tFile, tally)
      return fired
    }

    const fp = commandFingerprint(cmd)

    const exitCode = (() => {
      const direct = toolResponse?.exit_code
      if (typeof direct === 'number') return direct
      const nested = (toolResponse?.result as Record<string, unknown> | undefined)?.exit_code
      if (typeof nested === 'number') return nested
      return 0
    })()

    if (!tally.fingerprints[fp]) {
      tally.fingerprints[fp] = { count: 0, lastExitCode: 0, lastCmd: cmd, fails: 0 }
    }
    const rec = tally.fingerprints[fp]
    rec.count += 1
    rec.lastCmd = cmd
    const hadFail = rec.fails > 0
    if (exitCode !== 0) rec.fails += 1
    rec.lastExitCode = exitCode

    if (hadFail && rec.count >= 2) {
      emit('fail-retry', fp, { cmd, count: rec.count, fails: rec.fails })
    }

    if (rec.count >= threshold) {
      emit('repeat-command', fp, { cmd, count: rec.count })
    }

    const stderr = (() => {
      const s = toolResponse?.stderr
      if (typeof s === 'string') return s
      const t = (toolResponse?.result as Record<string, unknown> | undefined)?.stderr
      if (typeof t === 'string') return t
      return ''
    })()

    if (stderr && exitCode !== 0) {
      const errHash = shortHash(stderr)
      tally.errorSigs[errHash] = (tally.errorSigs[errHash] || 0) + 1
      if (tally.errorSigs[errHash] >= threshold) {
        emit('error-signature', errHash, {
          stderrPrefix: stderr.slice(0, 200),
          count: tally.errorSigs[errHash],
        })
      }
    }
  } else {
    // Edit or Write — detect file thrashing
    const filePath = typeof toolInput?.file_path === 'string' ? toolInput.file_path : ''
    if (!filePath) {
      writeTally(tFile, tally)
      return fired
    }

    const fp = toSlug(filePath)

    if (!tally.fingerprints[fp]) {
      tally.fingerprints[fp] = { count: 0, lastExitCode: 0, lastCmd: filePath, fails: 0 }
    }
    const rec = tally.fingerprints[fp]
    rec.count += 1

    if (rec.count >= threshold) {
      emit('file-thrash', fp, { filePath, count: rec.count })
    }
  }

  writeTally(tFile, tally)
  return fired
}

// ──────────────────────────────────────────────────────────────────────────────
// Main exported hook function
// ──────────────────────────────────────────────────────────────────────────────

export const run: HookFn = async (input, _env) => {
  let fired: SignalRecord[] = []
  try {
    fired = await processPayload(input)
  } catch {
    /* fail-open — PostToolUse cannot block a tool */
  }
  // Emit one JSON line per freshly-fired signal so the caller can classify
  // this invocation as SIGNAL vs NO-SIGNAL without reading disk state.
  const stdout = fired
    .map(s => JSON.stringify({ decision: 'SIGNAL', kind: s.kind, fingerprint: s.fingerprint }))
    .join('\n')
  return { stdout: stdout ? stdout + '\n' : '', stderr: '', exit: 0 }
}
