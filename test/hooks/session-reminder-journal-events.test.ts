/**
 * S7 acceptance tests — session-reminder.mjs SESSION_START events
 * migrated onto emitHookEvent (motive-keyed, no legacy appendEvent path).
 *
 * AC coverage:
 *  S7-AC1 — emitHookEvent produces motive key when called with SESSION_START type
 *  S7-AC2 — hook stdout (continue:true JSON) is unchanged when journal dir is unwritable
 */

// @ts-nocheck
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { describe, expect, test, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../..')
const HOOK = path.join(ROOT, 'hooks', 'session-reminder.mjs')
const IO_LIB = path.join(ROOT, 'hooks', 'lib', 'journal-io.mjs')

function mkTmp(): string {
  return mkdtempSync(path.join(tmpdir(), 'sr-journal-test-'))
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
      .map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

/**
 * Run a small inline script importing journal-io.mjs.
 * Returns { stdout, stderr, status, result }.
 */
function runEmit(
  script: string,
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number; result?: any } {
  const r = spawnSync('node', ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10_000,
  })
  let result: any
  try {
    result = JSON.parse(r.stdout)
  } catch {}
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? 1,
    result,
  }
}

/**
 * Run the session-reminder hook and return the parsed JSON output.
 */
function runHook(
  projectDir: string,
  sessionId = 'sess-s7',
): { stdout: string; stderr: string; status: number } {
  const input = JSON.stringify({ cwd: projectDir, session_id: sessionId, source: 'compact' })
  const r = spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    timeout: 15_000,
  })
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? 1,
  }
}

// ---------------------------------------------------------------------------

let projectDir: string

beforeEach(() => {
  projectDir = mkTmp()
  mkdirSync(path.join(projectDir, '.groundwork'), { recursive: true })
})

afterEach(() => {
  // restore perms so cleanup works on linux
  try { chmodSync(path.join(projectDir, '.groundwork', 'journal'), 0o755) } catch {}
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// S7-AC1 — emitHookEvent produces motive key for SESSION_START type
// ---------------------------------------------------------------------------

describe('S7-AC1: emitHookEvent produces motive key for SESSION_START', () => {
  test('motive key is present on a written SESSION_START event', () => {
    const sessionId = 'sess-s7-ac1'
    const script = `
import { emitHookEvent } from ${JSON.stringify(IO_LIB)};
const ret = emitHookEvent({
  projectDir: ${JSON.stringify(projectDir)},
  sessionId: ${JSON.stringify(sessionId)},
  type: 'SESSION_START',
  source: 'hook:session-reminder',
  msg: 'spec_skeleton_dropped',
  data: { event: 'spec_skeleton_dropped' },
});
// emitHookEvent returns a Promise or plain object — handle both
Promise.resolve(ret).then(r => console.log(JSON.stringify(r)));
`
    const { result } = runEmit(script)
    expect(result).toBeDefined()
    expect(result?.ok).toBe(true)

    const shard = shardPath(projectDir, sessionId)
    const events = readShard(shard)
    expect(events.length).toBeGreaterThan(0)

    const evt = events[events.length - 1] as any
    // Must have motive key — the migrated path uses emitHookEvent which resolves motive
    expect(evt).toHaveProperty('motive')
    expect(typeof evt.motive).toBe('string')
    expect(evt.motive.length).toBeGreaterThan(0)
    // Must NOT have rfc key (S1 deviation: motive-only schema)
    expect(evt).not.toHaveProperty('rfc')
    // type and source are correct
    expect(evt.type).toBe('SESSION_START')
    expect(evt.source).toBe('hook:session-reminder')
  })

  test('motive key present for injection_over_alarm variant', () => {
    const sessionId = 'sess-s7-alarm'
    const script = `
import { emitHookEvent } from ${JSON.stringify(IO_LIB)};
const ret = emitHookEvent({
  projectDir: ${JSON.stringify(projectDir)},
  sessionId: ${JSON.stringify(sessionId)},
  type: 'SESSION_START',
  source: 'hook:session-reminder',
  msg: 'injection_over_alarm',
  data: { event: 'injection_over_alarm', total_tokens: 4000, alarm_threshold: 3300 },
});
Promise.resolve(ret).then(r => console.log(JSON.stringify(r)));
`
    runEmit(script)

    const shard = shardPath(projectDir, sessionId)
    const events = readShard(shard)
    expect(events.length).toBeGreaterThan(0)

    const evt = events[events.length - 1] as any
    expect(evt).toHaveProperty('motive')
    expect(evt.type).toBe('SESSION_START')
    expect(evt).not.toHaveProperty('rfc')
  })
})

// ---------------------------------------------------------------------------
// S7-AC2 — hook stdout unchanged when journal dir is unwritable
// ---------------------------------------------------------------------------

describe('S7-AC2: hook stdout unchanged when journal dir is unwritable', () => {
  test('hook still emits continue:true JSON when journal dir is a regular file', () => {
    // Place a regular file where the journal dir would go — emitHookEvent will
    // fail to create the shard, but must not propagate the error to stdout.
    const journalPath = path.join(projectDir, '.groundwork', 'journal')
    writeFileSync(journalPath, 'not-a-dir')

    const { stdout, status } = runHook(projectDir, 'sess-s7-ac2')

    // Hook must exit 0
    expect(status).toBe(0)

    // stdout must be valid JSON with continue:true
    let parsed: any
    expect(() => { parsed = JSON.parse(stdout) }).not.toThrow()
    expect(parsed?.continue).toBe(true)
    expect(parsed?.hookSpecificOutput?.additionalContext).toBeDefined()
  })

  test('hook stdout contains no extra bytes from journal failure (no stdout pollution)', () => {
    const journalPath = path.join(projectDir, '.groundwork', 'journal')
    writeFileSync(journalPath, 'not-a-dir')

    const { stdout } = runHook(projectDir, 'sess-s7-ac2b')

    // Exactly one JSON line on stdout
    const lines = stdout.trim().split('\n').filter(Boolean)
    expect(lines).toHaveLength(1)

    const parsed = JSON.parse(lines[0])
    expect(parsed.continue).toBe(true)
  })
})
