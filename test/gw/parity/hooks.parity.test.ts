/**
 * test/gw/parity/hooks.parity.test.ts
 *
 * AC-3 parity suite — feeds every scenario in test/fixtures/parity-corpus/
 * to the gw hook path (bun src/gw/cli/main.ts hook <name>) and asserts the
 * classified decision and exit_code match the corpus recording (legacy ground truth).
 *
 * The corpus IS the legacy baseline: it was captured from the original .mjs
 * implementations before they were converted to shims.  The corpus is immutable
 * ground truth (see test/fixtures/parity-corpus/README.md — D-10).
 *
 * Two "surfaces" compared per scenario:
 *   Legacy surface  — corpus fixture's recorded decision + exit_code
 *   GW surface      — live invocation of bun src/gw/cli/main.ts hook <name>
 *
 * AC-5: Any scenario where legacy and gw legitimately differ MUST be listed in
 * KNOWN_DIVERGENCES with a charter/decision citation.  An empty table means no
 * known divergences — every corpus scenario must match exactly.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  loadCorpus,
  isMultiFixture,
  type SingleFixture,
  type MultiFixture,
} from './corpus-loader.js'
import {
  setupTempDir,
  buildEnv,
  runGwHook,
  runMultiInvocations,
  classifyDecision,
} from './runner.js'

const CORPUS_DIR = new URL('../../fixtures/parity-corpus', import.meta.url).pathname

// ── Known legitimate divergences ──────────────────────────────────────────────
//
// Format: `${hookName}/${scenarioName}` → citation string
//
// AC-5 mandate: list every divergence here.  Empty table = no known divergences.
// Never use this as a silent normalisation — each entry must cite a decision/TBR.
//
const KNOWN_DIVERGENCES: Record<string, string> = {}

// ── Load corpus & build test matrix ──────────────────────────────────────────

const corpus = loadCorpus()

// Group by hookName for describe blocks
const byHook = new Map<string, typeof corpus>()
for (const scenario of corpus) {
  const group = byHook.get(scenario.hookName) ?? []
  group.push(scenario)
  byHook.set(scenario.hookName, group)
}

// ── Corpus integrity ──────────────────────────────────────────────────────────

const MANIFEST = JSON.parse(readFileSync(join(CORPUS_DIR, 'MANIFEST.json'), 'utf8')) as {
  version: number
  generated: string
  fixtures: Record<string, string>
}

describe('corpus integrity', () => {
  it('corpus fixture checksums match MANIFEST.json', () => {
    for (const [relPath, expectedHash] of Object.entries(MANIFEST.fixtures)) {
      const fullPath = join(CORPUS_DIR, relPath)
      const content = readFileSync(fullPath)
      const actualHash = createHash('sha256').update(content).digest('hex')
      expect(
        actualHash,
        `checksum mismatch for ${relPath}\n  expected: ${expectedHash}\n  actual:   ${actualHash}`,
      ).toBe(expectedHash)
    }
  })
})

// ── Struggle-detector journal oracle ─────────────────────────────────────────
//
// For each struggle-detector fixture that has expected_journal_events, run the
// invocations and assert that the gw hook wrote matching FAILURE events to the
// journal shard at <tempDir>/.groundwork/journal/<date>-<sessionId>.jsonl.
//
// This catches silent loss of emitHookEvent calls that the decision oracle cannot see.

describe('struggle-detector journal oracle', () => {
  const struggleScenarios = corpus.filter(s => s.hookName === 'struggle-detector')

  for (const { fixture, filePath } of struggleScenarios) {
    if (!isMultiFixture(fixture)) continue
    const multi = fixture as MultiFixture
    if (multi.expected_journal_events === undefined) continue

    it(`journal oracle: ${multi.scenario_name}`, () => {
      const { tempDir, cleanup } = setupTempDir(multi.disk_state_setup)
      try {
        const env = buildEnv(multi.env, tempDir)
        runMultiInvocations('struggle-detector', multi.invocations, env)

        // Derive shard path — matches resolveShardPath in src/gw/hook/struggle-detector.ts
        const firstPayload = multi.invocations[0].stdin_payload as { session_id: string }
        const sessionId = firstPayload.session_id
        const date = new Date().toISOString().slice(0, 10)
        const shardPath = join(tempDir, '.groundwork', 'journal', `${date}-${sessionId}.jsonl`)

        // expected_journal_events is defined here: outer loop skipped if undefined
        const expectedEvents = multi.expected_journal_events!

        if (expectedEvents.length === 0) {
          // No FAILURE events expected — shard may not exist or must have no FAILURE lines
          if (existsSync(shardPath)) {
            const lines = readFileSync(shardPath, 'utf8').split('\n').filter(l => l.trim())
            const failureEvents = lines
              .map(l => { try { return JSON.parse(l) as Record<string, unknown> } catch { return null } })
              .filter((e): e is Record<string, unknown> => e !== null && e['type'] === 'FAILURE')
            expect(
              failureEvents,
              `expected no FAILURE events in shard but found ${failureEvents.length}\n  file: ${filePath}`,
            ).toHaveLength(0)
          }
        } else {
          // FAILURE events expected — shard must exist and contain matching entries
          expect(
            existsSync(shardPath),
            `journal shard not found at ${shardPath}\n  file: ${filePath}`,
          ).toBe(true)
          const lines = readFileSync(shardPath, 'utf8').split('\n').filter(l => l.trim())
          const events = lines
            .map(l => { try { return JSON.parse(l) as Record<string, unknown> } catch { return null } })
            .filter((e): e is Record<string, unknown> => e !== null)

          // AC [2]: exact count — FAILURE events in shard must equal expected list length
          const failureEvents = events.filter(e => e['type'] === 'FAILURE')
          expect(
            failureEvents.length,
            `expected exactly ${expectedEvents.length} FAILURE event(s) in shard but found ${failureEvents.length}\n  file: ${filePath}`,
          ).toBe(expectedEvents.length)

          for (const expected of expectedEvents) {
            const match = events.find(e => {
              const data = e['data'] as Record<string, unknown> | undefined
              return (
                e['type'] === expected.type &&
                e['source'] === expected.source &&
                typeof e['msg'] === 'string' &&
                (e['msg'] as string).includes(expected.msg_contains) &&
                data !== null &&
                data !== undefined &&
                data['kind'] === expected.data.kind &&
                data['fingerprint'] === expected.data.fingerprint
              )
            })
            expect(
              match,
              `no journal event matching type=${expected.type} msg_contains="${expected.msg_contains}" kind=${expected.data.kind} fingerprint=${expected.data.fingerprint}\n  file: ${filePath}`,
            ).toBeDefined()
          }
        }
      } finally {
        cleanup()
      }
    })
  }
})

// ── Test suite ────────────────────────────────────────────────────────────────

for (const [hookName, scenarios] of byHook) {
  describe(`parity: ${hookName}`, () => {
    for (const { fixture, filePath } of scenarios) {
      const key = `${hookName}/${fixture.scenario_name}`
      const divergenceNote = KNOWN_DIVERGENCES[key]

      it(`${fixture.scenario_name} — ${fixture.description}`, () => {
        const { tempDir, cleanup } = setupTempDir(fixture.disk_state_setup)

        try {
          const env = buildEnv(fixture.env, tempDir)

          if (isMultiFixture(fixture)) {
            // struggle-detector: run all invocations sequentially on shared disk state
            const multi = fixture as MultiFixture
            const gwDecision = runMultiInvocations(hookName, multi.invocations, env)

            if (divergenceNote) {
              // AC-5: document divergence, skip equality assertion
              console.warn(`[parity] known divergence ${key}: ${divergenceNote}`)
              return
            }

            expect(
              gwDecision,
              `decision mismatch\n  corpus: ${multi.decision}\n  gw:     ${gwDecision}\n  file:   ${filePath}`,
            ).toBe(multi.decision)
          } else {
            // Single-invocation fixture (most hooks)
            const single = fixture as SingleFixture
            const result = runGwHook(hookName, single.stdin_payload, env)
            const gwDecision = classifyDecision(hookName, result)

            if (divergenceNote) {
              console.warn(`[parity] known divergence ${key}: ${divergenceNote}`)
              return
            }

            expect(
              gwDecision,
              `decision mismatch\n  corpus: ${single.decision}\n  gw:     ${gwDecision}\n  stdout: ${result.stdout.slice(0, 200)}\n  file:   ${filePath}`,
            ).toBe(single.decision)

            expect(
              result.exit,
              `exit_code mismatch\n  corpus: ${single.exit_code}\n  gw:     ${result.exit}\n  file:   ${filePath}`,
            ).toBe(single.exit_code)
          }
        } finally {
          cleanup()
        }
      })
    }
  })
}
