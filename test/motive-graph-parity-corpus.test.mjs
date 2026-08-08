/**
 * motive-graph-parity-corpus.test.mjs — CI parity harness across all motives.
 *
 * Enumerates every motive under .groundwork/motives/ dynamically and asserts
 * fold-vs-compile parity for each via assertFoldCompileParity().
 *
 * Hard failures from any motive block the gate — do NOT soften the assertion
 * or add motives to a skip-list to go green. A failing motive is a T2 finding
 * that blocks consumer cutovers (T3/T4/T5).
 *
 * Named findings (superseded_by forward-ref, legacy title) are logged but do
 * NOT cause test failure — they are expected structural behaviour.
 *
 * Run: npx vitest run test/motive-graph-parity-corpus.test.mjs
 */

import { describe, it, expect } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { assertFoldCompileParity, checkFoldCompileParity } from '../hooks/lib/motive-graph-parity.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const JOURNAL_DIR = path.join(ROOT, '.groundwork', 'journal')
const MOTIVES_DIR = path.join(ROOT, '.groundwork', 'motives')

// Enumerate motives dynamically — never hardcode this list.
// A hardcoded list silently ignores newly-created motives; the harness goes vacuous.
const allMotives = fs.readdirSync(MOTIVES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()

describe('motive-graph-parity-corpus — fold ≡ compile for all motives', () => {
  it('discovers at least one motive (guards against vacuous glob)', () => {
    expect(allMotives.length, 'No motives found — harness would pass vacuously').toBeGreaterThan(0)
  })

  for (const slug of allMotives) {
    it(`${slug}: assertFoldCompileParity — no hard divergences`, () => {
      // assertFoldCompileParity throws on hard divergences with slug + field in message.
      // Named findings (forward-ref superseded_by, legacy title) do NOT throw.
      const result = assertFoldCompileParity(slug, JOURNAL_DIR)

      // Zero hard divergences
      expect(result.divergences, `${slug}: hard divergence(s) detected`).toEqual([])

      // Log named findings for visibility but do not fail on them
      if (result.findings.length > 0) {
        console.log(`[parity-corpus] ${slug}: ${result.findings.length} named finding(s)`, result.findings)
      }
    })
  }
})

// ── FIX 2: pin the REQUIRE-EVENTS contract ───────────────────────────────────

describe('checkFoldCompileParity contract — events required (D-7)', () => {
  // Minimal valid-shape stubs — no motive data needed for the contract test.
  const projStub = { objective: null, decision_log: [], ac_coverage: { met: [], unmet: [] }, last_pause: null, baselines: [] }
  const compStub = { agent: { objective: null, decision_log: [], ac_coverage: { met: [], unmet: [] }, last_pause: null, baselines: [] } }

  it('throws when called without events (pinning REQUIRE-EVENTS contract)', () => {
    // This test MUST fail (not throw) if the guard is removed — removing the throw
    // causes checkFoldCompileParity to return normally, making .toThrow() fail red.
    expect(() => checkFoldCompileParity(projStub, compStub)).toThrow(
      'checkFoldCompileParity requires `events`',
    )
  })

  it('does NOT throw when events array is provided (even empty)', () => {
    expect(() => checkFoldCompileParity(projStub, compStub, { events: [] })).not.toThrow()
  })
})
