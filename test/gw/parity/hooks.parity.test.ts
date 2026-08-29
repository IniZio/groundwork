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
