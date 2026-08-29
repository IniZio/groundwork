import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import os from 'node:os'
import { writeSlice, readSlice, listSlices, bySession, frontier, fromLegacyLedger } from '../../../../src/gw/store/slice/index.js'
import { sealPath } from '../../../../src/gw/store/seal/index.js'
import type { Slice } from '../../../../src/gw/schema/index.js'

const TRACKER = 'next'
const MOTIVE = 'test-motive'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(os.tmpdir(), 'gw-slice-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function baseSlice(overrides: Partial<Slice> = {}): Slice {
  return {
    id: 'S1-SCHEMA',
    status: 'pending',
    kind: 'impl',
    wave: 1,
    session: 'a2f49e92-6706-4e3d-91c5-020a94b83f0f',
    ...overrides,
  } as Slice
}

// ---------------------------------------------------------------------------
// 1. writeSlice + readSlice roundtrip
// ---------------------------------------------------------------------------
describe('writeSlice + readSlice roundtrip', () => {
  it('preserves all fields as plain ids (not wikilinks)', () => {
    const slice = baseSlice({
      id: 'S1-SCHEMA',
      wave: 1,
      status: 'complete',
      kind: 'impl',
      session: 'a2f49e92-6706-4e3d-91c5-020a94b83f0f',
      blocked_by: ['S0-INVENTORY'],
      covers_ac: ['AC-1'],
      decisions: ['D-1'],
      acceptance: ['One shared Zod schema module'],
      ticket: '04-model-frontmatter-schema-contract',
      completed_at: '2026-08-29T10:00:31.674Z',
      desc: 'TRACER BULLET test slice',
    })

    const notePath = writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice })
    const result = readSlice(notePath)

    expect(result.id).toBe('S1-SCHEMA')
    expect(result.wave).toBe(1)
    expect(result.status).toBe('complete')
    expect(result.kind).toBe('impl')
    expect(result.session).toBe('a2f49e92-6706-4e3d-91c5-020a94b83f0f')
    expect(result.blocked_by).toEqual(['S0-INVENTORY'])
    expect(result.covers_ac).toEqual(['AC-1'])
    expect(result.decisions).toEqual(['D-1'])
    expect(result.acceptance).toEqual(['One shared Zod schema module'])
    expect(result.ticket).toBe('04-model-frontmatter-schema-contract')
    expect(result.completed_at).toBe('2026-08-29T10:00:31.674Z')
    expect(result.desc).toBe('TRACER BULLET test slice')
  })
})

// ---------------------------------------------------------------------------
// 2. blocked_by stored as wikilinks
// ---------------------------------------------------------------------------
describe('blocked_by wikilink encoding', () => {
  it('stores [[S1-SCHEMA]] in file but returns plain id on read', () => {
    const slice = baseSlice({ blocked_by: ['S1-SCHEMA'] })
    const notePath = writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice })

    const raw = readFileSync(notePath, 'utf8')
    expect(raw).toContain('[[S1-SCHEMA]]')

    const result = readSlice(notePath)
    expect(result.blocked_by).toEqual(['S1-SCHEMA'])
  })
})

// ---------------------------------------------------------------------------
// 3. covers_ac stored as motive-anchored wikilinks
// ---------------------------------------------------------------------------
describe('covers_ac wikilink encoding', () => {
  it('stores [[motive#AC-n]] in file but returns plain AC ids on read', () => {
    const slice = baseSlice({ covers_ac: ['AC-1', 'AC-2'] })
    const notePath = writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice })

    const raw = readFileSync(notePath, 'utf8')
    expect(raw).toContain('[[test-motive#AC-1]]')
    expect(raw).toContain('[[test-motive#AC-2]]')

    const result = readSlice(notePath)
    expect(result.covers_ac).toEqual(['AC-1', 'AC-2'])
  })
})

// ---------------------------------------------------------------------------
// 4. listSlices excludes motive.md and gate-*.md
// ---------------------------------------------------------------------------
describe('listSlices', () => {
  it('returns all slice notes, excludes motive.md and gate-*.md', () => {
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S0' }) })
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S1' }) })
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S2' }) })

    // Write excluded files
    const dir = join(tmpDir, TRACKER, 'motives', MOTIVE)
    writeFileSync(join(dir, 'motive.md'), '---\nid: motive\nstatus: pending\n---\n', 'utf8')
    writeFileSync(join(dir, 'gate-session123.md'), '---\nid: gate\nstatus: pending\n---\n', 'utf8')

    const slices = listSlices(tmpDir, TRACKER, MOTIVE)
    expect(slices).toHaveLength(3)
    const ids = slices.map(s => s.id).sort()
    expect(ids).toEqual(['S0', 'S1', 'S2'])
  })
})

// ---------------------------------------------------------------------------
// 5. bySession filters correctly
// ---------------------------------------------------------------------------
describe('bySession', () => {
  it('returns only slices matching the given session', () => {
    const sessionA = 'aaaa-aaaa-aaaa-aaaa-aaaa'
    const sessionB = 'bbbb-bbbb-bbbb-bbbb-bbbb'
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S0', session: sessionA }) })
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S1', session: sessionA }) })
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S2', session: sessionB }) })

    const result = bySession(tmpDir, TRACKER, MOTIVE, sessionA)
    expect(result).toHaveLength(2)
    expect(result.map(s => s.id).sort()).toEqual(['S0', 'S1'])
  })
})

// ---------------------------------------------------------------------------
// 6. frontier returns unblocked pending unclaimed-or-mine
// ---------------------------------------------------------------------------
describe('frontier', () => {
  it('returns only eligible slices', () => {
    const mySession = 'my-session'

    // S0: complete, no blocked_by → NOT in frontier (not pending)
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S0', status: 'complete' }) })
    // S1: pending, no blocked_by, unclaimed → IN frontier
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S1', status: 'pending' }) })
    // S2: pending, blocked_by=['S1'], unclaimed → NOT in frontier (S1 not complete)
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S2', status: 'pending', blocked_by: ['S1'] }) })
    // S3: pending, blocked_by=['S0'], unclaimed → IN frontier (S0 is complete)
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S3', status: 'pending', blocked_by: ['S0'] }) })
    // S4: pending, no blocked_by, claimed_by='other-session' → NOT in frontier
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S4', status: 'pending', claimed_by: 'other-session' }) })
    // S5: pending, no blocked_by, claimed_by='my-session' → IN frontier
    writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice: baseSlice({ id: 'S5', status: 'pending', claimed_by: mySession }) })

    const result = frontier(tmpDir, TRACKER, MOTIVE, mySession)
    const ids = result.map(s => s.id).sort()
    expect(ids).toEqual(['S1', 'S3', 'S5'])
  })
})

// ---------------------------------------------------------------------------
// 7. fromLegacyLedger + bySession roundtrip (fixture — no live ledger dependency)
// ---------------------------------------------------------------------------
describe('fromLegacyLedger', () => {
  it('materializes all slices and bySession returns matching ids, statuses, and decoded blocked_by', () => {
    // Snapshot fixture — does not depend on the live .groundwork/runs/ ledger
    const fixturePath = join(process.cwd(), 'test/fixtures/gw/legacy-ledger.json')
    const ledger = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      slices: Array<{ id?: string; status?: string; blocked_by?: string[]; session_id?: string }>
    }
    const SESSION = 'a2f49e92-6706-4e3d-91c5-020a94b83f0f'
    const legacyMotive = 'obsidian-native-groundwork'

    const { slices } = fromLegacyLedger({
      ledgerPath: fixturePath,
      motive: legacyMotive,
      outRoot: tmpDir,
      tracker: 'next',
    })

    // Total count matches fixture (excluding slices with no id)
    const validLedgerSlices = ledger.slices.filter(s => s.id)
    expect(slices).toHaveLength(validLedgerSlices.length)

    // bySession returns only slices whose session_id matches SESSION
    const sessionSlices = bySession(tmpDir, 'next', legacyMotive, SESSION)
    const ledgerWithSession = validLedgerSlices.filter(s => s.session_id === SESSION)
    const expectedIds = new Set(ledgerWithSession.map(s => s.id!))
    const actualIds = new Set(sessionSlices.map(s => s.id))
    expect(actualIds).toEqual(expectedIds)

    // Statuses match for the session's slices
    for (const s of sessionSlices) {
      const original = ledgerWithSession.find(l => l.id === s.id)!
      expect(s.status).toBe(original.status)
    }

    // Unconditional blocked_by assertion on S2-MIGRATE (fixture has a known value)
    const s2migrate = sessionSlices.find(s => s.id === 'S2-MIGRATE') ??
      slices.find(s => s.id === 'S2-MIGRATE')
    // S2-MIGRATE is pending with no session_id — search all materialised slices
    const s2migrateAll = slices.find(s => s.id === 'S2-MIGRATE')
    expect(s2migrateAll).toBeDefined()
    expect(s2migrateAll!.blocked_by).toEqual(['S1-SCHEMA', 'S0-INVENTORY', 'S2-MOTIVE'])
    void s2migrate // suppress unused variable warning
  })
})

// ---------------------------------------------------------------------------
// 8. seal sidecar written alongside note
// ---------------------------------------------------------------------------
describe('writeSlice seal', () => {
  it('creates a .seal sidecar next to the note', () => {
    const slice = baseSlice({ id: 'S-SEAL-TEST' })
    const notePath = writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice })
    const expectedSealPath = `${notePath}.seal`
    expect(sealPath(notePath)).toBe(expectedSealPath)
    const sealContent = readFileSync(expectedSealPath, 'utf8').trim()
    expect(sealContent).toHaveLength(64) // HMAC-SHA256 hex = 64 chars
  })
})

// ---------------------------------------------------------------------------
// 9. readSlice returns sealed field (disk-read tamper detection)
// ---------------------------------------------------------------------------
describe('readSlice sealed field', () => {
  it('sealed === true for a freshly written note', () => {
    const slice = baseSlice({ id: 'S-FRESH' })
    const notePath = writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice })
    const result = readSlice(notePath)
    expect(result.sealed).toBe(true)
  })

  it('sealed === false when machine-owned field (status) tampered directly in file', () => {
    const slice = baseSlice({ id: 'S-TAMPER', status: 'pending' })
    const notePath = writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice })
    // Simulate an Obsidian property edit that writes status: complete directly to the file
    const raw = readFileSync(notePath, 'utf8')
    writeFileSync(notePath, raw.replace('status: pending', 'status: complete'))
    // readSlice reads from disk → machine key changed → seal mismatch → false
    const result = readSlice(notePath)
    expect(result.sealed).toBe(false)
  })

  it('sealed === true when only body prose appended to file on disk', () => {
    const slice = baseSlice({ id: 'S-BODY' })
    const notePath = writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice })
    const raw = readFileSync(notePath, 'utf8')
    // Append prose to the body (body is human-owned, not sealed)
    writeFileSync(notePath, raw + '\nHuman appended paragraph.\n')
    const result = readSlice(notePath)
    expect(result.sealed).toBe(true)
  })

  it('sealed === true when human-owned desc changed in file on disk', () => {
    const slice = baseSlice({ id: 'S-DESC', desc: 'original desc' })
    const notePath = writeSlice({ repoRoot: tmpDir, tracker: TRACKER, motive: MOTIVE, slice })
    const raw = readFileSync(notePath, 'utf8')
    // desc is not a machine key → changing it does not invalidate the seal
    writeFileSync(notePath, raw.replace('desc: original desc', 'desc: updated by human'))
    const result = readSlice(notePath)
    expect(result.sealed).toBe(true)
  })
})
