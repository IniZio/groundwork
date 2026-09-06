/**
 * test/gw/cli/commands.test.ts — S3-COMMANDS acceptance tests
 * AC1: no NOT_IMPLEMENTED for ledger/journal subcommands
 * AC2: two-surface parity table (legacy bin/ledger vs gw ledger)
 * AC3: write without authority rejected on both surfaces
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

const REPO_ROOT = '/home/newman/.local/share/groundwork'
const CLI_PATH = path.join(REPO_ROOT, 'src/gw/cli/main.ts')
const LEGACY_LEDGER = path.join(REPO_ROOT, 'bin/ledger')
const LEGACY_JOURNAL = path.join(REPO_ROOT, 'bin/journal')
const LIVE_NEXT_DIR = path.join(REPO_ROOT, '.groundwork', 'next')

// Capture live-store state before any tests touch it
let liveNextMtimeBefore: number | null = null
beforeAll(() => {
  try {
    liveNextMtimeBefore = fs.statSync(LIVE_NEXT_DIR).mtimeMs
  } catch {
    liveNextMtimeBefore = null // dir doesn't exist yet — fine
  }
})

// ---- helpers ----

function runGw(args: string[], env?: Record<string, string>, cwd?: string) {
  const result = spawnSync('bun', [CLI_PATH, '--json', ...args], {
    cwd: cwd ?? REPO_ROOT, encoding: 'utf8',
    env: { ...process.env, ...(env ?? {}) },
  })
  let envelope: Record<string, unknown> = {}
  try { envelope = JSON.parse(result.stdout ?? '') } catch { /* non-JSON */ }
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1, envelope }
}

// Run bin/ledger as executable (it is a shell script, not runnable via node)
function runLegacy(args: string[], env?: Record<string, string>) {
  const result = spawnSync(LEGACY_LEDGER, args, {
    cwd: REPO_ROOT, encoding: 'utf8',
    env: { ...process.env, ...(env ?? {}) },
  })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 }
}

function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-parity-'))
  spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' })
  return dir
}

const cleanups: string[] = []
afterEach(() => { for (const d of cleanups.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } } })

// Initialize legacy ledger in dir, return write_token
function initLegacy(dir: string, motive = 'tm'): { token: string } {
  fs.mkdirSync(path.join(dir, '.groundwork'), { recursive: true })
  const initDoc = JSON.stringify({ motive, session_id: 'test-sess', slices: [] })
  const r = spawnSync(LEGACY_LEDGER, ['init', '-'], {
    cwd: REPO_ROOT, encoding: 'utf8', input: initDoc,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
  })
  const m = r.stdout.match(/write_token:\s*([0-9a-f]+)/)
  return { token: m ? m[1] : '' }
}

// Get gw write token from the legacy JSON run store (T16: gw ledger retargeted to JSON).
// Scans .groundwork/runs/ and falls back to run.json.
function gwToken(dir: string, _motive = 'tm'): string {
  const runsDir = path.join(dir, '.groundwork', 'runs')
  if (fs.existsSync(runsDir)) {
    for (const f of fs.readdirSync(runsDir)) {
      if (!f.endsWith('.json')) continue
      try {
        const j = JSON.parse(fs.readFileSync(path.join(runsDir, f), 'utf8')) as { write_token?: string }
        if (j.write_token) return j.write_token
      } catch { /* ignore */ }
    }
  }
  const legacy = path.join(dir, '.groundwork', 'run.json')
  if (fs.existsSync(legacy)) {
    try { return (JSON.parse(fs.readFileSync(legacy, 'utf8')) as { write_token?: string }).write_token ?? '' } catch { return '' }
  }
  return ''
}

// Create a minimal JSON ledger for gw ledger tests (no bin/ledger dependency).
// Uses the ambient CLAUDE_CODE_SESSION_ID so gw ledger resolves the same file.
function initGw(dir: string, motive = 'tm'): { token: string } {
  const sessId = process.env['CLAUDE_CODE_SESSION_ID'] ?? 'default'
  const token = randomBytes(8).toString('hex')
  const runsDir = path.join(dir, '.groundwork', 'runs')
  fs.mkdirSync(runsDir, { recursive: true })
  fs.writeFileSync(
    path.join(runsDir, `${sessId}.json`),
    JSON.stringify({
      active: true, session_id: sessId, motive, write_token: token,
      schema_version: 1, slices: [], gate: {},
    }, null, 2) + '\n',
    'utf8',
  )
  return { token }
}

// ============================================================
// AC1: no NOT_IMPLEMENTED for any ledger/journal subcommand
// ============================================================
describe('AC1 — no NOT_IMPLEMENTED in ledger/journal router', () => {
  const LEDGER_SUBCMDS = [
    'status', 'add', 'set', 'complete', 'rm', 'show', 'view', 'gate',
    'abandon', 'fog', 'frontier', 'claim', 'await-human', 'autopilot',
    'scope-token', 'milestone-signoff',
  ]
  const JOURNAL_SUBCMDS = ['append', 'show', 'compile']

  it('no ledger subcommand returns NOT_IMPLEMENTED', () => {
    const dir = makeTmpDir(); cleanups.push(dir)
    for (const subcmd of LEDGER_SUBCMDS) {
      const { envelope } = runGw(['ledger', subcmd], { CLAUDE_PROJECT_DIR: dir }, dir)
      const code = (envelope as { error?: { code?: string } }).error?.code
      expect(code, `gw ledger ${subcmd} should not return NOT_IMPLEMENTED`).not.toBe('NOT_IMPLEMENTED')
    }
  })

  it('no journal subcommand returns NOT_IMPLEMENTED', () => {
    const dir = makeTmpDir(); cleanups.push(dir)
    for (const subcmd of JOURNAL_SUBCMDS) {
      const { envelope } = runGw(['journal', subcmd], { CLAUDE_PROJECT_DIR: dir }, dir)
      const code = (envelope as { error?: { code?: string } }).error?.code
      expect(code, `gw journal ${subcmd} should not return NOT_IMPLEMENTED`).not.toBe('NOT_IMPLEMENTED')
    }
  })
})

// ============================================================
// AC2: two-surface parity table
// Each scenario runs on BOTH legacy (bin/ledger) and new (gw ledger).
// Uses separate tmpdirs per surface to avoid cross-contamination.
// ============================================================
describe('AC2 — two-surface parity: status after add', () => {
  it('legacy: status exits 0 after add', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    initLegacy(legDir)
    runLegacy(['add', 'S1', '--desc', 'first'], { CLAUDE_PROJECT_DIR: legDir })
    const r = runLegacy(['status'], { CLAUDE_PROJECT_DIR: legDir })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('S1')
  })
  it('new: status exits 0 after add', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    initGw(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1', '--desc', 'first'], {}, gwDir)
    const r = runGw(['ledger', 'status', '--motive', 'tm'], {}, gwDir)
    expect(r.status).toBe(0)
    expect(r.envelope.ok).toBe(true)
  })
})

describe('AC2 — two-surface parity: add + show', () => {
  it('legacy: show S1 exits 0, contains desc', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    initLegacy(legDir)
    runLegacy(['add', 'S1', '--desc', 'test desc', '--wave', '1'], { CLAUDE_PROJECT_DIR: legDir })
    const r = runLegacy(['show', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('test desc')
  })
  it('new: show S1 exits 0, contains desc', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    initGw(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1', '--desc', 'test desc', '--wave', '1'], {}, gwDir)
    const r = runGw(['ledger', 'show', '--motive', 'tm', 'S1'], {}, gwDir)
    expect(r.status).toBe(0)
    const content = String((r.envelope as { data?: { content?: string } }).data?.content ?? '')
    expect(content).toContain('test desc')
  })
})

describe('AC2 — two-surface parity: set --wave', () => {
  it('legacy: set --wave 3 reflected in show', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    initLegacy(legDir)
    runLegacy(['add', 'S1', '--wave', '1'], { CLAUDE_PROJECT_DIR: legDir })
    runLegacy(['set', 'S1', '--wave', '3'], { CLAUDE_PROJECT_DIR: legDir })
    const r = runLegacy(['show', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/wave.*3/)
  })
  it('new: set --wave 3 reflected in show', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    initGw(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1', '--wave', '1'], {}, gwDir)
    runGw(['ledger', 'set', '--motive', 'tm', 'S1', '--wave', '3'], {}, gwDir)
    const r = runGw(['ledger', 'show', '--motive', 'tm', 'S1'], {}, gwDir)
    expect(r.status).toBe(0)
    const content = String((r.envelope as { data?: { content?: string } }).data?.content ?? '')
    expect(content).toMatch(/wave.*3|3.*wave/i)
  })
})

describe('AC2 — two-surface parity: complete with unmet blocked_by', () => {
  // Known divergence: legacy bin/ledger does NOT enforce blocked_by on complete (exits 0).
  // New surface enforces it (exits 1). Both behaviors are documented here.
  it('legacy: complete S2 blocked by pending S1 → exit 0 (no block enforcement)', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    const { token } = initLegacy(legDir)
    runLegacy(['add', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    runLegacy(['add', 'S2', '--blocked-by', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    const r = runLegacy(['complete', 'S2', '--token', token], { CLAUDE_PROJECT_DIR: legDir })
    expect(r.status).toBe(0) // legacy: no blocked_by enforcement
  })
  it('new: complete S2 blocked by pending S1 → exit 1', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    const { token } = initGw(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1'], {}, gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S2', '--blocked-by', 'S1'], {}, gwDir)
    const r = runGw(['ledger', 'complete', '--motive', 'tm', 'S2', '--token', token], {}, gwDir)
    expect(r.status).toBe(1)
    expect(r.envelope.ok).toBe(false)
  })
})

describe('AC2 — two-surface parity: complete after blocker done', () => {
  it('legacy: complete S2 after S1 done → exit 0', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    const { token } = initLegacy(legDir)
    runLegacy(['add', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    runLegacy(['add', 'S2', '--blocked-by', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    runLegacy(['complete', 'S1', '--token', token], { CLAUDE_PROJECT_DIR: legDir })
    const r = runLegacy(['complete', 'S2', '--token', token], { CLAUDE_PROJECT_DIR: legDir })
    expect(r.status).toBe(0)
  })
  it('new: complete S2 after S1 done → exit 0', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    const { token } = initGw(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1'], {}, gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S2', '--blocked-by', 'S1'], {}, gwDir)
    runGw(['ledger', 'complete', '--motive', 'tm', 'S1', '--token', token], {}, gwDir)
    const r = runGw(['ledger', 'complete', '--motive', 'tm', 'S2', '--token', token], {}, gwDir)
    expect(r.status).toBe(0)
    expect(r.envelope.ok).toBe(true)
  })
})

describe('AC2 — two-surface parity: frontier', () => {
  it('legacy: frontier shows S2 after S1 complete', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    const { token } = initLegacy(legDir)
    runLegacy(['add', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    runLegacy(['add', 'S2', '--blocked-by', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    runLegacy(['complete', 'S1', '--token', token], { CLAUDE_PROJECT_DIR: legDir })
    const r = runLegacy(['frontier'], { CLAUDE_PROJECT_DIR: legDir })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('S2')
  })
  it('new: frontier shows S2 after S1 complete', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    const { token } = initGw(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1'], {}, gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S2', '--blocked-by', 'S1'], {}, gwDir)
    runGw(['ledger', 'complete', '--motive', 'tm', 'S1', '--token', token], {}, gwDir)
    const r = runGw(['ledger', 'frontier', '--motive', 'tm'], {}, gwDir)
    expect(r.status).toBe(0)
    const content = String((r.envelope as { data?: { content?: string } }).data?.content ?? '')
    expect(content).toContain('S2')
  })
})

describe('AC2 — two-surface parity: gate advisor APPROVE', () => {
  it('legacy: gate advisor APPROVE → exit 0', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    const { token } = initLegacy(legDir)
    const r = runLegacy(['gate', 'advisor', 'APPROVE', '--token', token], { CLAUDE_PROJECT_DIR: legDir })
    expect(r.status).toBe(0)
  })
  it('new: gate advisor APPROVE → exit 0', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    const { token } = initGw(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1'], {}, gwDir)
    const r = runGw(['ledger', 'gate', '--motive', 'tm', 'advisor', 'APPROVE', '--token', token], { GROUNDWORK_COMMENT_DENSITY: '0' }, gwDir)
    expect(r.status).toBe(0)
    expect(r.envelope.ok).toBe(true)
  })
})

describe('AC2 — two-surface parity: await-human set/clear', () => {
  it('legacy: await-human set then clear → both exit 0', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    const { token } = initLegacy(legDir)
    expect(runLegacy(['await-human', '--token', token], { CLAUDE_PROJECT_DIR: legDir }).status).toBe(0)
    expect(runLegacy(['await-human', 'clear', '--token', token], { CLAUDE_PROJECT_DIR: legDir }).status).toBe(0)
  })
  it('new: await-human set then clear → both exit 0', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    const { token } = initGw(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1'], {}, gwDir)
    expect(runGw(['ledger', 'await-human', '--motive', 'tm', '--token', token], {}, gwDir).status).toBe(0)
    expect(runGw(['ledger', 'await-human', '--motive', 'tm', 'clear', '--token', token], {}, gwDir).status).toBe(0)
  })
})

describe('AC2 — two-surface parity: journal append + show', () => {
  it('legacy: journal append BASELINE then show contains it', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    const env = { CLAUDE_PROJECT_DIR: legDir, CLAUDE_CODE_SESSION_ID: 'test-sess-01', JOURNAL_SESSION_ID: 'test-sess-01' }
    const r1 = spawnSync(LEGACY_JOURNAL, ['append', '--motive', 'tm', '--type', 'BASELINE', '--msg', 'baseline event'], {
      cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, ...env },
    })
    expect(r1.status).toBe(0)
    const r2 = spawnSync(LEGACY_JOURNAL, ['show', '--motive', 'tm', '--last', '5'], {
      cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, ...env },
    })
    expect(r2.status).toBe(0)
    expect(r2.stdout).toContain('BASELINE')
  })
  it('new: journal append BASELINE then show contains it', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    const env = { CLAUDE_PROJECT_DIR: gwDir, CLAUDE_CODE_SESSION_ID: 'test-sess-01' }
    const r1 = runGw(['journal', 'append', '--motive', 'tm', '--type', 'BASELINE', '--msg', 'baseline event'], env, gwDir)
    expect(r1.status).toBe(0)
    const r2 = runGw(['journal', 'show', '--motive', 'tm'], env, gwDir)
    expect(r2.status).toBe(0)
    const content = String((r2.envelope as { data?: { content?: string } }).data?.content ?? '')
    expect(content).toContain('BASELINE')
  })
})

// ============================================================
// AC3: write without authority rejected — both surfaces
// ============================================================
describe('AC3 — write without authority: both surfaces reject', () => {
  it('legacy: complete without token → exit 1', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    initLegacy(legDir)
    runLegacy(['add', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    expect(runLegacy(['complete', 'S1'], { CLAUDE_PROJECT_DIR: legDir }).status).toBe(1)
  })
  it('new: complete without token → exit 1', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1'], { CLAUDE_PROJECT_DIR: gwDir }, gwDir)
    expect(runGw(['ledger', 'complete', '--motive', 'tm', 'S1'], { CLAUDE_PROJECT_DIR: gwDir }, gwDir).status).toBe(1)
  })
  it('legacy: complete with wrong token → exit 1', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    initLegacy(legDir)
    runLegacy(['add', 'S1'], { CLAUDE_PROJECT_DIR: legDir })
    expect(runLegacy(['complete', 'S1', '--token', 'deadbeef'], { CLAUDE_PROJECT_DIR: legDir }).status).toBe(1)
  })
  it('new: complete with wrong token → exit 1', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1'], { CLAUDE_PROJECT_DIR: gwDir }, gwDir)
    expect(runGw(['ledger', 'complete', '--motive', 'tm', 'S1', '--token', 'deadbeef'], { CLAUDE_PROJECT_DIR: gwDir }, gwDir).status).toBe(1)
  })
  it('legacy: gate without token → exit 1', () => {
    const legDir = makeTmpDir(); cleanups.push(legDir)
    initLegacy(legDir)
    expect(runLegacy(['gate', 'advisor', 'APPROVE'], { CLAUDE_PROJECT_DIR: legDir }).status).toBe(1)
  })
  it('new: gate without token → exit 1', () => {
    const gwDir = makeTmpDir(); cleanups.push(gwDir)
    runGw(['ledger', 'add', '--motive', 'tm', 'S1'], { CLAUDE_PROJECT_DIR: gwDir }, gwDir)
    expect(runGw(['ledger', 'gate', '--motive', 'tm', 'advisor', 'APPROVE'], { CLAUDE_PROJECT_DIR: gwDir }, gwDir).status).toBe(1)
  })
})

// ============================================================
// Isolation guard: live .groundwork/next/ must be untouched
// ============================================================
describe('isolation guard — live store must be unmodified', () => {
  it('no test-artifact files written under live .groundwork/next/', () => {
    // Test-only motive slug 'tm' must not appear in the live store
    const liveTm = path.join(LIVE_NEXT_DIR, 'motives', 'tm')
    expect(fs.existsSync(liveTm), `test pollution: ${liveTm} exists in live store`).toBe(false)
  })

  it('live .groundwork/next/ mtime unchanged since suite start', () => {
    if (liveNextMtimeBefore === null) {
      // Dir didn't exist before — assert it still doesn't (or was created by a non-test actor)
      const exists = fs.existsSync(LIVE_NEXT_DIR)
      if (exists) {
        // If it was created during the test run, check no 'tm' motive inside it
        const liveTm = path.join(LIVE_NEXT_DIR, 'motives', 'tm')
        expect(fs.existsSync(liveTm), `test pollution: ${liveTm} created during test run`).toBe(false)
      }
      return
    }
    let currentMtime: number
    try {
      currentMtime = fs.statSync(LIVE_NEXT_DIR).mtimeMs
    } catch {
      return // dir removed — also fine
    }
    expect(currentMtime).toBe(liveNextMtimeBefore)
  })
})

// ============================================================
// GW-CLI-R-004: session-id resolution — loud failure when absent
// ============================================================
// @verifies GW-CLI-R-004
describe('GW-CLI-R-004 — session-id resolution', () => {
  it('exits non-zero and names CLAUDE_CODE_SESSION_ID on stderr when session env is absent', () => {
    const dir = makeTmpDir(); cleanups.push(dir)
    // Build env without CLAUDE_CODE_SESSION_ID — the value under test must not be injected.
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== 'CLAUDE_CODE_SESSION_ID' && v !== undefined) env[k] = v
    }
    const r = spawnSync('bun', [CLI_PATH, 'ledger', 'status', '--motive', 'tm'], {
      cwd: dir, encoding: 'utf8', env,
    })
    expect(r.status, 'CLI must exit non-zero when CLAUDE_CODE_SESSION_ID is absent').not.toBe(0)
    expect(r.stderr, 'stderr must name the missing variable').toContain('CLAUDE_CODE_SESSION_ID')
  })

  it('resolves .groundwork/runs/<session>.json when CLAUDE_CODE_SESSION_ID is set', () => {
    const dir = makeTmpDir(); cleanups.push(dir)
    const sessId = 'testsession123'
    const token = randomBytes(8).toString('hex')
    const runsDir = path.join(dir, '.groundwork', 'runs')
    fs.mkdirSync(runsDir, { recursive: true })
    fs.writeFileSync(
      path.join(runsDir, `${sessId}.json`),
      JSON.stringify({
        active: true, session_id: sessId, motive: 'tm',
        write_token: token, schema_version: 1, slices: [], gate: {},
      }, null, 2) + '\n',
      'utf8',
    )
    const r = runGw(['ledger', 'status', '--motive', 'tm'], { CLAUDE_CODE_SESSION_ID: sessId }, dir)
    expect(r.status).toBe(0)
    expect(r.envelope.ok).toBe(true)
  })

  it('falls back to run.json when CLAUDE_CODE_SESSION_ID does not satisfy [A-Za-z0-9_-]{1,128}', () => {
    const dir = makeTmpDir(); cleanups.push(dir)
    const badId = 'invalid!!session' // contains ! — fails SAFE_ID
    const token = randomBytes(8).toString('hex')
    const gwDir = path.join(dir, '.groundwork')
    fs.mkdirSync(gwDir, { recursive: true })
    // Give run.json a different session_id — this is the case that distinguishes
    // the SAFE_ID guard from the legacyOwner fallback: without the guard the
    // legacyOwner check would skip run.json (owner != badId) and try a non-existent
    // perSessionPath, yielding a non-zero exit.
    fs.writeFileSync(
      path.join(gwDir, 'run.json'),
      JSON.stringify({
        active: true, session_id: 'other-session', motive: 'tm',
        write_token: token, schema_version: 1, slices: [], gate: {},
      }, null, 2) + '\n',
      'utf8',
    )
    const r = runGw(['ledger', 'status', '--motive', 'tm'], { CLAUDE_CODE_SESSION_ID: badId }, dir)
    expect(r.status, 'CLI must exit 0 reading run.json when sessionId fails SAFE_ID pattern').toBe(0)
    expect(r.envelope.ok, 'envelope must be ok').toBe(true)
  })

  it('uses CLAUDE_PROJECT_DIR over process.cwd() when non-empty', () => {
    const dir = makeTmpDir(); cleanups.push(dir)
    const sessId = 'projdirtest'
    const token = randomBytes(8).toString('hex')
    const runsDir = path.join(dir, '.groundwork', 'runs')
    fs.mkdirSync(runsDir, { recursive: true })
    fs.writeFileSync(
      path.join(runsDir, `${sessId}.json`),
      JSON.stringify({
        active: true, session_id: sessId, motive: 'tm',
        write_token: token, schema_version: 1, slices: [], gate: {},
      }, null, 2) + '\n',
      'utf8',
    )
    // cwd defaults to REPO_ROOT (which has no ledger for this motive/session)
    // CLAUDE_PROJECT_DIR points to dir — CLI must read from there
    const r = runGw(
      ['ledger', 'status', '--motive', 'tm'],
      { CLAUDE_CODE_SESSION_ID: sessId, CLAUDE_PROJECT_DIR: dir },
    )
    expect(r.status, 'CLI must exit 0 when CLAUDE_PROJECT_DIR overrides cwd').toBe(0)
    expect(r.envelope.ok, 'envelope must be ok').toBe(true)
  })
})
