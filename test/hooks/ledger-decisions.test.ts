/**
 * Ledger CLI — decisions field tests (D-40 / slice G1-S1).
 *
 * Verifies that:
 *   - schema accepts decisions as string and as array (S1-AC1)
 *   - add --decisions survives an add → show round trip (S1-AC2)
 *   - set --decisions updates the field and prints decisions=[...] (S1-AC3)
 *   - ledger help add lists --decisions (S1-AC3)
 *   - ledger help set lists --decisions (S1-AC3)
 *   - set --decisions is accepted as a valid field (hasFields guard) (S1-AC3)
 *   - show prints decisions: (none) when not set (S1-AC4)
 *   - warns on malformed decision id but exits 0 (S1-AC4)
 *   - view shows a Decisions column for slices that declare it (S1-AC4)
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CLI = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'ledger.mjs')
const SCHEMA_PATH = path.resolve(import.meta.dirname, '..', '..', 'schemas', 'run-ledger.schema.json')

let projectDir: string
let ledgerFile: string

function readLedger(): any {
  return JSON.parse(readFileSync(ledgerFile, 'utf8'))
}

function writeLedger(obj: any) {
  writeFileSync(ledgerFile, JSON.stringify(obj, null, 2))
}

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir }
  delete env.CLAUDE_CODE_SESSION_ID
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** Minimal ledger written by init */
const baseLedger = () => ({
  version: 1,
  active: true,
  session_id: 'sess-decisions',
  brief: 'decisions test run',
  write_token: 'tok-decisions',
  slices: [],
  gate: {},
})

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), 'gw-decisions-'))
  mkdirSync(path.join(projectDir, '.groundwork'), { recursive: true })
  ledgerFile = path.join(projectDir, '.groundwork', 'run.json')
})

afterEach(() => rmSync(projectDir, { recursive: true, force: true }))

// ---------------------------------------------------------------------------
// S1-AC1: schema has decisions as oneOf[string, string[]]
// ---------------------------------------------------------------------------

describe('schema', () => {
  it('schema accepts decisions as string and as array', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))
    // Find the slice definition that has covers_ac (the one containing slice properties)
    const sliceDef = findSliceDef(schema)
    expect(sliceDef).toBeTruthy()
    const decisionsSchema = sliceDef.properties?.decisions
    expect(decisionsSchema).toBeTruthy()
    expect(decisionsSchema.oneOf).toHaveLength(2)
    const types = decisionsSchema.oneOf.map((o: any) => o.type)
    expect(types).toContain('string')
    expect(types).toContain('array')
  })
})

function findSliceDef(schema: any): any {
  for (const key of Object.keys(schema.$defs ?? {})) {
    const def = schema.$defs[key]
    if (def.properties?.covers_ac) return def
  }
  // Also try nested under properties -> slices -> items
  const slicesItems = schema.properties?.slices?.items
  if (slicesItems?.properties?.covers_ac) return slicesItems
  return null
}

// ---------------------------------------------------------------------------
// S1-AC2: decisions in KNOWN_SLICE_KEYS and SLICE_FIELDS; add → show round trip
// ---------------------------------------------------------------------------

describe('add → show round trip', () => {
  it('add --decisions survives an add → show round trip', () => {
    writeLedger(baseLedger())
    const add = run(['add', 'S1', '--decisions', 'D-40,D-41', '--token', 'tok-decisions'])
    expect(add.code).toBe(0)

    const show = run(['show', 'S1'])
    expect(show.code).toBe(0)
    expect(show.stdout).toMatch(/decisions:\s+D-40, D-41/)
  })

  it('decisions persisted in ledger JSON', () => {
    writeLedger(baseLedger())
    run(['add', 'S2', '--decisions', 'D-40', '--token', 'tok-decisions'])
    const l = readLedger()
    const s = l.slices.find((x: any) => x.id === 'S2')
    expect(s).toBeTruthy()
    expect(s.decisions).toEqual(['D-40'])
  })
})

// ---------------------------------------------------------------------------
// S1-AC3: --decisions on add and set; help blocks; hasFields guard
// ---------------------------------------------------------------------------

describe('--decisions flag', () => {
  it('ledger help add lists --decisions', () => {
    const r = run(['help', 'add'])
    expect(r.stdout).toMatch(/--decisions/)
  })

  it('ledger help set lists --decisions', () => {
    const r = run(['help', 'set'])
    expect(r.stdout).toMatch(/--decisions/)
  })

  it('set --decisions updates the field and prints decisions=[D-1,D-2]', () => {
    writeLedger(baseLedger())
    run(['add', 'S3', '--token', 'tok-decisions'])
    const r = run(['set', 'S3', '--decisions', 'D-1,D-2', '--token', 'tok-decisions'])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/decisions=\[D-1,D-2\]/)
  })

  it('set --decisions alone counts as a valid field (hasFields guard)', () => {
    writeLedger(baseLedger())
    run(['add', 'S4', '--token', 'tok-decisions'])
    const r = run(['set', 'S4', '--decisions', 'D-40', '--token', 'tok-decisions'])
    expect(r.code).toBe(0)
    expect(r.stderr).not.toMatch(/no fields provided/)
  })
})

// ---------------------------------------------------------------------------
// S1-AC4: show prints decisions; malformed id warns, exit 0; view shows column
// ---------------------------------------------------------------------------

describe('show decisions', () => {
  it('show prints decisions: (none) when not set', () => {
    writeLedger(baseLedger())
    run(['add', 'S5', '--token', 'tok-decisions'])
    const r = run(['show', 'S5'])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/decisions:\s+\(none\)/)
  })

  it('warns on malformed decision id but exits 0', () => {
    writeLedger(baseLedger())
    const r = run(['add', 'S6', '--decisions', 'FOO,D-40', '--token', 'tok-decisions'])
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(/warning.*"FOO"/)
    // D-40 is valid — should not produce a warning about "D-40" itself
    const warningLines = r.stderr.split('\n').filter((l) => l.startsWith('warning'))
    expect(warningLines).toHaveLength(1) // only one warning (for FOO)
  })

  it('warns on malformed id in set --decisions but exits 0', () => {
    writeLedger(baseLedger())
    run(['add', 'S7', '--token', 'tok-decisions'])
    const r = run(['set', 'S7', '--decisions', 'bad-id', '--token', 'tok-decisions'])
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(/warning.*bad-id/)
  })
})

describe('view decisions column', () => {
  it('view shows Decisions column with values for slices that declare it', () => {
    writeLedger(baseLedger())
    run(['add', 'S8', '--decisions', 'D-40', '--token', 'tok-decisions'])
    const r = run(['view'])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/Decisions/)
    expect(r.stdout).toMatch(/D-40/)
  })

  it('view shows — in Decisions column for slices without decisions', () => {
    writeLedger(baseLedger())
    run(['add', 'S9', '--token', 'tok-decisions'])
    const r = run(['view'])
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/Decisions/)
    // The row should contain — for no decisions
    expect(r.stdout).toMatch(/—/)
  })
})
