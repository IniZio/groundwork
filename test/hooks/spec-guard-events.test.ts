/**
 * S4 acceptance tests — spec-guard SPEC_DRIFT event emission.
 *
 * AC coverage:
 *  S4-AC1 — rfc-status advisory → one SPEC_DRIFT, data.kind:"rfc-status", data.path, data.rfc_uid
 *  S4-AC2 — spec-delta-uncovered advisory → one SPEC_DRIFT, data.kind:"spec-delta-uncovered"
 *  S4-AC3 — cannot-evaluate bail-outs (no ledger, no rfc_ref, RFC not found, unparseable
 *            frontmatter, unreadable ledger) → zero SPEC_DRIFT events
 *  S4-AC4 — permitted writes (unguarded prefix, _generated/, fully covered) → zero events
 *  S4-AC5 — hook still exits 0 and permits the write in every drift case
 *  S4-AC6 — data fields populated from variables in scope (verified by field assertions)
 *  Failure — unwritable journal dir → hook output unchanged (exit 0, stderr WARN text intact)
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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '../..')
const HOOK = path.join(ROOT, 'hooks', 'spec-guard.mjs')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/** Run the spec-guard hook with the given payload. */
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

/** Read all JSONL events from the journal dir under projectDir. */
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

/** Write a session ledger to .groundwork/runs/<sessionId>.json. */
function writeLedger(
  projectDir: string,
  sessionId: string,
  ledger: Record<string, unknown>,
): void {
  const runsDir = path.join(projectDir, '.groundwork', 'runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(path.join(runsDir, `${sessionId}.json`), JSON.stringify(ledger))
}

/** Write an RFC rfc.md file in rfcDir (same format as spec-guard.test.ts). */
function writeRfc(rfcDir: string, frontmatter: Record<string, unknown>): void {
  mkdirSync(rfcDir, { recursive: true })
  const yamlLines = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join('\n')
  writeFileSync(path.join(rfcDir, 'rfc.md'), `---\n${yamlLines}\n---\n\n# RFC body\n`)
}

// ---------------------------------------------------------------------------
// S4-AC1 — RFC-status advisory → SPEC_DRIFT with kind:"rfc-status"
// ---------------------------------------------------------------------------

describe('spec-guard events — rfc-status advisory (S4-AC1)', () => {
  it('emits one SPEC_DRIFT when RFC is in draft status', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-rfc-status'
    const rfcDir = path.join(projectDir, '.groundwork', 'rfcs', '0001-test')

    writeRfc(rfcDir, { uid: '0001', status: 'draft', spec_delta: [] })
    writeLedger(projectDir, sessionId, {
      active: true,
      rfc_ref: '.groundwork/rfcs/0001-test',
    })

    const targetFile = path.join(projectDir, 'doc', 'specs', 'foo', 'bar.md')
    const r = runHook(
      {
        tool_name: 'Edit',
        tool_input: { file_path: targetFile },
        cwd: projectDir,
        session_id: sessionId,
      },
      { CLAUDE_SESSION_ID: sessionId },
    )

    // Hook still exits 0 and warns (S4-AC5)
    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain('WARN')
    expect(r.stderr).toContain('advisory only')

    // Exactly one SPEC_DRIFT event written (S4-AC1)
    const events = readEvents(projectDir, sessionId)
    const drifts = events.filter(e => e.type === 'SPEC_DRIFT')
    expect(drifts).toHaveLength(1)
    expect(drifts[0].data.kind).toBe('rfc-status')
    expect(drifts[0].data.path).toBe('doc/specs/foo/bar.md')
    expect(drifts[0].data.rfc_uid).toBe('0001')
    expect(drifts[0].source).toBe('hook:spec-guard')
    // msg contains the advisory text (S4-AC6 — from variable, not parsed)
    expect(drifts[0].msg).toContain('draft')
  })

  it('emits SPEC_DRIFT for a "proposed" status RFC too', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-proposed'
    const rfcDir = path.join(projectDir, '.groundwork', 'rfcs', '0002-test')

    writeRfc(rfcDir, { uid: 'RFC-0002', status: 'proposed', spec_delta: [] })
    writeLedger(projectDir, sessionId, {
      active: true,
      rfc_ref: '.groundwork/rfcs/0002-test',
    })

    const targetFile = path.join(projectDir, 'doc', 'specs', 'another.md')
    const r = runHook(
      {
        tool_name: 'Write',
        tool_input: { file_path: targetFile },
        cwd: projectDir,
        session_id: sessionId,
      },
      { CLAUDE_SESSION_ID: sessionId },
    )

    expect(r.exitCode).toBe(0)
    const events = readEvents(projectDir, sessionId)
    const drifts = events.filter(e => e.type === 'SPEC_DRIFT')
    expect(drifts).toHaveLength(1)
    expect(drifts[0].data.kind).toBe('rfc-status')
    expect(drifts[0].data.rfc_uid).toBe('RFC-0002')
  })
})

// ---------------------------------------------------------------------------
// S4-AC2 — spec-delta-uncovered advisory → SPEC_DRIFT with kind:"spec-delta-uncovered"
// ---------------------------------------------------------------------------

describe('spec-guard events — spec-delta-uncovered advisory (S4-AC2)', () => {
  it('emits one SPEC_DRIFT when no spec_delta entry covers the target', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-uncovered'
    const rfcDir = path.join(projectDir, '.groundwork', 'rfcs', '0003-test')

    writeRfc(rfcDir, {
      uid: 'RFC-0003',
      status: 'accepted',
      spec_delta: [{ op: 'add', target: 'doc/specs/other/thing.md' }],
    })
    writeLedger(projectDir, sessionId, {
      active: true,
      rfc_ref: '.groundwork/rfcs/0003-test',
    })

    const targetFile = path.join(projectDir, 'doc', 'specs', 'my', 'requirement.md')
    const r = runHook(
      {
        tool_name: 'Edit',
        tool_input: { file_path: targetFile },
        cwd: projectDir,
        session_id: sessionId,
      },
      { CLAUDE_SESSION_ID: sessionId },
    )

    expect(r.exitCode).toBe(0)
    expect(r.stderr).toContain('WARN')

    const events = readEvents(projectDir, sessionId)
    const drifts = events.filter(e => e.type === 'SPEC_DRIFT')
    expect(drifts).toHaveLength(1)
    expect(drifts[0].data.kind).toBe('spec-delta-uncovered')
    expect(drifts[0].data.path).toBe('doc/specs/my/requirement.md')
    expect(drifts[0].data.rfc_uid).toBe('RFC-0003')
    expect(drifts[0].source).toBe('hook:spec-guard')
    expect(drifts[0].msg).toContain('spec_delta')
  })
})

// ---------------------------------------------------------------------------
// S4-AC3 — cannot-evaluate bail-outs → zero SPEC_DRIFT events
// ---------------------------------------------------------------------------

describe('spec-guard events — bail-out paths emit zero events (S4-AC3)', () => {
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

  it('ledger has no rfc_ref → zero events', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-no-rfc-ref'
    writeLedger(projectDir, sessionId, { active: true })

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

  it('RFC not found → zero events', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-rfc-missing'
    writeLedger(projectDir, sessionId, {
      active: true,
      rfc_ref: '.groundwork/rfcs/9999-nonexistent',
    })

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

  it('unparseable frontmatter → zero events', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-bad-fm'
    const rfcDir = path.join(projectDir, '.groundwork', 'rfcs', '0004-bad')
    mkdirSync(rfcDir, { recursive: true })
    // Write a non-YAML file so frontmatter parsing fails
    writeFileSync(path.join(rfcDir, 'rfc.yaml'), 'not: valid: yaml: [}\n')
    writeLedger(projectDir, sessionId, {
      active: true,
      rfc_ref: '.groundwork/rfcs/0004-bad',
    })

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
    const ledgerPath = path.join(runsDir, `${sessionId}.json`)
    writeFileSync(ledgerPath, 'not json {{}')

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
})

// ---------------------------------------------------------------------------
// S4-AC4 — permitted writes → zero events
// ---------------------------------------------------------------------------

describe('spec-guard events — permitted writes emit zero events (S4-AC4)', () => {
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

  it('fully covered spec_delta entry → zero events', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-covered'
    const rfcDir = path.join(projectDir, '.groundwork', 'rfcs', '0005-covered')

    writeRfc(rfcDir, {
      uid: 'RFC-0005',
      status: 'implementing',
      spec_delta: [{ op: 'add', target: 'doc/specs/my/requirement.md' }],
    })
    writeLedger(projectDir, sessionId, {
      active: true,
      rfc_ref: '.groundwork/rfcs/0005-covered',
    })

    const targetFile = path.join(projectDir, 'doc', 'specs', 'my', 'requirement.md')
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
})

// ---------------------------------------------------------------------------
// Failure — unwritable journal dir → hook output unchanged
// ---------------------------------------------------------------------------

describe('spec-guard events — journal failure does not affect hook output', () => {
  it('unwritable journal dir → exit 0, WARN text unchanged', () => {
    const projectDir = makeTmp()
    const sessionId = 'sess-unwritable'
    const rfcDir = path.join(projectDir, '.groundwork', 'rfcs', '0006-test')

    writeRfc(rfcDir, { uid: 'RFC-0006', status: 'draft', spec_delta: [] })
    writeLedger(projectDir, sessionId, {
      active: true,
      rfc_ref: '.groundwork/rfcs/0006-test',
    })

    // Make journal dir unwritable
    const journalDir = path.join(projectDir, '.groundwork', 'journal')
    mkdirSync(journalDir, { recursive: true })
    chmodSync(journalDir, 0o444)

    const targetFile = path.join(projectDir, 'doc', 'specs', 'foo.md')
    let r: ReturnType<typeof runHook>
    try {
      r = runHook(
        {
          tool_name: 'Edit',
          tool_input: { file_path: targetFile },
          cwd: projectDir,
          session_id: sessionId,
        },
        { CLAUDE_SESSION_ID: sessionId },
      )
    } finally {
      chmodSync(journalDir, 0o755)
    }

    // Hook still exits 0 (journal failure must not affect exit code)
    expect(r.exitCode).toBe(0)
    // The WARN advisory text is still present
    expect(r.stderr).toContain('WARN')
    expect(r.stderr).toContain('advisory only')
    // stdout remains empty
    expect(r.stdout).toBe('')
  })
})
