/**
 * test/struggle-detector.test.ts
 *
 * Unit tests for hooks/struggle-detector.mjs (Slice 1 — struggle detection).
 *
 * Strategy: invoke the detector's `detect()` helper directly (we export it for
 * testing) via a thin ES-module dynamic import.  Each test provides a fake
 * PostToolUse payload and a temp projectDir; we then inspect the cross-session
 * signals file and the per-session tally file.
 *
 * We DO NOT test the stdin/stdout plumbing (that's integration-level); we test
 * the detection logic that matters — thresholds, once-per-session guards, and
 * fail-open on bad input.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { readSignals } from '../hooks/lib/signals-io.mjs'

// ---------------------------------------------------------------------------
// Helpers — build a fake PostToolUse payload and invoke the detector's core logic
// ---------------------------------------------------------------------------

/**
 * Dynamically import the detector module.
 * We import `processPayload` — the pure detection function exported for tests.
 */
async function loadDetector() {
  // @ts-expect-error — .mjs, no types
  return await import('../hooks/struggle-detector.mjs')
}

/** Build a minimal Bash PostToolUse payload. */
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

/** Build a minimal Edit PostToolUse payload. */
function editPayload(opts: { filePath: string; sessionId: string; cwd: string }) {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: opts.filePath },
    tool_response: {},
    session_id: opts.sessionId,
    cwd: opts.cwd,
  }
}

/** Build a minimal Write PostToolUse payload. */
function writePayload(opts: { filePath: string; sessionId: string; cwd: string }) {
  return {
    tool_name: 'Write',
    tool_input: { file_path: opts.filePath },
    tool_response: {},
    session_id: opts.sessionId,
    cwd: opts.cwd,
  }
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tmpDir: string
let detector: { processPayload: (payload: unknown, opts?: { threshold?: number }) => Promise<void> }
let savedClaudeProjectDir: string | undefined

beforeEach(async () => {
  tmpDir = path.join(os.tmpdir(), `gw-detector-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
  // Unset CLAUDE_PROJECT_DIR so the detector resolves projectDir from payload.cwd
  // instead of writing to the real host project directory.
  savedClaudeProjectDir = process.env.CLAUDE_PROJECT_DIR
  delete process.env.CLAUDE_PROJECT_DIR
  // Fresh import each test to reset module-level state (Node caches modules,
  // but vitest's isolate mode handles this; if not, we use a workaround below).
  detector = await loadDetector()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  // Restore CLAUDE_PROJECT_DIR to its original value (or remove if it was unset).
  if (savedClaudeProjectDir !== undefined) {
    process.env.CLAUDE_PROJECT_DIR = savedClaudeProjectDir
  } else {
    delete process.env.CLAUDE_PROJECT_DIR
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('struggle-detector — repeat-command', () => {
  test('3× same command emits exactly one repeat-command signal', async () => {
    const sid = 'ses-repeat-1'
    const cmd = 'go build ./cmd'
    for (let i = 0; i < 3; i++) {
      await detector.processPayload(bashPayload({ command: cmd, sessionId: sid, cwd: tmpDir }))
    }
    const signals = readSignals(tmpDir)
    const repeatSignals = signals.filter((s: any) => s.kind === 'repeat-command')
    expect(repeatSignals).toHaveLength(1)
    expect(repeatSignals[0].session_id).toBe(sid)
    expect(repeatSignals[0].detail.count).toBeGreaterThanOrEqual(3)
  })

  test('2× same command does NOT emit repeat-command (below threshold)', async () => {
    const sid = 'ses-repeat-2'
    const cmd = 'npm run build'
    for (let i = 0; i < 2; i++) {
      await detector.processPayload(bashPayload({ command: cmd, sessionId: sid, cwd: tmpDir }))
    }
    const signals = readSignals(tmpDir)
    expect(signals.filter((s: any) => s.kind === 'repeat-command')).toHaveLength(0)
  })

  test('4× same command still emits only one signal (once-per-session guard)', async () => {
    const sid = 'ses-repeat-3'
    const cmd = 'make test'
    for (let i = 0; i < 4; i++) {
      await detector.processPayload(bashPayload({ command: cmd, sessionId: sid, cwd: tmpDir }))
    }
    const signals = readSignals(tmpDir)
    expect(signals.filter((s: any) => s.kind === 'repeat-command')).toHaveLength(1)
  })
})

describe('struggle-detector — fail-retry', () => {
  test('fail then retry emits fail-retry signal', async () => {
    const sid = 'ses-fail-1'
    const cmd = 'cargo build'
    // First call fails.
    await detector.processPayload(bashPayload({ command: cmd, exitCode: 1, sessionId: sid, cwd: tmpDir }))
    // Second call (retry) — exit code doesn't matter for fail-retry detection.
    await detector.processPayload(bashPayload({ command: cmd, exitCode: 0, sessionId: sid, cwd: tmpDir }))

    const signals = readSignals(tmpDir)
    const failSignals = signals.filter((s: any) => s.kind === 'fail-retry')
    expect(failSignals).toHaveLength(1)
    expect(failSignals[0].session_id).toBe(sid)
  })

  test('success then success does NOT emit fail-retry', async () => {
    const sid = 'ses-fail-2'
    const cmd = 'npm test'
    for (let i = 0; i < 3; i++) {
      await detector.processPayload(bashPayload({ command: cmd, exitCode: 0, sessionId: sid, cwd: tmpDir }))
    }
    const signals = readSignals(tmpDir)
    expect(signals.filter((s: any) => s.kind === 'fail-retry')).toHaveLength(0)
  })

  test('fail-retry emitted only once per session even on multiple retries', async () => {
    const sid = 'ses-fail-3'
    const cmd = 'pytest tests/'
    // Fail, retry, retry, retry
    await detector.processPayload(bashPayload({ command: cmd, exitCode: 2, sessionId: sid, cwd: tmpDir }))
    for (let i = 0; i < 3; i++) {
      await detector.processPayload(bashPayload({ command: cmd, exitCode: 1, sessionId: sid, cwd: tmpDir }))
    }
    const signals = readSignals(tmpDir)
    expect(signals.filter((s: any) => s.kind === 'fail-retry')).toHaveLength(1)
  })
})

describe('struggle-detector — file-thrash', () => {
  test('3× same file Edit emits file-thrash signal', async () => {
    const sid = 'ses-thrash-1'
    const fp = '/home/user/project/src/main.ts'
    for (let i = 0; i < 3; i++) {
      await detector.processPayload(editPayload({ filePath: fp, sessionId: sid, cwd: tmpDir }))
    }
    const signals = readSignals(tmpDir)
    const thrashSignals = signals.filter((s: any) => s.kind === 'file-thrash')
    expect(thrashSignals).toHaveLength(1)
    expect(thrashSignals[0].session_id).toBe(sid)
    expect(thrashSignals[0].detail.filePath).toBe(fp)
  })

  test('3× same file Write emits file-thrash signal', async () => {
    const sid = 'ses-thrash-2'
    const fp = '/home/user/project/src/config.json'
    for (let i = 0; i < 3; i++) {
      await detector.processPayload(writePayload({ filePath: fp, sessionId: sid, cwd: tmpDir }))
    }
    const signals = readSignals(tmpDir)
    expect(signals.filter((s: any) => s.kind === 'file-thrash')).toHaveLength(1)
  })

  test('file-thrash emitted only once per session', async () => {
    const sid = 'ses-thrash-3'
    const fp = '/home/user/project/hooks/foo.mjs'
    for (let i = 0; i < 5; i++) {
      await detector.processPayload(editPayload({ filePath: fp, sessionId: sid, cwd: tmpDir }))
    }
    const signals = readSignals(tmpDir)
    expect(signals.filter((s: any) => s.kind === 'file-thrash')).toHaveLength(1)
  })

  test('different files do not share thrash counts', async () => {
    const sid = 'ses-thrash-4'
    // 2 edits to each of 3 different files — none should cross threshold=3.
    for (const fp of ['/a/x.ts', '/b/y.ts', '/c/z.ts']) {
      for (let i = 0; i < 2; i++) {
        await detector.processPayload(editPayload({ filePath: fp, sessionId: sid, cwd: tmpDir }))
      }
    }
    expect(readSignals(tmpDir).filter((s: any) => s.kind === 'file-thrash')).toHaveLength(0)
  })
})

describe('struggle-detector — malformed / fail-open', () => {
  test('malformed payload (null) does not throw and emits no signal', async () => {
    await expect(detector.processPayload(null)).resolves.not.toThrow()
    expect(readSignals(tmpDir)).toHaveLength(0)
  })

  test('missing session_id does not throw and emits no signal', async () => {
    const payload = { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {}, cwd: tmpDir }
    await expect(detector.processPayload(payload)).resolves.not.toThrow()
    expect(readSignals(tmpDir)).toHaveLength(0)
  })

  test('missing cwd/CLAUDE_PROJECT_DIR does not throw', async () => {
    const payload = { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: {}, session_id: 'ses-x' }
    await expect(detector.processPayload(payload)).resolves.not.toThrow()
    expect(readSignals(tmpDir)).toHaveLength(0)
  })

  test('unknown tool_name is a no-op', async () => {
    const payload = { tool_name: 'Read', tool_input: {}, tool_response: {}, session_id: 'ses-y', cwd: tmpDir }
    await expect(detector.processPayload(payload)).resolves.not.toThrow()
    expect(readSignals(tmpDir)).toHaveLength(0)
  })

  test('empty command string is a no-op', async () => {
    const payload = { tool_name: 'Bash', tool_input: { command: '' }, tool_response: {}, session_id: 'ses-z', cwd: tmpDir }
    await expect(detector.processPayload(payload)).resolves.not.toThrow()
    expect(readSignals(tmpDir)).toHaveLength(0)
  })
})

describe('struggle-detector — cross-session isolation', () => {
  test('signals from different sessions are independent', async () => {
    const cmd = 'go build ./x'
    // Session A crosses threshold.
    for (let i = 0; i < 3; i++) {
      await detector.processPayload(bashPayload({ command: cmd, sessionId: 'ses-A', cwd: tmpDir }))
    }
    // Session B only runs twice — should NOT emit.
    for (let i = 0; i < 2; i++) {
      await detector.processPayload(bashPayload({ command: cmd, sessionId: 'ses-B', cwd: tmpDir }))
    }
    const signals = readSignals(tmpDir)
    expect(signals.filter((s: any) => s.kind === 'repeat-command' && s.session_id === 'ses-A')).toHaveLength(1)
    expect(signals.filter((s: any) => s.kind === 'repeat-command' && s.session_id === 'ses-B')).toHaveLength(0)
  })
})
