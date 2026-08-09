/**
 * test/hooks/struggle-detector-events.test.ts
 *
 * Tests that struggle-detector emits FAILURE journal events when the struggle
 * threshold is crossed (S5 slice of motive-step2-hook-events plan).
 *
 * Fixture dirs are pinned explicitly — never reads ambient CLAUDE_PROJECT_DIR.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readAllEvents } from '../../hooks/lib/journal-io.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDir(): string {
  const d = path.join(
    os.tmpdir(),
    `gw-sd-events-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(d, { recursive: true })
  return d
}

async function loadDetector() {
  // @ts-expect-error — .mjs, no types
  return await import('../../hooks/struggle-detector.mjs')
}

function bashPayload(opts: {
  command: string
  exitCode?: number
  stderr?: string
  sessionId: string
  cwd: string
}) {
  return {
    tool_name: 'Bash',
    tool_input: { command: opts.command },
    tool_response: {
      exit_code: opts.exitCode ?? 0,
      stderr: opts.stderr ?? '',
    },
    session_id: opts.sessionId,
    cwd: opts.cwd,
  }
}

function editPayload(opts: { filePath: string; sessionId: string; cwd: string }) {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: opts.filePath },
    tool_response: {},
    session_id: opts.sessionId,
    cwd: opts.cwd,
  }
}

function readJournalEvents(projectDir: string): unknown[] {
  const journalDir = path.join(projectDir, '.groundwork', 'journal')
  return readAllEvents(journalDir)
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string
let detector: { processPayload: (payload: unknown, opts?: { threshold?: number }) => Promise<void> }
let savedEnv: Record<string, string | undefined>

beforeEach(async () => {
  tmpDir = makeDir()
  savedEnv = {
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
    GROUNDWORK_MOTIVE: process.env.GROUNDWORK_MOTIVE,
  }
  // Unset ambient vars so detector uses payload.cwd as projectDir.
  delete process.env.CLAUDE_PROJECT_DIR
  // Pin a synthetic motive so resolveMotive doesn't attempt ledger reads.
  process.env.GROUNDWORK_MOTIVE = 'test:struggle-events'
  detector = await loadDetector()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

// ---------------------------------------------------------------------------
// S5-AC1 + S5-AC2: threshold trip → exactly one FAILURE event
// ---------------------------------------------------------------------------

describe('S5-AC1/AC2 — FAILURE emitted on threshold trip', () => {
  test('repeat-command: 3 identical Bash calls → one FAILURE with correct payload', async () => {
    const sid = 'ses-ev-repeat'
    const cmd = 'echo hello-unique-ac1'
    const payload = bashPayload({ command: cmd, sessionId: sid, cwd: tmpDir })

    await detector.processPayload(payload, { threshold: 3 })
    await detector.processPayload(payload, { threshold: 3 })
    // First two calls: below threshold — no FAILURE yet.
    expect(readJournalEvents(tmpDir).filter((e: any) => e.type === 'FAILURE')).toHaveLength(0)

    // Third call crosses threshold.
    await detector.processPayload(payload, { threshold: 3 })
    const events = readJournalEvents(tmpDir).filter((e: any) => e.type === 'FAILURE')
    expect(events).toHaveLength(1)

    const ev: any = events[0]
    expect(ev.type).toBe('FAILURE')
    expect(ev.source).toBe('hook:struggle-detector')
    expect(ev.data.kind).toBe('repeat-command')
    expect(typeof ev.data.fingerprint).toBe('string')
    expect(ev.data.count).toBe(3)
    expect(ev.motive).toBe('test:struggle-events')
  })

  test('AC2 — 5 calls on same fingerprint still produce exactly one FAILURE', async () => {
    const sid = 'ses-ev-agg'
    const cmd = 'echo agg-test'
    const payload = bashPayload({ command: cmd, sessionId: sid, cwd: tmpDir })

    for (let i = 0; i < 5; i++) {
      await detector.processPayload(payload, { threshold: 3 })
    }
    const events = readJournalEvents(tmpDir).filter((e: any) => e.type === 'FAILURE')
    expect(events).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// S5-AC3: below-threshold activity → zero journal writes
// ---------------------------------------------------------------------------

describe('S5-AC3 — no journal writes below threshold', () => {
  test('two calls on same Bash command emit no journal events', async () => {
    const sid = 'ses-ev-below'
    const payload = bashPayload({ command: 'echo below', sessionId: sid, cwd: tmpDir })

    await detector.processPayload(payload, { threshold: 3 })
    await detector.processPayload(payload, { threshold: 3 })

    // Journal dir should not exist or contain no events.
    const events = readJournalEvents(tmpDir)
    expect(events.filter((e: any) => e.type === 'FAILURE')).toHaveLength(0)
  })

  test('completely unrelated single call emits no events', async () => {
    const sid = 'ses-ev-single'
    const payload = bashPayload({ command: 'ls', sessionId: sid, cwd: tmpDir })
    await detector.processPayload(payload, { threshold: 3 })

    const events = readJournalEvents(tmpDir)
    expect(events).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// S5-AC4: other signal kinds emit FAILURE with matching data.kind
// ---------------------------------------------------------------------------

describe('S5-AC4 — other signal kinds emit FAILURE', () => {
  test('file-thrash: 3 edits to same file → FAILURE with kind=file-thrash', async () => {
    const sid = 'ses-ev-thrash'
    const filePath = path.join(tmpDir, 'src', 'foo.ts')
    const payload = editPayload({ filePath, sessionId: sid, cwd: tmpDir })

    await detector.processPayload(payload, { threshold: 3 })
    await detector.processPayload(payload, { threshold: 3 })
    await detector.processPayload(payload, { threshold: 3 })

    const events = readJournalEvents(tmpDir).filter((e: any) => e.type === 'FAILURE')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'FAILURE',
      source: 'hook:struggle-detector',
      data: { kind: 'file-thrash' },
    })
  })

  test('fail-retry: retry after failed command → FAILURE with kind=fail-retry', async () => {
    const sid = 'ses-ev-failretry'
    const cmd = 'false-command-unique'
    // First call fails.
    await detector.processPayload(
      bashPayload({ command: cmd, exitCode: 1, stderr: 'error', sessionId: sid, cwd: tmpDir }),
      { threshold: 10 },
    )
    // Second call retries same fp (hadFail=true, count>=2 triggers fail-retry).
    await detector.processPayload(
      bashPayload({ command: cmd, exitCode: 1, stderr: 'error', sessionId: sid, cwd: tmpDir }),
      { threshold: 10 },
    )

    const events = readJournalEvents(tmpDir).filter((e: any) => e.type === 'FAILURE')
    expect(events).toHaveLength(1)
    expect((events[0] as any).data.kind).toBe('fail-retry')
  })

  test('error-signature: same stderr repeated ≥ threshold → FAILURE with kind=error-signature', async () => {
    const sid = 'ses-ev-errsig'
    const cmd = 'errsig-cmd'
    const stderr = 'SyntaxError: unexpected token at line 1'

    for (let i = 0; i < 3; i++) {
      await detector.processPayload(
        bashPayload({ command: cmd + i, exitCode: 1, stderr, sessionId: sid, cwd: tmpDir }),
        { threshold: 3 },
      )
    }

    const events = readJournalEvents(tmpDir).filter((e: any) => e.type === 'FAILURE')
    expect(events).toHaveLength(1)
    expect((events[0] as any).data.kind).toBe('error-signature')
  })
})

// ---------------------------------------------------------------------------
// S5-AC5: journal write failure → hook behavior unchanged
// ---------------------------------------------------------------------------

describe('S5-AC5 — journal failure is fail-open', () => {
  test('unwritable journal dir → signals still appended, hook does not throw', async () => {
    const sid = 'ses-ev-failopen'
    // Corrupt the journal dir by creating a regular file in its place.
    const journalDir = path.join(tmpDir, '.groundwork', 'journal')
    mkdirSync(path.join(tmpDir, '.groundwork'), { recursive: true })
    writeFileSync(journalDir, 'not-a-directory')

    const cmd = 'echo failopen'
    const payload = bashPayload({ command: cmd, sessionId: sid, cwd: tmpDir })

    // Should not throw even with an unwritable journal.
    await expect(
      (async () => {
        for (let i = 0; i < 3; i++) {
          await detector.processPayload(payload, { threshold: 3 })
        }
      })(),
    ).resolves.toBeUndefined()

    // The struggle signals file should still be written (signals-io is separate from journal).
    const signalsPath = path.join(tmpDir, '.groundwork', 'struggle-signals.jsonl')
    expect(existsSync(signalsPath)).toBe(true)
    const signals = readFileSync(signalsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l))
    expect(signals.some((s: any) => s.kind === 'repeat-command')).toBe(true)
  })
})
