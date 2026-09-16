/**
 * test/gw-ledger-init.test.ts
 *
 * Verifies `gw ledger init` against AC-7 (S52-GW-LEDGER-INIT):
 *
 *  1. Differential test — gw and bin/ledger produce structurally identical
 *     output on the same clean JSON input (modulo write_token and timestamps).
 *  2. Field-stripping — gate/awaiting_human/claimed_by/pacing.grant are
 *     absent from the written ledger when present in the seed JSON.
 *  3. Motive required — missing motive exits non-zero with a descriptive message.
 *  4. Active-run guard — --token required to overwrite an active run.
 *  5. write_token printed to stdout in parseable form.
 *  6. bin/ledger init still works and its exit code is unaffected.
 */

import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

const ROOT = new URL('../', import.meta.url).pathname
const LEDGER_MJS = join(ROOT, 'hooks', 'ledger.mjs')
const GW_MAIN = join(ROOT, 'src', 'gw', 'cli', 'main.ts')
const SESSION_ID = 'test-init'

let projectDir: string

function makeEnv(): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    CLAUDE_PROJECT_DIR: projectDir,
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
  }
}

function runBinLedger(args: string[], input?: string) {
  return spawnSync('node', [LEDGER_MJS, ...args], {
    env: makeEnv(),
    encoding: 'utf8',
    ...(input !== undefined ? { input } : {}),
  })
}

function runGwLedger(args: string[], input?: string) {
  return spawnSync('bun', ['run', GW_MAIN, 'ledger', ...args], {
    env: makeEnv(),
    encoding: 'utf8',
    ...(input !== undefined ? { input } : {}),
  })
}

function ledgerPath(): string {
  return join(projectDir, '.groundwork', 'runs', `${SESSION_ID}.json`)
}

function readLedger(): Record<string, unknown> {
  return JSON.parse(readFileSync(ledgerPath(), 'utf8')) as Record<string, unknown>
}

const CLEAN_SEED = JSON.stringify({ active: true, slices: [] })

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'gw-init-test-'))
  mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
})

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractToken(stdout: string): string {
  const m = stdout.match(/write_token:\s+(\S+)/)
  if (!m) throw new Error(`write_token not found in stdout:\n${stdout}`)
  return m[1]
}

/** Normalise a ledger object by removing fields that legitimately differ between runs. */
function normalise(obj: Record<string, unknown>): Record<string, unknown> {
  const { write_token, session_id, base_commit, gate, ...rest } = obj
  void write_token; void session_id; void base_commit
  const g = gate as Record<string, unknown> | undefined
  if (g) {
    const { seal, ...gateRest } = g
    void seal
    return { ...rest, gate: gateRest }
  }
  return rest
}

// ---------------------------------------------------------------------------
// 1. Differential test
// ---------------------------------------------------------------------------

describe('differential: gw vs bin/ledger on identical clean seed', () => {
  it('produces structurally identical ledger JSON (modulo token/session/seal)', () => {
    const seedPath = join(projectDir, 'seed.json')
    writeFileSync(seedPath, CLEAN_SEED)

    const binDir = mkdtempSync(join(tmpdir(), 'bin-init-'))
    mkdirSync(join(binDir, '.groundwork', 'runs'), { recursive: true })

    try {
      const binEnv = { ...makeEnv(), CLAUDE_PROJECT_DIR: binDir }
      const rBin = spawnSync('node', [LEDGER_MJS, 'init', seedPath, '--motive', 'test-motive'], {
        env: binEnv, encoding: 'utf8',
      })
      expect(rBin.status).toBe(0)

      const rGw = runGwLedger(['init', seedPath, '--motive', 'test-motive'])
      expect(rGw.status).toBe(0)

      const binLedger = JSON.parse(
        readFileSync(join(binDir, '.groundwork', 'runs', `${SESSION_ID}.json`), 'utf8'),
      ) as Record<string, unknown>
      const gwLedger = readLedger()

      expect(normalise(gwLedger)).toEqual(normalise(binLedger))
    } finally {
      rmSync(binDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Field-stripping
// ---------------------------------------------------------------------------

describe('field-stripping from prior-run seed', () => {
  it('strips gate, awaiting_human, claimed_by from written ledger', () => {
    const staleSeed = JSON.stringify({
      active: false,
      motive: 'old-motive',
      slices: [],
      gate: { advisor: 'APPROVE', seal: 'deadbeef' },
      awaiting_human: true,
      claimed_by: 'agent-123',
      pacing: { grant: 3, some_other: 'keep-me' },
    })
    const seedPath = join(projectDir, 'stale.json')
    writeFileSync(seedPath, staleSeed)

    const r = runGwLedger(['init', seedPath, '--motive', 'fresh-motive'])
    expect(r.status).toBe(0)

    const ledger = readLedger()
    expect(ledger).not.toHaveProperty('awaiting_human')
    expect(ledger).not.toHaveProperty('claimed_by')
    expect((ledger['gate'] as Record<string, unknown>)?.['advisor']).toBeUndefined()
    const pacing = ledger['pacing'] as Record<string, unknown> | undefined
    expect(pacing?.['grant']).toBeUndefined()
    expect(pacing?.['some_other']).toBe('keep-me')
  })
})

// ---------------------------------------------------------------------------
// 3. Motive required
// ---------------------------------------------------------------------------

describe('motive required', () => {
  it('exits non-zero when --motive is absent and JSON has no motive', () => {
    const seedPath = join(projectDir, 'seed.json')
    writeFileSync(seedPath, CLEAN_SEED)

    const r = runGwLedger(['init', seedPath])
    expect(r.status).not.toBe(0)
    expect(r.stderr + r.stdout).toMatch(/motive/)
  })

  it('accepts motive embedded in the seed JSON', () => {
    const seedPath = join(projectDir, 'seed.json')
    writeFileSync(seedPath, JSON.stringify({ active: true, slices: [], motive: 'from-json' }))

    const r = runGwLedger(['init', seedPath])
    expect(r.status).toBe(0)
    expect(readLedger()['motive']).toBe('from-json')
  })

  it('--motive flag overrides motive in JSON', () => {
    const seedPath = join(projectDir, 'seed.json')
    writeFileSync(seedPath, JSON.stringify({ active: true, slices: [], motive: 'old' }))

    const r = runGwLedger(['init', seedPath, '--motive', 'new'])
    expect(r.status).toBe(0)
    expect(readLedger()['motive']).toBe('new')
  })
})

// ---------------------------------------------------------------------------
// 4. Active-run guard
// ---------------------------------------------------------------------------

describe('active-run guard', () => {
  it('rejects overwriting an active run without --token', () => {
    const seedPath = join(projectDir, 'seed.json')
    writeFileSync(seedPath, CLEAN_SEED)

    const r1 = runGwLedger(['init', seedPath, '--motive', 'first'])
    expect(r1.status).toBe(0)

    const r2 = runGwLedger(['init', seedPath, '--motive', 'second'])
    expect(r2.status).not.toBe(0)
    expect(r2.stderr + r2.stdout).toMatch(/active run/)
  })

  it('allows overwrite when correct --token is passed', () => {
    const seedPath = join(projectDir, 'seed.json')
    writeFileSync(seedPath, CLEAN_SEED)

    const r1 = runGwLedger(['init', seedPath, '--motive', 'first'])
    expect(r1.status).toBe(0)
    const token = extractToken(r1.stdout)

    const r2 = runGwLedger(['init', seedPath, '--motive', 'second', '--token', token])
    expect(r2.status).toBe(0)
    expect(readLedger()['motive']).toBe('second')
  })
})

// ---------------------------------------------------------------------------
// 5. write_token on stdout
// ---------------------------------------------------------------------------

describe('write_token output', () => {
  it('prints write_token to stdout in parseable form', () => {
    const seedPath = join(projectDir, 'seed.json')
    writeFileSync(seedPath, CLEAN_SEED)

    const r = runGwLedger(['init', seedPath, '--motive', 'tok-test'])
    expect(r.status).toBe(0)
    const token = extractToken(r.stdout)
    expect(token).toMatch(/^[0-9a-f]{16}$/)
    expect(readLedger()['write_token']).toBe(token)
  })
})

// ---------------------------------------------------------------------------
// 6. bin/ledger init still works
// ---------------------------------------------------------------------------

describe('bin/ledger init backward-compat', () => {
  it('exits 0 and writes write_token to stdout', () => {
    const seedPath = join(projectDir, 'seed.json')
    writeFileSync(seedPath, CLEAN_SEED)

    const r = runBinLedger(['init', seedPath, '--motive', 'legacy'])
    expect(r.status).toBe(0)
    const token = extractToken(r.stdout)
    expect(token).toMatch(/^[0-9a-f]{16}$/)
  })
})
