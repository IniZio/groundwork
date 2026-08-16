/**
 * Tests for hooks/token-meter.mjs
 *
 * Coverage:
 *   1. parseTotals extracts all four fields into separate buckets
 *   2. parseTotals deduplicates records by uuid (no double-counting)
 *   3. parseTotals skips non-assistant records
 *   4. parseTotals handles missing cache_creation breakdown (falls back to 5m)
 *   5. computeCost applies correct per-field multipliers (not a collapsed sum)
 *   6. formatReport includes all four fields as separate lines
 *   7. CLI exits 0 and prints all four fields for a fixture file
 *   8. CLI exits 2 with no arguments
 *   9. CLI exits 0 for "help" subcommand
 *
 * Non-regression guard: if parseTotals ever collapses the four fields into one
 * input sum, tests (1) and (5) will fail loudly. This is the primary correctness
 * guarantee for the measurement motive (TBD-5).
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Dynamic import so the test does not fail if the file doesn't exist yet at
// module-evaluation time; we import once in beforeAll.
const HOOK = path.resolve(import.meta.dirname, '..', '..', 'hooks', 'token-meter.mjs')

// ── Import the exported functions directly (unit tests) ───────────────────────

const { parseTotals, computeCost, formatReport, BASE_INPUT_PRICE_PER_MTOK } =
  await import(HOOK)

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeRecord(
  uuid: string,
  opts: {
    input?: number
    cache_creation?: number
    cache_creation_5m?: number
    cache_creation_1h?: number
    cache_read?: number
    output?: number
    type?: string
    omitUsage?: boolean
  } = {},
): string {
  const usage = opts.omitUsage
    ? undefined
    : {
        input_tokens: opts.input ?? 0,
        cache_creation_input_tokens:
          (opts.cache_creation_5m ?? 0) + (opts.cache_creation_1h ?? 0) + (opts.cache_creation ?? 0),
        cache_read_input_tokens: opts.cache_read ?? 0,
        output_tokens: opts.output ?? 0,
        // Include breakdown when caller specifies 5m/1h separately
        ...(opts.cache_creation_5m !== undefined || opts.cache_creation_1h !== undefined
          ? {
              cache_creation: {
                ephemeral_5m_input_tokens: opts.cache_creation_5m ?? 0,
                ephemeral_1h_input_tokens: opts.cache_creation_1h ?? 0,
              },
            }
          : {}),
      }

  const record = {
    type: opts.type ?? 'assistant',
    uuid,
    message: usage ? { usage } : {},
  }
  return JSON.stringify(record)
}

/** Build a fixture JSONL string from an array of record lines. */
function fixture(...lines: string[]): string {
  return lines.join('\n') + '\n'
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe('parseTotals', () => {
  it('1. extracts all four fields into separate buckets', () => {
    const jsonl = fixture(
      makeRecord('r1', {
        input: 1000,
        cache_creation_5m: 2000,
        cache_creation_1h: 3000,
        cache_read: 4000,
        output: 500,
      }),
    )
    const t = parseTotals(jsonl)

    expect(t.input_tokens).toBe(1000)
    expect(t.cache_creation_5m_tokens).toBe(2000)
    expect(t.cache_creation_1h_tokens).toBe(3000)
    expect(t.cache_creation_input_tokens).toBe(5000) // 2000 + 3000
    expect(t.cache_read_input_tokens).toBe(4000)
    expect(t.output_tokens).toBe(500)
    expect(t.record_count).toBe(1)
  })

  it('2. deduplicates records by uuid — no double-counting', () => {
    // Same uuid appears twice (simulates sidechain duplicate)
    const jsonl = fixture(
      makeRecord('dup-1', { input: 100, cache_read: 200, output: 50 }),
      makeRecord('dup-1', { input: 100, cache_read: 200, output: 50 }), // duplicate
      makeRecord('uniq', { input: 10, output: 5 }),
    )
    const t = parseTotals(jsonl)

    expect(t.record_count).toBe(2) // dup-1 counted once, uniq once
    expect(t.input_tokens).toBe(110) // 100 + 10
    expect(t.cache_read_input_tokens).toBe(200)
    expect(t.output_tokens).toBe(55) // 50 + 5
  })

  it('3. skips non-assistant records (user, system, tool)', () => {
    const jsonl = fixture(
      makeRecord('u1', { input: 999, output: 999, type: 'user' }),
      makeRecord('s1', { input: 999, output: 999, type: 'system' }),
      makeRecord('a1', { input: 10, output: 5, type: 'assistant' }),
    )
    const t = parseTotals(jsonl)

    expect(t.record_count).toBe(1)
    expect(t.input_tokens).toBe(10)
    expect(t.output_tokens).toBe(5)
  })

  it('4. falls back to 5m bucket when cache_creation breakdown is absent', () => {
    // makeRecord with `cache_creation` (no breakdown) — no 5m/1h split
    const jsonl = fixture(
      makeRecord('r1', { cache_creation: 8000 }),
    )
    const t = parseTotals(jsonl)

    expect(t.cache_creation_5m_tokens).toBe(8000)
    expect(t.cache_creation_1h_tokens).toBe(0)
    expect(t.cache_creation_input_tokens).toBe(8000)
  })

  it('accumulates correctly across multiple records', () => {
    const jsonl = fixture(
      makeRecord('r1', { input: 500, cache_read: 1000, output: 100 }),
      makeRecord('r2', { input: 300, cache_creation_1h: 2000, output: 200 }),
    )
    const t = parseTotals(jsonl)

    expect(t.input_tokens).toBe(800)
    expect(t.cache_read_input_tokens).toBe(1000)
    expect(t.cache_creation_1h_tokens).toBe(2000)
    expect(t.output_tokens).toBe(300)
    expect(t.record_count).toBe(2)
  })
})

describe('computeCost', () => {
  it('5. applies per-field multipliers independently — not a collapsed input sum', () => {
    // 1 MTok each of every field → should yield distinct per-field costs
    const totals = {
      input_tokens: 1_000_000,
      cache_creation_5m_tokens: 1_000_000,
      cache_creation_1h_tokens: 1_000_000,
      cache_creation_input_tokens: 2_000_000,
      cache_read_input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      record_count: 1,
    }
    const cost = computeCost(totals)
    const base = BASE_INPUT_PRICE_PER_MTOK

    // Each field must have a DIFFERENT cost — collapse would make them equal.
    expect(cost.input).toBeCloseTo(base * 1)         // 1.0× input
    expect(cost.cache_creation_5m).toBeCloseTo(base * 1.25)   // 1.25×
    expect(cost.cache_creation_1h).toBeCloseTo(base * 2.00)   // 2.00× base input (verified: docs.anthropic.com/en/docs/build-with-claude/prompt-caching#pricing)
    expect(cost.cache_read).toBeCloseTo(base * 0.10)  // 0.10×
    expect(cost.output).toBeCloseTo(base * 5)         // 5.0×

    // Total is the sum of all five
    const expectedTotal =
      cost.input + cost.cache_creation_5m + cost.cache_creation_1h + cost.cache_read + cost.output
    expect(cost.total).toBeCloseTo(expectedTotal)
  })
})

describe('formatReport', () => {
  it('6. includes all four billing fields as separate lines', () => {
    const totals = {
      input_tokens: 100,
      cache_creation_5m_tokens: 200,
      cache_creation_1h_tokens: 300,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 400,
      output_tokens: 50,
      record_count: 1,
    }
    const report = formatReport('test-fixture', totals)

    // Each of the four billing fields must appear on its own line.
    expect(report).toMatch(/input_tokens\s*:\s*100/)
    expect(report).toMatch(/cache_creation.*5.min TTL.*:\s*200/)
    expect(report).toMatch(/cache_creation.*1.hr TTL.*:\s*300/)
    expect(report).toMatch(/cache_read_input_tokens\s*:\s*400/)
    expect(report).toMatch(/output_tokens\s*:\s*50/)
    // Cost-weighted total line must exist
    expect(report).toMatch(/Cost-weighted total/)
  })
})

// ── CLI integration tests (subprocess) ───────────────────────────────────────

describe('CLI', () => {
  let tmpDir: string
  let fixturePath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gw-token-meter-'))
    fixturePath = path.join(tmpDir, 'session.jsonl')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('7. exits 0 and prints all four token fields for a fixture file', () => {
    writeFileSync(
      fixturePath,
      fixture(
        makeRecord('a', { input: 50, cache_creation_1h: 1000, cache_read: 5000, output: 200 }),
        makeRecord('b', { input: 30, cache_creation_5m: 500, output: 100 }),
      ),
    )

    const out = execFileSync('node', [HOOK, fixturePath], { encoding: 'utf8' })

    // Separate fields must be present in output.
    expect(out).toMatch(/input_tokens/)
    expect(out).toMatch(/cache_creation.*5.min TTL/)
    expect(out).toMatch(/cache_creation.*1.hr TTL/)
    expect(out).toMatch(/cache_read_input_tokens/)
    expect(out).toMatch(/output_tokens/)
    expect(out).toMatch(/Cost-weighted total/)
    // Actual numbers must match fixture values
    expect(out).toMatch(/input_tokens\s*:\s*80/) // 50 + 30
    expect(out).toMatch(/cache_creation.*1.hr TTL.*:\s*1,000/)
    expect(out).toMatch(/cache_creation.*5.min TTL.*:\s*500/)
  })

  it('8. exits 2 with no arguments', () => {
    let code = 0
    try {
      execFileSync('node', [HOOK], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (err: unknown) {
      code = (err as { status: number }).status
    }
    expect(code).toBe(2)
  })

  it('9. exits 0 for "help" subcommand', () => {
    const out = execFileSync('node', [HOOK, 'help'], { encoding: 'utf8' })
    expect(out).toMatch(/token-meter/)
    expect(out).toMatch(/session\.jsonl/)
  })
})
