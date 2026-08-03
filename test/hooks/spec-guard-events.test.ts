/**
 * Spec-guard hook — event emission tests.
 *
 * After S6 (RFC removal), spec-guard emits NO events. All tests verify
 * zero SPEC_DRIFT events for various input paths.
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
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '../..')
const HOOK = path.join(ROOT, 'hooks', 'spec-guard.mjs')

const tmpRoots: string[] = []

function makeTmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'gw-sg-events-'))
  tmpRoots.push(d)
  return d
}

afterEach(() => {
  for (const d of tmpRoots.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function runHook(
  payload: Record<string, unknown>,
  env: Record<string, string> = {},
): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_SESSION_ID: undefined, ...env },
  })
  return {
    exitCode: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  }
}

function readEvents(projectDir: string, sessionId: string): object[] {
  const today = new Date().toISOString().slice(0, 10)
  const shardPath = path.join(
    projectDir, '.groundwork', 'journal', `${today}-${sessionId}.jsonl`,
  )
  try {
    return readFileSync(shardPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l))
  } catch {
    return []
  }
}

function writeLedger(
  projectDir: string,
  sessionId: string,
  ledger: Record<string, unknown>,
): void {
  const runsDir = path.join(projectDir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(path.join(runsDir, `${sessionId}.json`), JSON.stringify(ledger))
}

// ---------------------------------------------------------------------------
// Zero-events: bail-out paths
// ---------------------------------------------------------------------------

describe('spec-guard events — bail-out paths emit zero events', () => {
  it('no ledger → zero events', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-no-ledger'

    const targetFile = path.join(projectDir, 'doc', 'specs', 'foo.md')
    runHook(
      {
        tool_name: 'Edit',
        tool_input: { file_path: targetFile },
        cwd: projectDir,
        session_id: sessionId,
      },
      { CLAUDE_SESSION_ID: sessionId },
    )

    const events = readEvents(projectDir, sessionId)
    expect(events.filter(e => e.type === 'SPEC_DRIFT')).toHaveLength(0)
  })

  it('unreadable ledger → zero events', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-bad-ledger'
    const runsDir = path.join(projectDir, '.groundwork', 'runs')
    mkdirSync(runsDir, { recursive: true })
    // Write an unreadable ledger file
    const ledgerPath = path.join(runsDir, `${sessionId}.json`)
    writeFileSync(ledgerPath, JSON.stringify({ active: true }))
    chmodSync(ledgerPath, 0o000)

    const targetFile = path.join(projectDir, 'doc', 'specs', 'foo.md')
    try {
      runHook(
        {
          tool_name: 'Edit',
          tool_input: { file_path: targetFile },
          cwd: projectDir,
          session_id: sessionId,
        },
        { CLAUDE_SESSION_ID: sessionId },
      )
    } finally {
      chmodSync(ledgerPath, 0o644)
    }

    const events = readEvents(projectDir, sessionId)
    expect(events.filter(e => e.type === 'SPEC_DRIFT')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Zero-events: permitted writes
// ---------------------------------------------------------------------------

describe('spec-guard events — permitted writes emit zero events', () => {
  it('unguarded prefix (src/) → zero events', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-unguarded'

    runHook(
      {
        tool_name: 'Edit',
        tool_input: { file_path: path.join(projectDir, 'src', 'foo.ts') },
        cwd: projectDir,
        session_id: sessionId,
      },
      { CLAUDE_SESSION_ID: sessionId },
    )

    const events = readEvents(projectDir, sessionId)
    expect(events.filter(e => e.type === 'SPEC_DRIFT')).toHaveLength(0)
  })

  it('_generated/ exemption → zero events', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-generated'

    runHook(
      {
        tool_name: 'Write',
        tool_input: {
          file_path: path.join(projectDir, 'doc', 'specs', '_generated', 'index.md'),
        },
        cwd: projectDir,
        session_id: sessionId,
      },
      { CLAUDE_SESSION_ID: sessionId },
    )

    const events = readEvents(projectDir, sessionId)
    expect(events.filter(e => e.type === 'SPEC_DRIFT')).toHaveLength(0)
  })

  it('guarded path with active ledger → zero events (passthrough)', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-ledger-passthru'
    writeLedger(projectDir, sessionId, { active: true, session_id: sessionId })

    runHook(
      {
        tool_name: 'Edit',
        tool_input: { file_path: path.join(projectDir, 'doc', 'specs', 'foo.md') },
        cwd: projectDir,
        session_id: sessionId,
      },
      { CLAUDE_SESSION_ID: sessionId },
    )

    const events = readEvents(projectDir, sessionId)
    expect(events.filter(e => e.type === 'SPEC_DRIFT')).toHaveLength(0)
  })
})
