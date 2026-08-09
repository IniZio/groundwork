/**
 * Unit tests for hooks/lib/signals-io.mjs and hooks/lib/concept-slug.mjs.
 *
 * Framework: vitest (same as extension.test.ts).
 * The libs are plain Node ESM — imported via relative path.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Dynamic imports resolve to .mjs from the project root.
import {
  resolveSignalsPath,
  appendSignal,
  readSignals,
} from '../hooks/lib/signals-io.mjs'

import {
  toSlug,
  normalizeCommand,
  commandFingerprint,
} from '../hooks/lib/concept-slug.mjs'

// ---------------------------------------------------------------------------
// signals-io
// ---------------------------------------------------------------------------

describe('signals-io', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `gw-signals-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('resolveSignalsPath returns path inside .groundwork/', () => {
    const p = resolveSignalsPath(tmpDir)
    expect(p).toBe(path.join(tmpDir, '.groundwork', 'struggle-signals.jsonl'))
  })

  test('appendSignal creates the file and .groundwork/ dir on first call', () => {
    const signal = {
      ts: '2026-07-21T00:00:00.000Z',
      session_id: 'ses_test1',
      kind: 'repeat-command',
      fingerprint: 'abc123def456',
      detail: { cmd: 'go build ./x', count: 3 },
    }
    appendSignal(tmpDir, signal)
    const filePath = resolveSignalsPath(tmpDir)
    expect(existsSync(filePath)).toBe(true)
  })

  test('JSONL round-trip: appended signals are parsed back intact', () => {
    const signals = [
      { ts: '2026-07-21T01:00:00.000Z', session_id: 'ses_a', kind: 'repeat-command', fingerprint: 'fp1', detail: { n: 1 } },
      { ts: '2026-07-21T02:00:00.000Z', session_id: 'ses_b', kind: 'fail-retry', fingerprint: 'fp2', detail: { n: 2 } },
      { ts: '2026-07-21T03:00:00.000Z', session_id: 'ses_c', kind: 'file-thrash', fingerprint: 'fp3', detail: { n: 3 } },
    ]
    for (const s of signals) appendSignal(tmpDir, s)
    const read = readSignals(tmpDir)
    expect(read).toHaveLength(3)
    expect(read[0]).toEqual(signals[0])
    expect(read[1]).toEqual(signals[1])
    expect(read[2]).toEqual(signals[2])
  })

  test('readSignals returns [] when file does not exist', () => {
    expect(readSignals(tmpDir)).toEqual([])
  })

  test('corrupt trailing line is skipped, valid lines are returned', () => {
    // Write one valid line, then a partial/corrupt trailing line.
    const filePath = resolveSignalsPath(tmpDir)
    mkdirSync(path.dirname(filePath), { recursive: true })
    const valid = { ts: 'T', session_id: 'ses_x', kind: 'error-signature', fingerprint: 'fp0', detail: {} }
    writeFileSync(filePath, `${JSON.stringify(valid)}\n{"corrupt":true, "trunc\n`)
    const read = readSignals(tmpDir)
    expect(read).toHaveLength(1)
    expect(read[0]).toEqual(valid)
  })

  test('multiple appends accumulate in order', () => {
    for (let i = 0; i < 5; i++) {
      appendSignal(tmpDir, { ts: `T${i}`, session_id: 'ses_z', kind: 'repeat-command', fingerprint: `fp${i}`, detail: { i } })
    }
    const read = readSignals(tmpDir)
    expect(read).toHaveLength(5)
    expect(read.map((s: any) => s.detail.i)).toEqual([0, 1, 2, 3, 4])
  })
})

// ---------------------------------------------------------------------------
// concept-slug — toSlug
// ---------------------------------------------------------------------------

describe('toSlug', () => {
  test('lowercases input', () => {
    expect(toSlug('ProdBinaryDeploy')).toBe('prodbinarydeploy')
  })

  test('replaces non-alnum runs with a single hyphen', () => {
    expect(toSlug('Prod Binary Deploy!')).toBe('prod-binary-deploy')
  })

  test('collapses repeated separators', () => {
    expect(toSlug('go  build  ./cmd')).toBe('go-build-cmd')
  })

  test('trims leading/trailing hyphens', () => {
    expect(toSlug('  retry loop  ')).toBe('retry-loop')
  })

  test('is stable — same input always yields same output', () => {
    const concept = 'embed-manifest error'
    expect(toSlug(concept)).toBe(toSlug(concept))
    expect(toSlug(concept)).toBe('embed-manifest-error')
  })

  test('passes through already-clean slug unchanged', () => {
    expect(toSlug('prod-binary-deploy')).toBe('prod-binary-deploy')
  })
})

// ---------------------------------------------------------------------------
// concept-slug — normalizeCommand
// ---------------------------------------------------------------------------

describe('normalizeCommand', () => {
  // Core requirement: these three commands MUST share the same normalised form.
  const variants = [
    'go build ./x',
    'go build ./x -o /tmp/a',
    'go build ./x -o /tmp/b',
  ]

  test('all three go-build variants normalise to the same string', () => {
    const norms = variants.map(normalizeCommand)
    expect(norms[0]).toBe(norms[1])
    expect(norms[1]).toBe(norms[2])
  })

  test('go build and go test normalise differently', () => {
    expect(normalizeCommand('go build ./x')).not.toBe(normalizeCommand('go test ./x'))
  })

  test('strips leading env assignments', () => {
    const withEnv = 'GOOS=linux GOARCH=amd64 go build ./cmd'
    const plain = 'go build ./cmd'
    expect(normalizeCommand(withEnv)).toBe(normalizeCommand(plain))
  })

  test('collapses internal whitespace', () => {
    expect(normalizeCommand('go  build   ./x')).toBe(normalizeCommand('go build ./x'))
  })

  test('drops flags and their values entirely, keeping only command+subcommand', () => {
    // Flags are per-invocation details; they are always stripped.
    const n = normalizeCommand('git commit -m "some message here"')
    expect(n).toBe('git commit')
    expect(n).not.toContain('-m')
    expect(n).not.toContain('some message')
  })

  test('flags with embedded = value are also dropped', () => {
    // --output=/tmp/bin is a flag (starts with -) — dropped even with embedded value.
    const n = normalizeCommand('go build --output=/tmp/bin ./x')
    expect(n).toBe('go build')
    expect(n).not.toContain('--output')
  })

  test('different subcommands remain distinct', () => {
    expect(normalizeCommand('npm install')).not.toBe(normalizeCommand('npm run build'))
  })
})

// ---------------------------------------------------------------------------
// concept-slug — commandFingerprint
// ---------------------------------------------------------------------------

describe('commandFingerprint', () => {
  test('returns a 12-character hex string', () => {
    const fp = commandFingerprint('go build ./x')
    expect(fp).toMatch(/^[0-9a-f]{12}$/)
  })

  test('is stable — same command → same fingerprint', () => {
    expect(commandFingerprint('go build ./x')).toBe(commandFingerprint('go build ./x'))
  })

  test('variants that normalise the same share the same fingerprint', () => {
    const fp1 = commandFingerprint('go build ./x -o /tmp/a')
    const fp2 = commandFingerprint('go build ./x -o /tmp/b')
    const fpBase = commandFingerprint('go build ./x')
    expect(fp1).toBe(fpBase)
    expect(fp2).toBe(fpBase)
  })

  test('different commands have different fingerprints', () => {
    expect(commandFingerprint('go build ./x')).not.toBe(commandFingerprint('go test ./x'))
  })
})
