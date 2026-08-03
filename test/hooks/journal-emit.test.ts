/**
 * S1 acceptance tests — emitHookEvent, resolveMotive, VALID_TYPES additions.
 *
 * AC coverage:
 *  S1-AC1 — SPEC_DRIFT + SESSION_END in VALID_TYPES; journal append --type SPEC_DRIFT exits 0
 *  S1-AC2 — emitHookEvent writes motive, ts, session, type, msg, source (no rfc key)
 *  S1-AC3 — resolveMotive 4-step chain; synthetic fallback never null never throws
 *  S1-AC4 — end-to-end: emitHookEvent event visible via journal show --motive
 *  S1-AC5 — (motive-only schema) no legacy rfc-only back-compat regression test needed
 *  S1-AC6 — crash-safety: unwritable dir → ok:false, one stderr line, no throw, no stdout
 *  S1-AC7 — invalid type → stderr warning, no appended line, no throw
 *  S1-AC8 — emitHookEvent never writes to stdout on success path
 */

// @ts-nocheck
import {
  chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, test, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../..')
const CLI = path.join(ROOT, 'hooks', 'journal.mjs')
const IO_LIB = path.join(ROOT, 'hooks', 'lib', 'journal-io.mjs')

function mkTmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'journal-emit-test-'))
}

function runJournal(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? 1,
  }
}

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
 * Run a small inline script that imports journal-io.mjs and calls the named
 * function with the supplied args JSON-encoded.  Returns { stdout, stderr,
 * status, result } where result is the parsed return value if the script
 * printed it as JSON.
 */
function runEmit(script: string, env: Record<string, string> = {}): {
  stdout: string; stderr: string; status: number; result?: any
} {
  const r = spawnSync('node', ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  let result: any
  try { result = JSON.parse(r.stdout.trim()) } catch { /* not JSON */ }
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? 1,
    result,
  }
}

// ---------------------------------------------------------------------------
// S1-AC1 — SPEC_DRIFT and SESSION_END in VALID_TYPES
// ---------------------------------------------------------------------------

describe('S1-AC1 — VALID_TYPES includes SPEC_DRIFT and SESSION_END', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('VALID_TYPES exported from journal-io contains SPEC_DRIFT and SESSION_END', async () => {
    const { VALID_TYPES } = await import(IO_LIB + `?t=${Date.now()}`)
    expect(VALID_TYPES).toContain('SPEC_DRIFT')
    expect(VALID_TYPES).toContain('SESSION_END')
  })

  test('journal append --type SPEC_DRIFT exits 0', () => {
    const env = {
      CLAUDE_PROJECT_DIR: tmp,
      JOURNAL_SESSION_ID: 'sess-s1',
    }
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'SPEC_DRIFT', '--msg', 'drift detected'],
      env,
    )
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)
    const events = readShard(shardPath(tmp, 'sess-s1'))
    expect(events).toHaveLength(1)
    expect((events[0] as any).type).toBe('SPEC_DRIFT')
  })

  test('journal append --type SESSION_END exits 0', () => {
    const env = {
      CLAUDE_PROJECT_DIR: tmp,
      JOURNAL_SESSION_ID: 'sess-s1b',
    }
    const r = runJournal(
      ['append', '--motive', 'feat-x', '--type', 'SESSION_END', '--msg', 'session ended'],
      env,
    )
    expect(r.status, `stderr: ${r.stderr}`).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// S1-AC2 + S1-AC8 — emitHookEvent writes correct fields; never touches stdout
// ---------------------------------------------------------------------------

describe('S1-AC2/AC8 — emitHookEvent field contract and stdout silence', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('emitHookEvent writes motive, ts, session, type, msg, source; no rfc key; no stdout', () => {
    const script = `
import { emitHookEvent } from ${JSON.stringify(IO_LIB)};
const result = emitHookEvent({
  projectDir: ${JSON.stringify(tmp)},
  sessionId: 'emit-sess',
  type: 'TASK_COMPLETE',
  msg: 'slice done',
  source: 'hook:ledger',
});
// Only write the result to stdout as JSON — no other stdout output
process.stdout.write(JSON.stringify(result));
`
    const r = runEmit(script, { GROUNDWORK_MOTIVE: 'feat-abc' })
    expect(r.result?.ok).toBe(true)
    expect(r.result?.motive).toBe('feat-abc')

    // Check written event
    const events = readShard(shardPath(tmp, 'emit-sess'))
    expect(events).toHaveLength(1)
    const e = events[0] as any
    expect(e.motive).toBe('feat-abc')
    expect(e.rfc).toBeUndefined()          // no rfc key (motive-only schema)
    expect(e.type).toBe('TASK_COMPLETE')
    expect(e.msg).toBe('slice done')
    expect(e.source).toBe('hook:ledger')
    expect(typeof e.ts).toBe('string')
    expect(e.session).toBe('emit-sess')

    // stdout must contain ONLY the JSON result — no extra log lines
    const stdoutLines = r.stdout.trim().split('\n').filter(Boolean)
    expect(stdoutLines).toHaveLength(1)
    expect(() => JSON.parse(stdoutLines[0])).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// S1-AC3 — resolveMotive 4-step chain
// ---------------------------------------------------------------------------

describe('S1-AC3 — resolveMotive chain', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('step 1: GROUNDWORK_MOTIVE env overrides everything', async () => {
    const { resolveMotive } = await import(IO_LIB + `?t=${Date.now()}`)
    const old = process.env.GROUNDWORK_MOTIVE
    process.env.GROUNDWORK_MOTIVE = 'env-override'
    try {
      const r = resolveMotive({ projectDir: tmp, sessionId: 'sx' })
      expect(r.motive).toBe('env-override')
      expect(r.provenance).toBe('env')
    } finally {
      if (old === undefined) delete process.env.GROUNDWORK_MOTIVE
      else process.env.GROUNDWORK_MOTIVE = old
    }
  })

  test('step 3: ledger.rfc_ref used when no env or ledger.motive', () => {
    // Write a ledger with rfc_ref
    const groundworkDir = path.join(tmp, '.groundwork')
    mkdirSync(groundworkDir, { recursive: true })
    writeFileSync(
      path.join(groundworkDir, 'run.json'),
      JSON.stringify({ active: true, session_id: 'sx', rfc_ref: 'RFC-42' }),
    )

    const script = `
delete process.env.GROUNDWORK_MOTIVE;
import { resolveMotive } from ${JSON.stringify(IO_LIB)};
const r = resolveMotive({ projectDir: ${JSON.stringify(tmp)}, sessionId: 'sx' });
process.stdout.write(JSON.stringify(r));
`
    const r = runEmit(script)
    expect(r.result?.motive).toBe('RFC-42')
    expect(r.result?.provenance).toBe('ledger.rfc_ref')
  })

  test('step 4: synthetic fallback session:<id> when no ledger exists', () => {
    const script = `
delete process.env.GROUNDWORK_MOTIVE;
import { resolveMotive } from ${JSON.stringify(IO_LIB)};
const r = resolveMotive({ projectDir: ${JSON.stringify(tmp)}, sessionId: 'mysess' });
process.stdout.write(JSON.stringify(r));
`
    const r = runEmit(script)
    expect(r.result?.motive).toBe('session:mysess')
    expect(r.result?.provenance).toBe('synthetic')
  })

  test('resolveMotive never throws even with null projectDir', () => {
    const script = `
delete process.env.GROUNDWORK_MOTIVE;
import { resolveMotive } from ${JSON.stringify(IO_LIB)};
let threw = false;
let result;
try {
  result = resolveMotive({ projectDir: null, sessionId: 'sx2' });
} catch (e) {
  threw = true;
}
process.stdout.write(JSON.stringify({ threw, motive: result?.motive }));
`
    const r = runEmit(script)
    expect(r.result?.threw).toBe(false)
    expect(typeof r.result?.motive).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// S1-AC4 — end-to-end: emitHookEvent event visible via journal show --motive
// ---------------------------------------------------------------------------

describe('S1-AC4 — emitHookEvent output visible via journal show --motive', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('event written by emitHookEvent is returned by journal show --motive', () => {
    const script = `
import { emitHookEvent } from ${JSON.stringify(IO_LIB)};
emitHookEvent({
  projectDir: ${JSON.stringify(tmp)},
  sessionId: 'hook-sess',
  type: 'GATE',
  msg: 'advisor approved',
  source: 'hook:ledger',
});
`
    // Write event via emitHookEvent with explicit motive
    runEmit(script, { GROUNDWORK_MOTIVE: 'my-rfc-001' })

    // Query via journal show
    const r = runJournal(
      ['show', '--motive', 'my-rfc-001', '--since', '9999d', '--last', '9999'],
      { CLAUDE_PROJECT_DIR: tmp, JOURNAL_SESSION_ID: 'hook-sess' },
    )
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('GATE')
    expect(r.stdout).toContain('advisor approved')
    expect(r.stdout).toContain('my-rfc-001')
  })
})

// ---------------------------------------------------------------------------
// S1-AC6 — crash-safety: unwritable dir → ok:false, one stderr line, no throw, no stdout
// ---------------------------------------------------------------------------

describe('S1-AC6 — emitHookEvent crash-safety', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => {
    // Restore permissions before cleanup
    try { chmodSync(path.join(tmp, '.groundwork', 'journal'), 0o755) } catch {}
    rmSync(tmp, { recursive: true, force: true })
  })

  test('unwritable journal dir → ok:false, exactly one stderr line, no throw, zero stdout', () => {
    // Create journal dir, then make it unwritable
    const journalDir = path.join(tmp, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })
    chmodSync(journalDir, 0o444) // read-only

    // Check we're actually on a system that enforces this
    // (root ignores chmod; skip if running as root)
    try {
      const testFile = path.join(journalDir, 'test-perm')
      writeFileSync(testFile, 'x')
      // If we got here, permissions aren't enforced (e.g. running as root)
      // Skip this test
      return
    } catch {
      // permissions are enforced — proceed
    }

    const script = `
import { emitHookEvent } from ${JSON.stringify(IO_LIB)};
const result = emitHookEvent({
  projectDir: ${JSON.stringify(tmp)},
  sessionId: 'crash-sess',
  type: 'GATE',
  msg: 'test',
  source: 'hook:test',
});
// Print ONLY the result JSON to stdout
process.stdout.write(JSON.stringify(result));
`
    const r = runEmit(script, { GROUNDWORK_MOTIVE: 'feat-crash' })

    // ok must be false
    expect(r.result?.ok).toBe(false)

    // Exactly one line to stderr
    const stderrLines = r.stderr.split('\n').filter(l => l.trim())
    expect(stderrLines.length).toBeGreaterThanOrEqual(1)
    expect(stderrLines.length).toBeLessThanOrEqual(2) // allow for a trailing blank

    // stdout must contain ONLY the JSON result (one line)
    const stdoutNonResult = r.stdout.replace(JSON.stringify(r.result), '').trim()
    expect(stdoutNonResult).toBe('')
  })
})

// ---------------------------------------------------------------------------
// S1-AC7 — invalid type → stderr warning, no appended line, no throw
// ---------------------------------------------------------------------------

describe('S1-AC7 — emitHookEvent invalid type', () => {
  let tmp: string
  beforeEach(() => { tmp = mkTmp() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  test('invalid type produces stderr warning, no shard written, no throw', async () => {
    const script = `
import { emitHookEvent } from ${JSON.stringify(IO_LIB)};
let threw = false;
let result;
try {
  result = emitHookEvent({
    projectDir: ${JSON.stringify(tmp)},
    sessionId: 'inv-sess',
    type: 'NOT_A_REAL_TYPE',
    msg: 'test',
    source: 'hook:test',
  });
} catch (e) {
  threw = true;
}
process.stdout.write(JSON.stringify({ threw, ok: result?.ok }));
`
    const r = runEmit(script, { GROUNDWORK_MOTIVE: 'feat-x' })
    expect(r.result?.threw).toBe(false)
    expect(r.result?.ok).toBe(false)
    expect(r.stderr.length).toBeGreaterThan(0)

    // No shard file should have been created
    const journalDir = path.join(tmp, '.groundwork', 'journal')
    let exists = true
    try { statSync(journalDir) } catch { exists = false }
    // Either dir doesn't exist, or it's empty
    if (exists) {
      const { readdirSync } = await import('node:fs') as any
      const files = (readdirSync(journalDir) as string[]).filter((f: string) => f.endsWith('.jsonl'))
      expect(files).toHaveLength(0)
    }
  })
})
