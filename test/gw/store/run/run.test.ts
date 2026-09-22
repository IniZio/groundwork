import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as os from 'node:os'
import matter from 'gray-matter'
import {
  initRun,
  loadRun,
  saveRun,
  legacyFallbackPath,
  RunStoreMissingMotiveError,
  type LedgerJson,
} from '../../../../src/gw/store/run/index.js'
import { writeJournalEvent } from '../../../../src/gw/store/motive/journal-event.js'

function makeTmpDir(): string {
  return mkdtempSync(join(os.tmpdir(), 'gw-run-test-'))
}

function fixtureRun(overrides: Partial<LedgerJson> = {}): LedgerJson {
  return {
    session_id: 'test-session-abc',
    motive: 'test-motive',
    active: true,
    write_token: 'tok-123',
    slices: [
      { id: 'S1-FOO', status: 'pending', wave: 1, session: 'test-session-abc', kind: 'impl' },
      { id: 'S2-BAR', status: 'complete', wave: 1, session: 'test-session-abc', kind: 'impl', created_by: 'agent:general-purpose' },
    ],
    gate: { session: 'test-session-abc', motive: 'test-motive' },
    ...overrides,
  }
}

describe('initRun — missing motive throws', () => {
  it('throws RunStoreMissingMotiveError when motive is absent', () => {
    const tmp = makeTmpDir()
    try {
      const ledger = fixtureRun({ motive: '' })
      expect(() => initRun(ledger, { projectDir: tmp })).toThrow(RunStoreMissingMotiveError)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('error.code is RUN_STORE_MOTIVE_REQUIRED', () => {
    const tmp = makeTmpDir()
    try {
      try {
        initRun({ session_id: 's', motive: '', active: false, slices: [] }, { projectDir: tmp })
        expect.fail('should have thrown')
      } catch (e) {
        expect((e as RunStoreMissingMotiveError).code).toBe('RUN_STORE_MOTIVE_REQUIRED')
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('round-trip: initRun → loadRun', () => {
  let tmp: string
  beforeEach(() => { tmp = makeTmpDir() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  it('loadRun returns source:notes after initRun', () => {
    const ledger = fixtureRun()
    initRun(ledger, { projectDir: tmp })
    const result = loadRun({ projectDir: tmp, sessionId: ledger.session_id })
    expect(result).not.toBeNull()
    expect(result!.source).toBe('notes')
  })

  it('round-trip preserves active field', () => {
    const ledger = fixtureRun({ active: true })
    initRun(ledger, { projectDir: tmp })
    const result = loadRun({ projectDir: tmp, sessionId: ledger.session_id })
    expect(result!.active).toBe(true)
  })

  it('round-trip preserves slice id and status', () => {
    const ledger = fixtureRun()
    initRun(ledger, { projectDir: tmp })
    const result = loadRun({ projectDir: tmp, sessionId: ledger.session_id })
    const s1 = result!.slices.find(s => s.id === 'S1-FOO')
    expect(s1).toBeDefined()
    expect(s1!.status).toBe('pending')
    const s2 = result!.slices.find(s => s.id === 'S2-BAR')
    expect(s2!.status).toBe('complete')
    expect(s2!.created_by).toBe('agent:general-purpose')
  })

  it('round-trip preserves write_token', () => {
    const ledger = fixtureRun({ write_token: 'secret-token' })
    initRun(ledger, { projectDir: tmp })
    const result = loadRun({ projectDir: tmp, sessionId: ledger.session_id })
    expect(result!.write_token).toBe('secret-token')
  })

  it('round-trip preserves awaiting_human', () => {
    const ledger = fixtureRun({ awaiting_human: true })
    initRun(ledger, { projectDir: tmp })
    const result = loadRun({ projectDir: tmp, sessionId: ledger.session_id })
    expect(result!.awaiting_human).toBe(true)
  })

  it('round-trip preserves checkpoint_hold', () => {
    const ledger = fixtureRun({ checkpoint_hold: 'plan' })
    initRun(ledger, { projectDir: tmp })
    const result = loadRun({ projectDir: tmp, sessionId: ledger.session_id })
    expect(result!.checkpoint_hold).toBe('plan')
  })

  it('gate note is included in result.gate', () => {
    const ledger = fixtureRun()
    initRun(ledger, { projectDir: tmp })
    const result = loadRun({ projectDir: tmp, sessionId: ledger.session_id })
    expect(result!.gate).toBeDefined()
  })
})

describe('loadRun precedence', () => {
  let tmp: string
  beforeEach(() => { tmp = makeTmpDir() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  it('returns null when neither notes nor legacy JSON exists', () => {
    const result = loadRun({ projectDir: tmp, sessionId: 'nonexistent-session' })
    expect(result).toBeNull()
  })

  it('returns legacy-json when only the legacy file exists', () => {
    const legacyLedger: LedgerJson = {
      session_id: 'legacy-session',
      motive: 'some-motive',
      active: false,
      slices: [],
    }
    const legacyPath = legacyFallbackPath(tmp, 'legacy-session')
    mkdirSync(join(tmp, '.groundwork', 'runs'), { recursive: true })
    writeFileSync(legacyPath, JSON.stringify(legacyLedger), 'utf8')

    const result = loadRun({ projectDir: tmp, sessionId: 'legacy-session' })
    expect(result).not.toBeNull()
    expect(result!.source).toBe('legacy-json')
    expect(result!.active).toBe(false)
  })

  it('prefers notes over legacy-json when both exist', () => {
    const ledger = fixtureRun({ session_id: 'shared-session', motive: 'test-motive', active: true })
    initRun(ledger, { projectDir: tmp })

    const legacyLedger: LedgerJson = { ...ledger, active: false }
    const legacyPath = legacyFallbackPath(tmp, 'shared-session')
    mkdirSync(join(tmp, '.groundwork', 'runs'), { recursive: true })
    writeFileSync(legacyPath, JSON.stringify(legacyLedger), 'utf8')

    const result = loadRun({ projectDir: tmp, sessionId: 'shared-session' })
    expect(result!.source).toBe('notes')
    expect(result!.active).toBe(true)
  })
})

describe('saveRun', () => {
  let tmp: string
  beforeEach(() => { tmp = makeTmpDir() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  it('throws on invalid token', () => {
    const ledger = fixtureRun({ write_token: 'correct-token' })
    expect(() =>
      saveRun(ledger, { projectDir: tmp, token: 'wrong-token' })
    ).toThrowError(/invalid write token/i)
  })

  it('writes notes when token matches', () => {
    const ledger = fixtureRun({ write_token: 'my-token' })
    saveRun(ledger, { projectDir: tmp, token: 'my-token' })
    const result = loadRun({ projectDir: tmp, sessionId: ledger.session_id })
    expect(result!.source).toBe('notes')
  })
})

describe('writeJournalEvent', () => {
  let tmp: string
  beforeEach(() => { tmp = makeTmpDir() })
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

  it('creates journal note file', () => {
    const notePath = writeJournalEvent({
      projectDir: tmp,
      motive: 'test-motive',
      event: {
        ts: '2026-09-16T10:00:00.000Z',
        session: 'session-xyz',
        type: 'TASK_COMPLETE',
        source: 'cli:journal',
        data: { task: 'foo' },
        msg: 'Task completed',
      },
    })
    expect(existsSync(notePath)).toBe(true)
    const raw = readFileSync(notePath, 'utf8')
    const { data, content } = matter(raw)
    expect(data['type']).toBe('TASK_COMPLETE')
    expect(data['session']).toBe('session-xyz')
    expect(content.trim()).toBe('Task completed')
  })

  it('filename includes ISO-ts and TYPE', () => {
    const notePath = writeJournalEvent({
      projectDir: tmp,
      motive: 'test-motive',
      event: {
        ts: '2026-09-16T10:00:00.000Z',
        session: 's',
        type: 'GATE',
        source: 'test',
        data: {},
        msg: '',
      },
    })
    expect(notePath).toMatch(/2026-09-16T10-00-00-000Z-GATE\.md$/)
  })
})
