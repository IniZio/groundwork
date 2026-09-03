/**
 * src/gw/hook/stop-gate.ts — TypeScript port of hooks/stop-gate.mjs.
 *
 * Enforcement teeth for max fan-out: refuses to let a session end while an active
 * run has incomplete vertical slices.  Fail-open on every error path.
 *
 * Slice S3-HOOKS — motive obsidian-native-groundwork.
 *
 * TRANSITION RULE (new-layout vs legacy):
 *   Primary: look in <projectDir>/.groundwork/next/motives/ for new-layout slices
 *   belonging to the current sessionId (via bySession()).
 *   Fallback: if no new-layout data, read the legacy JSON ledger from
 *   .groundwork/runs/<sessionId>.json or .groundwork/run.json.
 *   Enforcement logic is identical for both paths.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  closeSync,
  mkdirSync,
  openSync,
  writeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  statSync,
} from 'node:fs'
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import type { HookFn, HookResult } from './types.js'
import { bySession } from '../store/slice/index.js'
import { readGate } from '../store/gate/index.js'

// ---------------------------------------------------------------------------
// HookResult builders — replace process.exit(0) pattern from the .mjs original.
// ---------------------------------------------------------------------------

function allow(notice = ''): HookResult {
  const payload = notice ? { continue: true, reason: notice } : { continue: true }
  return { stdout: JSON.stringify(payload) + '\n', stderr: '', exit: 0 }
}

function block(reason: string): HookResult {
  const payload = {
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'Stop', additionalContext: reason },
  }
  return { stdout: JSON.stringify(payload) + '\n', stderr: '', exit: 0 }
}

// ---------------------------------------------------------------------------
// Inlined: hook-io helpers (from hooks/lib/hook-io.mjs)
// ---------------------------------------------------------------------------

function isEmbeddedAgent(env: Record<string, string | undefined>): boolean {
  const ep = env.CLAUDE_CODE_ENTRYPOINT
  return ep === 'sdk-py' || ep === 'sdk-js'
}

// ---------------------------------------------------------------------------
// Inlined: motive-ref helper (from hooks/lib/motive-ref.mjs)
// ---------------------------------------------------------------------------

function resolveMotiveSlug(motiveRef: unknown): string | null {
  if (typeof motiveRef !== 'string' || motiveRef.length === 0) return null
  // Path form: extract the segment after the last "motives/" component.
  const match = motiveRef.match(/(?:^|[/\\])motives[/\\]([^/\\]+)/)
  if (match) return match[1]
  // Slug form: return as-is.
  return motiveRef
}

// ---------------------------------------------------------------------------
// Inlined: gate-seal helpers (from hooks/lib/gate-seal.mjs)
// ---------------------------------------------------------------------------

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

/** Extract advisor verdict from gate.advisor (string or {verdict} object). */
function extractAdvisorVerdictFromGateObj(gate: unknown): string | null {
  const a = (gate as Record<string, unknown>)?.advisor
  if (!a) return null
  if (typeof a === 'string') return a
  if (typeof a === 'object' && a !== null && 'verdict' in a)
    return String((a as Record<string, unknown>).verdict)
  return null
}

/** Deterministic JSON string of release-affecting ledger state. */
function canonicalReleaseState(ledger: Record<string, unknown>): string {
  const slices = Array.isArray(ledger.slices) ? (ledger.slices as Record<string, unknown>[]) : []
  const sortedSlices = slices
    .map(s => ({
      id: String(s.id),
      status: String(s.status),
      created_by: s.created_by ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const state: Record<string, unknown> = {
    schema_version: ledger.schema_version ?? null,
    session_id: ledger.session_id ?? null,
    active: ledger.active ?? null,
    advisor_verdict: extractAdvisorVerdictFromGateObj(ledger.gate),
    slices: sortedSlices,
  }

  if (ledger.scoped_tokens !== undefined) {
    const rawTokens = Array.isArray(ledger.scoped_tokens)
      ? (ledger.scoped_tokens as Record<string, unknown>[])
      : []
    state.scoped_tokens = rawTokens
      .map(t => ({ scope: String(t.scope ?? ''), token: String(t.token ?? '') }))
      .sort((a, b) =>
        a.scope < b.scope
          ? -1
          : a.scope > b.scope
            ? 1
            : a.token < b.token
              ? -1
              : a.token > b.token
                ? 1
                : 0,
      )
  }

  if (ledger.awaiting_human !== undefined) {
    state.awaiting_human = ledger.awaiting_human === true
  }

  const pacing = ledger.pacing as Record<string, unknown> | undefined
  if (pacing?.milestone_signoff !== undefined) {
    const ms = pacing.milestone_signoff as Record<string, unknown>
    state.milestone_signoff = {
      verdict: String(ms.verdict ?? ''),
      verified_by: String(ms.verified_by ?? ''),
      verified_at: String(ms.verified_at ?? ''),
    }
  }

  return JSON.stringify(state)
}

function computeSeal(stateString: string, key: Buffer | string): string {
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key as string, 'hex')
  return createHmac('sha256', keyBuf).update(stateString, 'utf8').digest('hex')
}

function verifySeal(ledger: Record<string, unknown>, key: Buffer | string): boolean {
  const gate = ledger.gate as Record<string, unknown> | undefined
  const storedSeal = gate?.seal
  if (!storedSeal || typeof storedSeal !== 'string') return false
  try {
    const stateString = canonicalReleaseState(ledger)
    const expected = computeSeal(stateString, key)
    const storedBuf = Buffer.from(storedSeal, 'hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    if (storedBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(storedBuf, expectedBuf)
  } catch {
    return false
  }
}

function sealKeyPath({ projectDir, sessionId }: { projectDir: string; sessionId?: string }): string {
  if (sessionId && SAFE_ID.test(sessionId)) {
    return path.join(projectDir, '.groundwork', 'runs', `${sessionId}.seal.key`)
  }
  return path.join(projectDir, '.groundwork', 'runs', 'legacy.seal.key')
}

function readKey({ projectDir, sessionId }: { projectDir: string; sessionId?: string }): Buffer {
  const kp = sealKeyPath({ projectDir, sessionId })
  return readFileSync(kp)
}

// ---------------------------------------------------------------------------
// Inlined: ledger-io helpers (from hooks/lib/ledger-io.mjs)
// ---------------------------------------------------------------------------

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // SharedArrayBuffer unavailable — fall through
  }
}

function atomicWriteFileSync(filePath: string, data: string): void {
  const dir = path.dirname(filePath)
  mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp.${randomUUID()}`)
  const fd = openSync(tmp, 'w')
  try {
    writeFileSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, filePath)
  try {
    const dfd = openSync(dir, 'r')
    try {
      fsyncSync(dfd)
    } finally {
      closeSync(dfd)
    }
  } catch {
    // not fatal
  }
}

function atomicWriteJsonSync(filePath: string, obj: unknown): void {
  atomicWriteFileSync(filePath, `${JSON.stringify(obj, null, 2)}\n`)
}

function withLock<T>(
  targetPath: string,
  fn: () => T,
  { retries = 100, delayMs = 20, staleMs = 5000 } = {},
): T {
  const lockPath = `${targetPath}.lock`
  mkdirSync(path.dirname(targetPath), { recursive: true })
  let fd: number | null = null
  for (let i = 0; fd === null; i++) {
    try {
      fd = openSync(lockPath, 'wx') // O_CREAT | O_EXCL
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code !== 'EEXIST') throw e
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
          unlinkSync(lockPath)
          continue
        }
      } catch {
        // lock vanished between stat and unlink — retry
      }
      if (i >= retries) throw new Error(`ledger lock timeout: ${lockPath}`)
      sleepSync(delayMs)
    }
  }
  try {
    return fn()
  } finally {
    try {
      closeSync(fd!)
    } catch {
      // ignore
    }
    try {
      unlinkSync(lockPath)
    } catch {
      // ignore
    }
  }
}

function mutateLedger(
  ledgerPath: string,
  fn: (
    ledger: Record<string, unknown> | null,
  ) => Record<string, unknown> | null | undefined,
): void {
  withLock(ledgerPath, () => {
    let ledger: Record<string, unknown> | null = null
    try {
      ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<string, unknown>
    } catch {
      ledger = null
    }
    const returned = fn(ledger)
    const next = returned === undefined ? ledger : returned
    if (next != null) atomicWriteJsonSync(ledgerPath, next)
  })
}

function resolveLedgerPath({
  projectDir,
  sessionId,
}: {
  projectDir: string
  sessionId?: string
}): string {
  const legacyPath = path.join(projectDir, '.groundwork', 'run.json')
  if (!sessionId || typeof sessionId !== 'string') return legacyPath
  if (!SAFE_ID.test(sessionId)) return legacyPath

  const perSessionPath = path.join(projectDir, '.groundwork', 'runs', `${sessionId}.json`)
  if (existsSync(perSessionPath)) return perSessionPath

  if (existsSync(legacyPath)) {
    let legacy: Record<string, unknown> | null = null
    try {
      legacy = JSON.parse(readFileSync(legacyPath, 'utf8')) as Record<string, unknown>
    } catch {
      // ignore
    }
    const legacyOwner = legacy?.session_id
    if (!legacyOwner || legacyOwner === sessionId) return legacyPath
  }

  return perSessionPath
}

// ---------------------------------------------------------------------------
// Inlined: pacing helpers (from hooks/lib/pacing.mjs)
// ---------------------------------------------------------------------------

function getPacing(doc: Record<string, unknown>): Record<string, unknown> | null {
  return (doc.pacing as Record<string, unknown>) ?? null
}

function getSlicesArr(doc: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(doc.slices) ? (doc.slices as Record<string, unknown>[]) : []
}

function isExemptSlice(slice: Record<string, unknown>, exemptKinds: string[]): boolean {
  return exemptKinds.includes(String(slice.kind ?? ''))
}

function resolvedUnits(doc: Record<string, unknown>): number {
  const pacing = getPacing(doc)
  if (!pacing) return 0
  const slices = getSlicesArr(doc)
  const exemptKinds = Array.isArray(pacing.exempt_kinds)
    ? (pacing.exempt_kinds as string[])
    : []
  const policy = pacing.policy as string
  const offset = Number(pacing.offset ?? 0)

  let raw = 0
  if (policy === 'slice') {
    raw = slices.filter(
      s => !isExemptSlice(s, exemptKinds) && s.status === 'complete',
    ).length
  } else if (policy === 'wave' || policy === 'milestone') {
    const waves = new Map<number, { total: number; complete: number }>()
    for (const s of slices) {
      if (isExemptSlice(s, exemptKinds)) continue
      const w = Number(s.wave ?? 0)
      const entry = waves.get(w) ?? { total: 0, complete: 0 }
      entry.total++
      if (s.status === 'complete') entry.complete++
      waves.set(w, entry)
    }
    for (const { total, complete } of waves.values()) {
      if (total > 0 && complete === total) raw++
    }
  }
  return Math.max(0, raw - offset)
}

function activeUnit(doc: Record<string, unknown>): number | string | null {
  const pacing = getPacing(doc)
  if (!pacing) return null
  const slices = getSlicesArr(doc)
  const exemptKinds = Array.isArray(pacing.exempt_kinds)
    ? (pacing.exempt_kinds as string[])
    : []
  const policy = pacing.policy as string

  const active = slices.filter(
    s => !isExemptSlice(s, exemptKinds) && s.status === 'in_progress',
  )
  if (active.length === 0) return null

  if (policy === 'slice') return active[0].id as string

  let minWave = Infinity
  for (const s of active) {
    const w = Number(s.wave ?? 0)
    if (w < minWave) minWave = w
  }
  return minWave === Infinity ? null : minWave
}

function isExhausted(doc: Record<string, unknown>): boolean {
  const pacing = getPacing(doc)
  if (!pacing) return false
  if (activeUnit(doc) !== null) return false

  const budget = Number(pacing.budget ?? 1)
  const grant = pacing.grant as Record<string, unknown> | undefined
  const grantRange = Number(grant?.range ?? 0)
  const cap = budget + grantRange

  const slices = getSlicesArr(doc)
  const exemptKinds = Array.isArray(pacing.exempt_kinds)
    ? (pacing.exempt_kinds as string[])
    : []
  const hasRemainingWork = slices.some(
    s => !isExemptSlice(s, exemptKinds) && s.status !== 'complete',
  )
  return hasRemainingWork && resolvedUnits(doc) >= cap
}

// ---------------------------------------------------------------------------
// Inlined: simplified journal helpers (from hooks/lib/journal-io.mjs)
// ---------------------------------------------------------------------------

/**
 * Simplified emitHookEvent — appends one JSON event line to the journal shard.
 * Writes ONLY the `motive` key (motive-only schema per 2026-08-03 decision).
 * Fail-open: never throws, never writes to stdout.
 */
function emitHookEvent(opts: {
  projectDir: string
  sessionId: string
  ledger?: Record<string, unknown> | null
  type: string
  msg: string
  source: string
  data?: Record<string, unknown>
}): void {
  try {
    const { projectDir, sessionId, type, msg, source, data, ledger } = opts
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const shardPath = path.join(journalDir, `${date}-${sessionId || 'unknown'}.jsonl`)

    // Resolve motive — full port of hooks/lib/journal-io.mjs:resolveMotive
    let motive: string
    let motive_provenance: string
    if (process.env.GROUNDWORK_MOTIVE) {
      motive = process.env.GROUNDWORK_MOTIVE
      motive_provenance = 'env'
    } else {
      let l: Record<string, unknown> | null | undefined = ledger
      if (l === undefined) {
        const dir = projectDir
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
      if (lx?.motive) {
        motive = lx.motive as string; motive_provenance = 'ledger.motive'
      } else if (lx?.rfc_ref) {
        motive = lx.rfc_ref as string; motive_provenance = 'ledger.rfc_ref'
      } else {
        motive = `session:${sessionId || 'unknown'}`; motive_provenance = 'synthetic'
      }
    }

    const event: Record<string, unknown> = {
      ts: new Date().toISOString(),
      session: sessionId,
      type,
      msg,
      source,
      motive,
    }
    if (data !== undefined) {
      event.data = { ...data, motive_provenance }
    }

    const buf = Buffer.from(JSON.stringify(event) + '\n', 'utf8')
    const fd = openSync(shardPath, 'a') // O_WRONLY | O_CREAT | O_APPEND
    try {
      writeSync(fd, buf)
    } finally {
      closeSync(fd)
    }
  } catch (e) {
    // Fail-open: journal errors must never affect hook stdout.
    // Write to stderr so AC6 tests and operators can detect journal failures.
    try { process.stderr.write(`[stop-gate] emitHookEvent failed: ${String(e)}\n`) } catch { /* ignore */ }
  }
}

/** Read all events from JSONL shards in journalDir. Returns [] on any error. */
function readAllEvents(journalDir: string): Record<string, unknown>[] {
  try {
    let files: string[]
    try {
      files = readdirSync(journalDir).filter(f => f.endsWith('.jsonl'))
    } catch {
      return []
    }
    const events: Record<string, unknown>[] = []
    for (const f of files) {
      try {
        const content = readFileSync(path.join(journalDir, f), 'utf8')
        for (const line of content.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            events.push(JSON.parse(trimmed) as Record<string, unknown>)
          } catch {
            // skip malformed line
          }
        }
      } catch {
        // skip unreadable shard
      }
    }
    return events
  } catch {
    return []
  }
}

/** Filter events by motive slug. Returns { shown: filtered }. */
function filterEvents(
  events: Record<string, unknown>[],
  { motive }: { motive?: string },
): { shown: Record<string, unknown>[] } {
  if (!motive) return { shown: events }
  const shown = events.filter(e => {
    const m = e.motive
    if (typeof m !== 'string') return false
    if (m === motive) return true
    // Path form: extract slug after "motives/"
    const match = m.match(/(?:^|[/\\])motives[/\\]([^/\\]+)/)
    return match?.[1] === motive
  })
  return { shown }
}

/** Count TBD/TBR open items in a motive charter (simplified regex). Fail-open → 0. */
function charterOpenItemCount(projectDir: string, slug: string): number {
  try {
    const charterPath = path.join(
      projectDir,
      '.groundwork',
      'motives',
      slug,
      'motive.md',
    )
    const content = readFileSync(charterPath, 'utf8')
    const matches = content.match(/^-\s+(TBD|TBR)-\S+:/gim) ?? []
    return matches.length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Advisory functions — non-blocking; return '' on any error
// ---------------------------------------------------------------------------

function tbdAdvisory(
  projectDir: string,
  env: Record<string, string | undefined>,
): string {
  if (env.GROUNDWORK_TBD_GATE !== '1') return ''
  try {
    const motivesDir = path.join(projectDir, '.groundwork', 'motives')
    let slugs: string[]
    try {
      slugs = readdirSync(motivesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
    } catch {
      return ''
    }
    const lines: string[] = []
    for (const slug of slugs) {
      try {
        const n = charterOpenItemCount(projectDir, slug)
        if (n > 0) lines.push(`Open items: ${n} TBD/TBR unresolved for motive ${slug}`)
      } catch {
        // fail-open per motive
      }
    }
    return lines.length > 0 ? '\n' + lines.join('\n') : ''
  } catch {
    return ''
  }
}

function decisionResearchAdvisory(projectDir: string): string {
  try {
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    const events = readAllEvents(journalDir)
    const missing = events.filter(e => {
      if (e?.type !== 'DECISION') return false
      const d = e.data as Record<string, unknown> | undefined
      return /^(high|medium)$/i.test(String(d?.blast ?? '')) && !d?.research
    })
    if (missing.length === 0) return ''
    const ids = missing
      .map(e => {
        const d = e.data as Record<string, unknown> | undefined
        return String(d?.id ?? e?.id ?? '(unknown)')
      })
      .join(', ')
    return `\n⚠ DECISION event(s) with high/medium blast lack data.research: ${ids}. Add a research findings path to aid future reviewers.`
  } catch {
    return ''
  }
}

function decisionAlternativesAdvisory(projectDir: string): string {
  try {
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    const allEvents = readAllEvents(journalDir)

    let slugs: string[] | null = null
    try {
      const motivesDir = path.join(projectDir, '.groundwork', 'motives')
      const dirs = readdirSync(motivesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .sort()
      if (dirs.length > 0) slugs = dirs
    } catch {
      // no motives directory
    }

    // (a) Latest alternatives per keyed decision id.
    const noAltsLines: string[] = []

    const scanForNoAlts = (
      evts: Record<string, unknown>[],
      label?: string,
    ): void => {
      const latestAlts = new Map<string, unknown[] | null>()
      for (const e of evts) {
        const d = e.data as Record<string, unknown> | undefined
        if (e?.type === 'DECISION' && d?.id != null) {
          const id = String(d.id)
          if (Array.isArray(d.alternatives)) {
            latestAlts.set(id, d.alternatives)
          } else if (!latestAlts.has(id)) {
            latestAlts.set(id, null)
          }
        }
      }
      const noAlts = [...latestAlts.entries()]
        .filter(([, alts]) => !Array.isArray(alts) || alts.length === 0)
        .map(([id]) => id)
      if (noAlts.length > 0) {
        const suffix = label ? ` [${label}]` : ''
        noAltsLines.push(
          `⚠ DECISION event(s) missing alternatives (ruled-out options not captured)${suffix}: ${noAlts.join(', ')}.`,
        )
      }
    }

    if (slugs !== null) {
      for (const slug of slugs) {
        try {
          const { shown } = filterEvents(allEvents, { motive: slug })
          scanForNoAlts(shown, slug)
        } catch {
          // fail-open per motive
        }
      }
    } else {
      scanForNoAlts(allEvents)
    }

    // (b) Unmarked-collision: same decision id appears in multiple events for a
    // motive without any event carrying data.revises === id. Inline detection
    // avoids a compile() dependency — we only need the raw event stream.
    const unmarkedLines: string[] = []
    try {
      for (const slug of slugs ?? []) {
        try {
          const { shown: motiveEvts } = filterEvents(allEvents, { motive: slug })
          const idCount = new Map<string, number>()
          const revisedIds = new Set<string>()
          for (const ev of motiveEvts) {
            if (ev?.type !== 'DECISION') continue
            const d = ev.data as Record<string, unknown> | undefined
            const id = d?.id
            if (typeof id !== 'string') continue
            idCount.set(id, (idCount.get(id) ?? 0) + 1)
            const revises = d?.revises
            if (typeof revises === 'string' && revises) revisedIds.add(id)
          }
          const unmarked: string[] = []
          for (const [id, count] of idCount) {
            if (count > 1 && !revisedIds.has(id)) unmarked.push(id)
          }
          if (unmarked.length > 0) {
            unmarkedLines.push(
              `⚠ DECISION event(s) with possible unmarked id reuse — verify intent [${slug}]: ${unmarked.join(', ')}.`,
            )
          }
        } catch {
          // fail-open per motive
        }
      }
    } catch {
      // fail-open: unmarked collision check silently skips on any outer error
    }

    const lines = [...noAltsLines, ...unmarkedLines]
    return lines.length > 0 ? '\n' + lines.join('\n') : ''
  } catch {
    return ''
  }
}

function specAdvisory(projectDir: string): string {
  try {
    const raw = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 5000,
    })
    if (raw.status !== 0 || raw.error) return ''
    const lines = (raw.stdout ?? '').split('\n').filter(Boolean)
    const changed = lines.map(l => l.slice(3).trim())
    const ENFORCEMENT_RE =
      /^(hooks\/[^/]+\.mjs|hooks\/lib\/[^/]+\.mjs|bin\/[^/]+|schemas\/[^/]+)/
    const enforcementFiles = changed.filter(f => ENFORCEMENT_RE.test(f))
    if (enforcementFiles.length === 0) return ''
    const specsTouched = changed.some(f => f.startsWith('doc/specs/'))
    if (specsTouched) return ''
    return `\n⚠ Enforcement-surface files changed (${enforcementFiles.join(', ')}) but doc/specs/ was not updated. Consider adding or updating a spec requirement.`
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Hard ceiling on consecutive no-progress blocks
// ---------------------------------------------------------------------------

const REINFORCEMENT_CAP = 12

// ---------------------------------------------------------------------------
// Core helpers (ported verbatim from hooks/stop-gate.mjs)
// ---------------------------------------------------------------------------

function advisorVerdict(gate: unknown): string | null {
  const a = (gate as Record<string, unknown>)?.advisor
  if (typeof a === 'string') return a.toUpperCase()
  if (a && typeof a === 'object' && (a as Record<string, unknown>).verdict != null)
    return String((a as Record<string, unknown>).verdict).toUpperCase()
  return null
}

/**
 * Returns:
 *   null  — ledger not in sealed regime (no gate.seal); caller uses legacy behavior.
 *   true  — sealed and HMAC verifies; release is safe.
 *   false — sealed but verify failed OR key missing; FAIL CLOSED.
 */
function checkSeal(
  ledger: Record<string, unknown>,
  projectDir: string,
  sessionId: string,
): null | boolean {
  const gate = ledger.gate as Record<string, unknown> | undefined
  const storedSeal = gate?.seal
  if (!storedSeal || typeof storedSeal !== 'string') return null
  try {
    const key = readKey({ projectDir, sessionId: sessionId || undefined })
    return verifySeal(ledger, key)
  } catch {
    return false // missing/unreadable key on sealed ledger → fail closed
  }
}

function progressSignature(ledger: Record<string, unknown>): string {
  const slices = Array.isArray(ledger.slices)
    ? (ledger.slices as Record<string, unknown>[])
    : []
  const sliceState = slices.map(s => `${s.id ?? '?'}:${s.status ?? '?'}`).join(',')
  const gate = (ledger.gate ?? {}) as Record<string, unknown>
  return JSON.stringify({
    sliceState,
    verifier: gate.verifier ?? null,
    advisor: advisorVerdict(gate),
  })
}

function outstandingBackgroundTasks(raw: string): number {
  const launches = (raw.match(/state=\\*"running/g) ?? []).length
  const completions = (raw.match(/<task-notification>/g) ?? []).length
  return launches - completions
}

function lastAssistantTurn(raw: string): { text: string; toolNames: string[] } {
  let text = ''
  let toolNames: string[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }
    const role =
      (obj.message as Record<string, unknown>)?.role ??
      obj.role ??
      (obj.type === 'assistant' ? 'assistant' : undefined)
    if (role !== 'assistant') continue
    const content =
      (obj.message as Record<string, unknown>)?.content ?? obj.content
    if (typeof content === 'string') {
      text = content
      toolNames = []
      continue
    }
    if (!Array.isArray(content)) continue
    let txt = ''
    const names: string[] = []
    for (const blk of content as Record<string, unknown>[]) {
      if (blk.type === 'text' && typeof blk.text === 'string') txt += `${blk.text}\n`
      if (blk.type === 'tool_use' && typeof blk.name === 'string') names.push(blk.name)
    }
    text = txt
    toolNames = names
  }
  return { text, toolNames }
}

function hasInFlightBackgroundTasks(input: unknown): boolean {
  const tasks = (input as Record<string, unknown>)?.background_tasks
  if (!Array.isArray(tasks) || tasks.length === 0) return false
  const TERMINAL =
    /^(completed?|complete|done|failed|error|cancell?ed|stopped|killed|timed_?out)$/i
  return tasks.some(t => {
    const s =
      typeof (t as Record<string, unknown>)?.status === 'string'
        ? String((t as Record<string, unknown>).status)
        : ''
    return !TERMINAL.test(s)
  })
}

function detectYield(input: unknown): string | null {
  // 1. Authoritative: harness says background work is still running.
  if (hasInFlightBackgroundTasks(input)) {
    return 'background tasks still in flight (background_tasks payload) — orchestrator awaiting completion'
  }
  const inp = input as Record<string, unknown>
  const transcriptPath =
    typeof inp?.transcript_path === 'string' ? inp.transcript_path : ''
  if (!transcriptPath) return null

  let raw: string
  try {
    raw = readFileSync(transcriptPath, 'utf8')
  } catch {
    return null
  }

  // 2. Fallback in-flight detection from transcript launch/completion bookkeeping.
  if (outstandingBackgroundTasks(raw) > 0) {
    return 'background delegations still in flight — orchestrator awaiting completion'
  }

  let turn: { text: string; toolNames: string[] }
  try {
    turn = lastAssistantTurn(raw)
  } catch {
    return null
  }

  const text = turn.text || ''
  if (/^[ \t>*\-]*needs input:/im.test(text)) return 'awaiting user input (needs input:)'
  if (/^[ \t>*\-]*failed:/im.test(text)) return 'run reported failed (failed:)'
  if (turn.toolNames.some(n => /task|agent/i.test(n)))
    return 'launched background delegation and yielded'
  if (/waiting for .{0,40}(completion|notification|background|task)/i.test(text))
    return 'waiting on background tasks'
  return null
}

function pacingGrantSummary(ledger: Record<string, unknown>): string {
  const pacing = ledger.pacing as Record<string, unknown> | undefined
  const grant = pacing?.grant as Record<string, unknown> | undefined
  if (!grant) return ''
  const range = grant.range ?? '?'
  const reason = grant.reason ? ` reason="${grant.reason}"` : ''
  const by = grant.granted_by ? ` granted_by=${grant.granted_by}` : ''
  return `\n⚠ Autopilot grant active this session: +${range} unit${range === 1 ? '' : 's'}${reason}${by}\n`
}

function pacingExhaustionDirective(
  ledger: Record<string, unknown>,
  incomplete: Record<string, unknown>[],
  projectDir: string,
): string {
  const sliceIds = incomplete.map(s => s.id ?? '?').join(', ')
  const motiveSlug =
    resolveMotiveSlug(ledger.motive_ref) ||
    (typeof ledger.motive === 'string' && ledger.motive.length > 0
      ? ledger.motive
      : null)
  const mapPath = motiveSlug
    ? path.join(projectDir, '.groundwork', 'motives', motiveSlug, 'MAP.md')
    : null

  const lines: string[] = []
  lines.push('⏱ GROUNDWORK PACING — session budget exhausted. This session ends here.')
  lines.push('')
  lines.push(`Remaining slices (carry into the next session): ${sliceIds}`)
  if (mapPath) lines.push(`Motive map: ${mapPath}`)
  lines.push(
    'DIRECTIVE: run /groundwork:pause, then open a new session to continue the remaining slices.',
  )
  return lines.join('\n')
}

function buildReason(
  ledger: Record<string, unknown>,
  incomplete: Record<string, unknown>[],
  count: number,
  ledgerBin: string,
): string {
  const lines: string[] = []
  lines.push('⛔ GROUNDWORK STOP-GATE — this run is NOT complete.')
  lines.push('')
  if (ledger.brief) lines.push(`Run: ${ledger.brief}`)

  const total = Array.isArray(ledger.slices) ? ledger.slices.length : 0
  const done = total - incomplete.length
  lines.push(`Slices: ${done}/${total} complete.`)
  if (incomplete.length) {
    lines.push('Incomplete slices (fan these out — do NOT finish them yourself):')
    for (const s of incomplete) {
      const files = Array.isArray(s.files) ? (s.files as string[]).join(', ') : ''
      const ac = Array.isArray(s.acceptance) ? s.acceptance.length : 0
      const acNote = ac ? ` — ${ac} acceptance criteria to verify` : ''
      lines.push(
        `  - ${s.id ?? '?'} [wave ${s.wave ?? '?'}] ${s.behavior ?? ''} (${s.status ?? 'pending'})${files ? ` — owns: ${files}` : ''}${acNote}`,
      )
    }
  }

  const gate = (ledger.gate ?? {}) as Record<string, unknown>
  const advisorShown = advisorVerdict(gate) ?? 'pending'
  lines.push('')
  lines.push(
    `Completion gate — advisor: ${advisorShown} (must be APPROVE). [verifier: ${gate.verifier ?? 'n/a'} — informational only]`,
  )

  if (advisorShown === 'REPLAN') {
    lines.push('')
    lines.push(
      'Advisor returned REPLAN — re-enter interview (spec wrong) or vertical-slice (decomposition wrong) before more impl slices; do not resume impl waves.',
    )
  }

  if (count === 0) {
    lines.push('')
    lines.push('REMEMBER THE FAN-OUT RULES:')
    lines.push(
      '- Launch every independent slice in the next wave in ONE message — splitting Task calls across messages is sequential execution in disguise.',
    )
    lines.push(
      '- Each file is owned by exactly ONE slice per wave; shared types live in the Wave 0 tracer.',
    )
    lines.push(
      '- One objective per Task; each prompt self-contained (paths, constraints, success criteria).',
    )
    lines.push(
      '- You are the ORCHESTRATOR — delegate to groundwork:general-purpose. Do not implement slices yourself.',
    )
    lines.push('')
    lines.push(
      `TO FINISH (use the ledger CLI — do NOT Read/Edit run.json by hand): as each slice lands, run \`${ledgerBin} complete <id>\`. When all slices are complete, run the completion gate ([qa if interactive UI] → advisor) and record it with \`${ledgerBin} gate advisor APPROVE\`. Check progress any time with \`${ledgerBin} status\`.`,
    )
    lines.push(
      `TO ABANDON: run \`${ledgerBin} abandon\` (sets active:false — the run is cancelled and the gate releases).`,
    )
  } else {
    lines.push('')
    lines.push(
      `Full rules were shown on the first block. Finish: ${ledgerBin} complete <ids> + gate advisor APPROVE. Abandon: ${ledgerBin} abandon.`,
    )
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// New-layout: find slices in .groundwork/next/motives/ for this session
// ---------------------------------------------------------------------------

const NEW_LAYOUT_TRACKER = '.groundwork/next'

/**
 * Look for new-layout slice notes in <projectDir>/.groundwork/next/motives/.
 * Returns a legacy-compatible ledger object if found, or null to fall back.
 * Fail-open: any error returns null.
 */
function findNewLayoutLedger(
  projectDir: string,
  sessionId: string,
): Record<string, unknown> | null {
  if (!sessionId) return null
  try {
    const motivesDir = path.join(projectDir, NEW_LAYOUT_TRACKER, 'motives')
    if (!existsSync(motivesDir)) return null

    let slugs: string[]
    try {
      slugs = readdirSync(motivesDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
    } catch {
      return null
    }

    for (const slug of slugs) {
      try {
        const slices = bySession(projectDir, NEW_LAYOUT_TRACKER, slug, sessionId)
        if (slices.length === 0) continue

        const gateNote = readGate(projectDir, NEW_LAYOUT_TRACKER, slug, sessionId)

        // Build legacy-compatible slice objects
        const legacySlices = slices.map(s => ({
          id: s.id,
          status: s.status,
          kind: s.kind,
          wave: s.wave,
          behavior: '',
          files: [],
          acceptance: [],
          blocked_by: (s as Record<string, unknown>).blocked_by ?? [],
        }))

        const gate: Record<string, unknown> = {}
        if (gateNote != null) {
          if (gateNote.advisor != null) gate.advisor = gateNote.advisor
          if (gateNote.verifier != null) gate.verifier = gateNote.verifier
          if (gateNote.seal != null) gate.seal = gateNote.seal
        }

        const ledger: Record<string, unknown> = {
          active: true,
          session_id: sessionId,
          slices: legacySlices,
          gate,
          motive: slug,
        }
        // Forward pacing if present on gate note (optional field)
        const gn = gateNote as Record<string, unknown> | null
        if (gn?.pacing !== undefined) ledger.pacing = gn.pacing

        return ledger
      } catch {
        // skip this motive, try next
      }
    }
    return null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// LEDGER_BIN path — resolved relative to this file's compiled location.
// src/gw/hook/stop-gate.ts → ../../../bin/ledger from the project root.
// ---------------------------------------------------------------------------

function resolveLedgerBin(): string {
  // GW_REPO_ROOT is set by gw-hook when running the committed bundle (where
  // import.meta.url resolves to dist/gw.mjs, not src/gw/hook/stop-gate.ts).
  // Fall back to three-levels-up for direct source execution.
  const projectRoot =
    process.env.GW_REPO_ROOT ??
    path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
  return path.join(projectRoot, 'bin', 'ledger')
}

// ---------------------------------------------------------------------------
// Exported run function — implements HookFn
// ---------------------------------------------------------------------------

export const run: HookFn = async (
  input: unknown,
  env: Record<string, string | undefined>,
): Promise<HookResult> => {
  try {
    // Embedded SDK agents (sdk-py/sdk-js) have no groundwork ledger — pass through silently.
    if (isEmbeddedAgent(env)) return allow()

    const LEDGER_BIN = resolveLedgerBin()

    const inp = (input ?? {}) as Record<string, unknown>
    const sessionId = typeof inp.session_id === 'string' ? inp.session_id : ''
    const projectDir =
      (typeof inp.cwd === 'string' && inp.cwd ? inp.cwd : null) ||
      env.CLAUDE_PROJECT_DIR ||
      process.cwd()

    let ledger: Record<string, unknown> | undefined
    let ledgerPath: string | undefined

    // --- New-layout path (primary) ---
    const newLayoutLedger = findNewLayoutLedger(projectDir, sessionId)
    if (newLayoutLedger !== null) {
      ledger = newLayoutLedger
      // No ledgerPath: new-layout has no single JSON file to mutateLedger on.
    } else {
      // --- Legacy path ---
      ledgerPath = resolveLedgerPath({
        projectDir,
        sessionId: sessionId || undefined,
      })
      try {
        ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Record<
          string,
          unknown
        >
      } catch {
        // No ledger (trivial task / no active run) or unreadable → nothing to enforce.
        return allow()
      }
    }

    if (!ledger) return allow()

    // active:false release path — sealed ledgers require a valid seal.
    // FAIL-CLOSED: missing key or invalid seal → block.
    if (ledger.active !== true) {
      const sealResult = checkSeal(ledger, projectDir, sessionId)
      if (sealResult === false) {
        return block(
          'Seal verification failed on active:false release path — the ledger seal is invalid or the key is missing. ' +
            'A subagent may have written active:false directly without going through the CLI. ' +
            'Re-run `bin/ledger abandon` to produce a valid seal, or restore the key file.',
        )
      }
      return allow()
    }

    // Never block on a run owned by a different session (defensive layer for legacy fallback).
    if (
      typeof ledger.session_id === 'string' &&
      ledger.session_id &&
      sessionId &&
      ledger.session_id !== sessionId
    ) {
      return allow()
    }

    // Awaiting-human hold — FAIL-CLOSED: missing key or invalid seal → block.
    if (ledger.awaiting_human === true) {
      const sealResult = checkSeal(ledger, projectDir, sessionId)
      if (sealResult === false) {
        return block(
          'awaiting_human hold is set but the ledger seal is invalid or the key is missing. ' +
            'A subagent may have set awaiting_human directly without the orchestrator write_token. ' +
            'Re-run `bin/ledger await-human --token <write_token>` to restore a valid hold, ' +
            'or `bin/ledger await-human --clear --token <write_token>` to release it.',
        )
      }
      return allow()
    }

    const slices = Array.isArray(ledger.slices)
      ? (ledger.slices as Record<string, unknown>[])
      : []
    const TERMINAL_STATUSES = new Set(['complete', 'skipped'])
    const incomplete = slices.filter(
      s => !TERMINAL_STATUSES.has(String(s?.status ?? '')),
    )

    // Only APPROVE is terminal. REPLAN/REVISE/REJECT/pending keep the gate closed.
    const advisorApproved = advisorVerdict(ledger.gate) === 'APPROVE'
    const workRemains = incomplete.length > 0 || !advisorApproved

    if (!workRemains) {
      // Complete + APPROVE — FAIL-CLOSED seal check.
      const sealResult = checkSeal(ledger, projectDir, sessionId)
      if (sealResult === false) {
        return block(
          'Seal verification failed on all-complete + APPROVE release path — the ledger seal is invalid or the key is missing. ' +
            'A subagent may have written gate.advisor=APPROVE directly without going through the CLI. ' +
            'Re-run `bin/ledger gate advisor APPROVE` to produce a valid seal, or restore the key file.',
        )
      }

      emitHookEvent({
        projectDir,
        sessionId,
        ledger,
        type: 'SESSION_END',
        msg: 'session ended — run complete',
        source: 'hook:stop-gate',
        data: { outcome: 'complete' },
      })
      return allow(
        pacingGrantSummary(ledger) +
          tbdAdvisory(projectDir, env) +
          decisionResearchAdvisory(projectDir) +
          decisionAlternativesAdvisory(projectDir) +
          specAdvisory(projectDir),
      )
    }

    // D-29: pacing exhaustion is a sanctioned release path.
    try {
      if (isExhausted(ledger)) {
        return allow(
          pacingGrantSummary(ledger) +
            pacingExhaustionDirective(ledger, incomplete, projectDir) +
            decisionResearchAdvisory(projectDir) +
            decisionAlternativesAdvisory(projectDir) +
            specAdvisory(projectDir),
        )
      }
    } catch {
      // Fail-open: pacing check errors must never wedge the session.
    }

    // Contract B.5/B.6 — kind:plan / plan_ref pre-gate (non-trivial only).
    // FAIL-OPEN: any error falls through (never wedge the session).
    try {
      const brief = typeof ledger.brief === 'string' ? ledger.brief : ''
      const trivialEscape =
        (slices.length <= 2 && !slices.some(s => s?.kind === 'impl')) ||
        /trivial|single-line|config|typo/i.test(brief)
      if (!trivialEscape) {
        const planRef = ledger.plan_ref
        const planRefOk =
          typeof planRef === 'string' && planRef.length > 0 && existsSync(planRef)
        const motiveSlug =
          resolveMotiveSlug(ledger.motive_ref) ??
          (typeof ledger.motive === 'string' && ledger.motive.length > 0
            ? ledger.motive
            : null)
        const motiveOk =
          motiveSlug !== null &&
          existsSync(
            path.join(projectDir, '.groundwork', 'motives', motiveSlug, 'motive.md'),
          )
        const planSliceComplete = slices.some(
          s => (s?.kind === 'plan' || s?.kind === 'design') && s?.status === 'complete',
        )
        if (!planRefOk && !motiveOk && !planSliceComplete) {
          return block(
            'Non-trivial run has no plan artifact (plan_ref missing/absent on disk, motive/motive_ref charter missing, and no plan/design slice complete). Run interview or planner to produce a plan, or set motive/motive_ref to a slug whose charter exists at .groundwork/motives/<slug>/motive.md.',
          )
        }
      }
    } catch {
      // Fail-open: never block on pre-gate errors.
    }

    // Yield-aware: a deliberate turn-end is not a stall.
    if (detectYield(input)) return allow()

    // Consecutive-no-progress reinforcement counter.
    const sig = progressSignature(ledger)
    const prevSig = typeof ledger.progressSig === 'string' ? ledger.progressSig : ''
    const prevCount = Number.isInteger(ledger.reinforcements)
      ? Number(ledger.reinforcements)
      : 0
    const count = sig === prevSig ? prevCount : 0
    if (count >= REINFORCEMENT_CAP) return allow()

    // Persist counter (legacy path only — new-layout has no JSON ledger to mutate).
    if (ledgerPath) {
      try {
        mutateLedger(ledgerPath, fresh => {
          if (!fresh) return null
          fresh.reinforcements = count + 1
          fresh.progressSig = sig
        })
      } catch {
        // Best-effort; still block this time.
      }
    }

    return block(
      buildReason(ledger, incomplete, count, LEDGER_BIN) +
        tbdAdvisory(projectDir, env),
    )
  } catch {
    // Fail-open: never let an uncaught error wedge a user's session.
    return allow()
  }
}
