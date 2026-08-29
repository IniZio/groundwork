import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { writeGate, readGate, advisorVerdict } from '../../../../src/gw/store/gate/index.js'
import { gateNotePath } from '../../../../src/gw/schema/index.js'

const TRACKER = '.groundwork'

function makeTmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'gate-test-'))
}

describe('gate store', () => {
  const temps: string[] = []

  afterEach(() => {
    for (const dir of temps) {
      rmSync(dir, { recursive: true, force: true })
    }
    temps.length = 0
  })

  it('writeGate + readGate roundtrip (string advisor)', () => {
    const root = makeTmpDir()
    temps.push(root)

    writeGate({
      repoRoot: root,
      tracker: TRACKER,
      motive: 'test-motive',
      gate: {
        session: 'sess-1',
        motive: 'test-motive',
        advisor: 'APPROVE',
        created_at: '2026-08-29T10:00:00.000Z',
      },
    })

    const gate = readGate(root, TRACKER, 'test-motive', 'sess-1')
    expect(gate).not.toBeNull()
    expect(gate!.session).toBe('sess-1')
    expect(gate!.motive).toBe('test-motive')
    expect(gate!.advisor).toBe('APPROVE')
  })

  it('writeGate + readGate roundtrip (object advisor)', () => {
    const root = makeTmpDir()
    temps.push(root)

    writeGate({
      repoRoot: root,
      tracker: TRACKER,
      motive: 'test-motive',
      gate: {
        session: 'sess-2',
        motive: 'test-motive',
        advisor: { verdict: 'CORRECTION', rubric: 'needs work', citation: 'test output' },
      },
    })

    const gate = readGate(root, TRACKER, 'test-motive', 'sess-2')
    expect(gate).not.toBeNull()
    expect(typeof gate!.advisor).toBe('object')
    const adv = gate!.advisor as { verdict: string; rubric: string }
    expect(adv.verdict).toBe('CORRECTION')
    expect(adv.rubric).toBe('needs work')
  })

  it('readGate returns null for missing session', () => {
    const root = makeTmpDir()
    temps.push(root)

    const result = readGate(root, TRACKER, 'test-motive', 'nonexistent-session')
    expect(result).toBeNull()
  })

  it('advisorVerdict from string form', () => {
    const root = makeTmpDir()
    temps.push(root)

    writeGate({
      repoRoot: root,
      tracker: TRACKER,
      motive: 'test-motive',
      gate: { session: 'sess-3', motive: 'test-motive', advisor: 'APPROVE' },
    })

    expect(advisorVerdict(root, TRACKER, 'test-motive', 'sess-3')).toBe('APPROVE')
  })

  it('advisorVerdict from object form', () => {
    const root = makeTmpDir()
    temps.push(root)

    writeGate({
      repoRoot: root,
      tracker: TRACKER,
      motive: 'test-motive',
      gate: { session: 'sess-4', motive: 'test-motive', advisor: { verdict: 'GAPS', rubric: '...' } },
    })

    expect(advisorVerdict(root, TRACKER, 'test-motive', 'sess-4')).toBe('GAPS')
  })

  it('advisorVerdict returns null when no gate note', () => {
    const root = makeTmpDir()
    temps.push(root)

    expect(advisorVerdict(root, TRACKER, 'test-motive', 'no-such-session')).toBeNull()
  })

  it('writeGate creates seal sidecar', () => {
    const root = makeTmpDir()
    temps.push(root)

    writeGate({
      repoRoot: root,
      tracker: TRACKER,
      motive: 'test-motive',
      gate: { session: 'sess-5', motive: 'test-motive', advisor: 'APPROVE' },
    })

    const notePath = gateNotePath(root, TRACKER, 'test-motive', 'sess-5')
    expect(existsSync(`${notePath}.seal`)).toBe(true)
  })

  it('multiple sessions have independent gate notes', () => {
    const root = makeTmpDir()
    temps.push(root)

    writeGate({
      repoRoot: root,
      tracker: TRACKER,
      motive: 'test-motive',
      gate: { session: 'sess-a', motive: 'test-motive', advisor: 'APPROVE' },
    })

    writeGate({
      repoRoot: root,
      tracker: TRACKER,
      motive: 'test-motive',
      gate: { session: 'sess-b', motive: 'test-motive', advisor: 'REPLAN' },
    })

    expect(advisorVerdict(root, TRACKER, 'test-motive', 'sess-a')).toBe('APPROVE')
    expect(advisorVerdict(root, TRACKER, 'test-motive', 'sess-b')).toBe('REPLAN')
  })

  // -----------------------------------------------------------------------
  // readGate sealed field — disk-read tamper detection
  // -----------------------------------------------------------------------

  it('readGate sealed === true for a freshly written gate note', () => {
    const root = makeTmpDir()
    temps.push(root)

    writeGate({
      repoRoot: root,
      tracker: TRACKER,
      motive: 'test-motive',
      gate: { session: 'sess-seal-1', motive: 'test-motive', advisor: 'APPROVE' },
    })

    const gate = readGate(root, TRACKER, 'test-motive', 'sess-seal-1')
    expect(gate!.sealed).toBe(true)
  })

  it('readGate sealed === false when machine-owned field (advisor) tampered on disk', () => {
    const root = makeTmpDir()
    temps.push(root)

    writeGate({
      repoRoot: root,
      tracker: TRACKER,
      motive: 'test-motive',
      gate: { session: 'sess-seal-2', motive: 'test-motive', advisor: 'APPROVE' },
    })

    const notePath = gateNotePath(root, TRACKER, 'test-motive', 'sess-seal-2')
    // Tamper: rewrite advisor directly in the file (simulates unauthorized write)
    const raw = readFileSync(notePath, 'utf8')
    writeFileSync(notePath, raw.replace('advisor: APPROVE', 'advisor: REPLAN'))

    const gate = readGate(root, TRACKER, 'test-motive', 'sess-seal-2')
    // advisor is machine-owned → seal detects the tamper
    expect(gate!.sealed).toBe(false)
  })
})
