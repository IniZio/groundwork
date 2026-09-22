/**
 * Unit tests for hooks/lib/concept-slug.mjs.
 *
 * Framework: vitest (same as extension.test.ts).
 * The lib is plain Node ESM — imported via relative path.
 */

import { describe, test, expect } from 'vitest'

import {
  toSlug,
  normalizeCommand,
  commandFingerprint,
} from '../hooks/lib/concept-slug.mjs'

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
