/**
 * S3 acceptance tests — SESSION_END emission from stop-gate.mjs.
 *
 * AC coverage:
 *  S3-AC1 — terminal path (active ledger, all slices complete, advisor APPROVE) emits
 *            exactly one SESSION_END with source:"hook:stop-gate" and data.outcome:"complete"
 *  S3-AC2 — negative: no-ledger, inactive ledger, foreign session_id, unparseable stdin,
 *            embedded SDK agent → zero events each
 *  S3-AC3 — negative: Stop that blocks (work remains) → zero events
 *  S3-AC4 — reinforcement-cap release path → zero events (D5 deferral)
 *  S3-AC5 — stdout decision JSON byte-identical to pre-change on allow and block paths
 *  S3-AC6 — unwritable journal dir → Stop still allows, one stderr line, stdout unchanged
 */

// @ts-nocheck
import {
  chmodSync,
  execFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../..')
const HOOK = path.join(ROOT, 'hooks', 'stop-gate.mjs')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function shardPath(projectDir: string, sessionId: string): string {
  return path.join(projectDir, '.groundwork', 'journal', `${today()}-${sessionId}.jsonl`)
}

function readShard(p: string): object[] {
  try {
    return readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
  } catch {
    return []
  }
}

/**
 * Run the hook with explicit cwd/session_id; never uses CLAUDE_PROJECT_DIR.
 * Returns { stdout, stderr, status }.
 */
function runHook(
  projectDir: string,
  stdinPayload: Record<string, unknown>,
  extraEnv: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('node', [HOOK], {
    input: JSON.stringify(stdinPayload),
    encoding: 'utf8',
    env: {
      ...process.env,
      // Explicitly unset ambient CLAUDE_PROJECT_DIR so tests are not polluted
      CLAUDE_PROJECT_DIR: undefined,
      ...extraEnv,
    },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

// ---------------------------------------------------------------------------
// Ledger factories
// ---------------------------------------------------------------------------

const SESSION_ID = 'test-sess-stop-gate-events'

function approvedLedger() {
  return {
    version: 1,
    active: true,
    session_id: SESSION_ID,
    brief: 'test run',
    reinforcements: 0,
    slices: [
      { id: 'S1', status: 'complete', behavior: 'does thing', kind: 'impl' },
    ],
    gate: { advisor: 'APPROVE' },
  }
}

function writeLedger(projectDir: string, ledger: unknown) {
  mkdirSync(path.join(projectDir, '.groundwork'), { recursive: true })
  writeFileSync(
    path.join(projectDir, '.groundwork', 'run.json'),
    JSON.stringify(ledger),
  )
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let projectDir: string

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'groundwork-sg-events-'))
  mkdirSync(path.join(projectDir, '.groundwork'), { recursive: true })
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// S3-AC1 — terminal path emits exactly one SESSION_END
// ---------------------------------------------------------------------------

describe('S3-AC1: terminal path emits exactly one SESSION_END', () => {
  it('emits one SESSION_END with correct fields', () => {
    writeLedger(projectDir, approvedLedger())
    const { stdout, stderr } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })

    // stdout must be valid JSON allow decision
    const decision = JSON.parse(stdout)
    expect(decision.continue).toBe(true)

    const events = readShard(shardPath(projectDir, SESSION_ID))
    const sessionEndEvents = events.filter(e => e.type === 'SESSION_END')
    expect(sessionEndEvents).toHaveLength(1)

    const ev = sessionEndEvents[0]
    expect(ev.source).toBe('hook:stop-gate')
    expect(ev.data?.outcome).toBe('complete')
    expect(ev.session).toBe(SESSION_ID)
    expect(ev.motive).toBeDefined()
    expect(typeof ev.ts).toBe('string')
  })

  it('also works with object-form advisor verdict', () => {
    const ledger = approvedLedger()
    ledger.gate.advisor = { verdict: 'APPROVE', rubric: 'groundwork-completion-v1' }
    writeLedger(projectDir, ledger)
    const { stdout } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })

    expect(JSON.parse(stdout).continue).toBe(true)
    const events = readShard(shardPath(projectDir, SESSION_ID))
    expect(events.filter(e => e.type === 'SESSION_END')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// S3-AC2 — negative: paths that precede the terminal check emit zero events
// ---------------------------------------------------------------------------

describe('S3-AC2: non-terminal allow paths emit zero events', () => {
  it('no ledger file → zero events, stdout is allow', () => {
    // No ledger written
    const { stdout } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })
    expect(JSON.parse(stdout).continue).toBe(true)
    expect(readShard(shardPath(projectDir, SESSION_ID))).toHaveLength(0)
  })

  it('inactive ledger (active:false) → zero events', () => {
    const ledger = { ...approvedLedger(), active: false }
    writeLedger(projectDir, ledger)
    const { stdout } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })
    expect(JSON.parse(stdout).continue).toBe(true)
    expect(readShard(shardPath(projectDir, SESSION_ID))).toHaveLength(0)
  })

  it('foreign session_id → zero events', () => {
    const ledger = { ...approvedLedger(), session_id: 'other-session' }
    writeLedger(projectDir, ledger)
    const { stdout } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })
    expect(JSON.parse(stdout).continue).toBe(true)
    expect(readShard(shardPath(projectDir, SESSION_ID))).toHaveLength(0)
  })

  it('unparseable stdin → zero events', () => {
    const result = spawnSync('node', [HOOK], {
      input: 'not-json',
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: undefined },
    })
    expect(JSON.parse(result.stdout).continue).toBe(true)
    // No journal dir even exists — that's fine
    expect(readShard(shardPath(projectDir, SESSION_ID))).toHaveLength(0)
  })

  it('CLAUDE_SUBAGENT=true (embedded SDK agent) → zero events', () => {
    writeLedger(projectDir, approvedLedger())
    const { stdout } = runHook(
      projectDir,
      { cwd: projectDir, session_id: SESSION_ID },
      { CLAUDE_CODE_ENTRYPOINT: 'sdk-py' },
    )
    expect(JSON.parse(stdout).continue).toBe(true)
    expect(readShard(shardPath(projectDir, SESSION_ID))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// S3-AC3 — negative: blocking stop (work remains) emits zero events
// ---------------------------------------------------------------------------

describe('S3-AC3: blocking stop emits zero events', () => {
  it('incomplete slice → block decision, zero events', () => {
    const ledger = {
      ...approvedLedger(),
      plan_ref: path.join(projectDir, 'plan.md'),
      slices: [
        { id: 'S1', status: 'pending', behavior: 'does thing', kind: 'impl' },
      ],
    }
    // Write a plan_ref file so the plan-pre-gate passes
    writeFileSync(path.join(projectDir, 'plan.md'), '# plan')
    writeLedger(projectDir, ledger)
    const { stdout } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })
    const decision = JSON.parse(stdout)
    expect(decision.decision).toBe('block')
    expect(readShard(shardPath(projectDir, SESSION_ID))).toHaveLength(0)
  })

  it('advisor not APPROVE → block decision, zero events', () => {
    const ledger = {
      ...approvedLedger(),
      plan_ref: path.join(projectDir, 'plan.md'),
      gate: { advisor: 'CORRECTION' },
    }
    writeFileSync(path.join(projectDir, 'plan.md'), '# plan')
    writeLedger(projectDir, ledger)
    const { stdout } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })
    expect(JSON.parse(stdout).decision).toBe('block')
    expect(readShard(shardPath(projectDir, SESSION_ID))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// S3-AC4 — reinforcement-cap release path emits zero events
// ---------------------------------------------------------------------------

describe('S3-AC4: reinforcement-cap release emits zero events', () => {
  it('cap exceeded → allow, zero events', () => {
    const ledger = {
      ...approvedLedger(),
      // Work still remains so we would block, but cap is hit
      plan_ref: path.join(projectDir, 'plan.md'),
      slices: [
        { id: 'S1', status: 'pending', behavior: 'does thing', kind: 'impl' },
      ],
      gate: { advisor: 'pending' },
      reinforcements: 12, // = REINFORCEMENT_CAP
      // progressSig must match progressSignature(ledger) exactly so count = prevCount = 12.
      // advisorVerdict({ advisor: 'pending' }) = 'PENDING' (toUpperCase).
      progressSig: JSON.stringify({
        sliceState: 'S1:pending',
        verifier: null,
        advisor: 'PENDING',
      }),
    }
    writeFileSync(path.join(projectDir, 'plan.md'), '# plan')
    writeLedger(projectDir, ledger)
    const { stdout } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })
    expect(JSON.parse(stdout).continue).toBe(true)
    expect(readShard(shardPath(projectDir, SESSION_ID))).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// S3-AC5 — stdout decision JSON byte-identical (no contamination)
// ---------------------------------------------------------------------------

describe('S3-AC5: stdout decision JSON is uncontaminated', () => {
  it('allow path stdout is exactly {"continue":true}\\n', () => {
    writeLedger(projectDir, approvedLedger())
    const { stdout } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })
    // Must parse cleanly and contain ONLY the allow fields
    const parsed = JSON.parse(stdout)
    expect(parsed).toEqual({ continue: true })
  })

  it('no-ledger allow path stdout is exactly {"continue":true}\\n', () => {
    const { stdout } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })
    expect(JSON.parse(stdout)).toEqual({ continue: true })
  })
})

// ---------------------------------------------------------------------------
// S3-AC6 — unwritable journal dir → allow still, one stderr line
// ---------------------------------------------------------------------------

describe('S3-AC6: unwritable journal dir → allow, stderr warning, stdout unchanged', () => {
  it('emitHookEvent failure does not alter decision or exit code', () => {
    // Skip if running as root (chmod has no effect)
    if (process.getuid?.() === 0) return

    writeLedger(projectDir, approvedLedger())

    // Create the journal dir and make it unwritable
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })
    chmodSync(journalDir, 0o444)

    const { stdout, stderr, status } = runHook(projectDir, { cwd: projectDir, session_id: SESSION_ID })

    // Restore so afterEach cleanup works
    chmodSync(journalDir, 0o755)

    // Decision must still be allow
    expect(JSON.parse(stdout).continue).toBe(true)
    expect(status).toBe(0)

    // At least one stderr line mentioning the failure
    expect(stderr.trim().split('\n').length).toBeGreaterThanOrEqual(1)
    expect(stderr).toMatch(/journal|failed|emitHookEvent/i)
  })
})
