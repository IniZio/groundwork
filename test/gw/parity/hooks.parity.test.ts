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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  loadCorpus,
  isMultiFixture,
  PENDING_PORT_HOOKS,
  type SingleFixture,
  type MultiFixture,
} from './corpus-loader.js'
import {
  setupTempDir,
  buildEnv,
  runGwHook,
  runMjsHook,
  materialiseVaultForm,
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

// AC-5 lock: must equal Object.keys(KNOWN_DIVERGENCES).length.
// When adding a legitimate divergence, increment this constant AND cite a decision/TBR.
// The 'divergence registry lock' test fails until both the entry AND the acknowledgement land.
const KNOWN_DIVERGENCES_LOCK = 0

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

  it('MANIFEST entry count matches on-disk fixture count (count-parity)', () => {
    const diskCount = readdirSync(CORPUS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .reduce((acc, d) => {
        try {
          return acc + readdirSync(join(CORPUS_DIR, d.name)).filter(f => f.endsWith('.json')).length
        } catch {
          return acc
        }
      }, 0)
    expect(
      Object.keys(MANIFEST.fixtures).length,
      `MANIFEST has ${Object.keys(MANIFEST.fixtures).length} entries but ${diskCount} .json fixtures exist on disk.\n` +
      `  Run the MANIFEST generator to sync them.`,
    ).toBe(diskCount)
  })
})

// ── Coverage completeness: gw registry ↔ fixture corpus alignment ─────────────
//
// Three sets derived at test time from their real sources:
//   hooksJsonNames    — hook names registered in hooks/hooks.json (via .mjs command paths)
//   gwRegistryNames   — hook names declared in src/gw/hook/index.ts HOOKS object
//   fixtureCoveredNames — hook names that have a fixture directory in the corpus
//
// Rewire-eligible = hooksJsonNames ∩ gwRegistryNames.
// For the T5 rewire to be safe, gwRegistryNames must equal fixtureCoveredNames:
//   • gw ⊆ fixtures  — every gw hook has corpus proof before it can be rewired
//   • fixtures ⊆ gw  — no stale fixture dirs for hooks that left the gw registry
//
// FAILS if someone adds a hook to the gw registry without adding fixture files.

describe('coverage completeness', () => {
  it('gw registry and fixture corpus are exactly aligned (rewire-eligible = parity-proven set)', () => {
    const ROOT = join(CORPUS_DIR, '../../..')

    // Set 1: hook names registered in hooks.json.
    // Three registration forms are present (D-20):
    //   a) ${PLUGIN_ROOT}/hooks/<name>.mjs      — legacy .mjs shim
    //   b) ${PLUGIN_ROOT}/bin/gw-hook hook <name> — TypeScript dispatch
    //   c) ${PLUGIN_ROOT}/hooks/<name>            — bare-path (no extension, e.g. session-start)
    // commandsWalked / classifiedCommands power the totality assertion below.
    const hooksJsonRaw = JSON.parse(readFileSync(join(ROOT, 'hooks/hooks.json'), 'utf8'))
    const hooksJsonNames = new Set<string>()
    // gwHookEntries tracks only the `bin/gw-hook hook <name>` registrations specifically
    // (distinct from .mjs/.bare registrations) — used for the phantom-registration assertion below.
    const gwHookEntries = new Set<string>()
    // barePathShims maps shim-name (e.g. 'session-start') to its absolute file path.
    // Used below to resolve the handler each shim actually dispatches to via gw-hook.
    const barePathShims = new Map<string, string>()
    const commandsWalked: string[] = []
    const classifiedCommands = new Set<string>()
    const collectRegisteredHooks = (obj: unknown): void => {
      if (Array.isArray(obj)) { obj.forEach(collectRegisteredHooks); return }
      if (obj === null || typeof obj !== 'object') return
      const o = obj as Record<string, unknown>
      if (typeof o['command'] === 'string') {
        const cmd = o['command'] as string
        commandsWalked.push(cmd)
        let classified = false
        const mMjs = cmd.match(/\/hooks\/([^./\s]+)\.mjs/)
        if (mMjs) { hooksJsonNames.add(mMjs[1]); classified = true }
        const mGw = cmd.match(/gw-hook hook ([^\s]+)/)
        if (mGw) { hooksJsonNames.add(mGw[1]); gwHookEntries.add(mGw[1]); classified = true }
        // Bare-path: /hooks/<name> with no extension — matches at end of string so .mjs
        // variants (already caught above) are not double-counted.
        const mBare = cmd.match(/\/hooks\/([^./\s]+)$/)
        if (mBare) {
          hooksJsonNames.add(mBare[1])
          // Record the shim file path so we can resolve its dispatch target below.
          barePathShims.set(mBare[1], join(ROOT, 'hooks', mBare[1]))
          classified = true
        }
        if (classified) classifiedCommands.add(cmd)
      }
      Object.values(o).forEach(collectRegisteredHooks)
    }
    collectRegisteredHooks(hooksJsonRaw)

    // Resolve shim indirection: read each bare-path shim and extract the gw handler
    // it dispatches to (via `gw-hook hook <name>`).  This models the case where a shim
    // like hooks/session-start is the registered command but internally invokes a gw
    // TypeScript handler (session-reminder) — the handler is effectively registered even
    // though its literal name never appears in hooks.json.
    //
    // Deriving the target from the shim source (rather than hard-coding an exemption
    // list) means the assertion keeps tracking reality: if the shim is repointed or a
    // new shim appears, the mapping updates automatically.
    const shimDispatchTargets = new Map<string, string>() // shim-name → gw handler name
    for (const [shimName, shimPath] of barePathShims) {
      try {
        const shimSrc = readFileSync(shimPath, 'utf8')
        // The shim may quote the path: `"$DIR/bin/gw-hook" hook <name>` — allow an
        // optional closing quote/space between `gw-hook` and the `hook` subcommand.
        const mDispatch = shimSrc.match(/gw-hook["']?\s+hook\s+([^\s"'$@]+)/)
        if (mDispatch) {
          shimDispatchTargets.set(shimName, mDispatch[1])
        }
      } catch {
        // shim not readable — caught by unresolvableShims assertion below
      }
    }

    // Shims that exist as bare-path registrations but have no parseable dispatch target.
    const unresolvableShims = [...barePathShims.keys()].filter(n => !shimDispatchTargets.has(n)).sort()
    expect(
      unresolvableShims,
      `bare-path shims have no extractable 'gw-hook hook <name>' dispatch target —\n` +
      `  shim file missing, unexecutable, or pattern changed:\n` +
      `  ${unresolvableShims.join(', ')}`,
    ).toEqual([])

    // The full set of effectively-registered handler names: direct registrations PLUS
    // any handler reachable via a registered shim.
    const effectivelyRegistered = new Set([...hooksJsonNames, ...shimDispatchTargets.values()])

    // Set 2: hook names declared in the gw TypeScript registry
    const gwIndexSrc = readFileSync(join(ROOT, 'src/gw/hook/index.ts'), 'utf8')
    const gwRegistryNames = new Set(
      [...gwIndexSrc.matchAll(/^\s*'([^']+)':\s+\w/gm)].map(m => m[1]),
    )

    // Set 3: hook names with fixture directories in the corpus (directory + ≥1 JSON file)
    const fixtureCoveredNames = new Set(
      readdirSync(CORPUS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .filter(d => readdirSync(join(CORPUS_DIR, d.name)).some(f => f.endsWith('.json')))
        .map(d => d.name),
    )

    // Derived: rewire-eligible = hooks.json ∩ gw registry (T5 consumer)
    const rewireEligible = [...gwRegistryNames].filter(h => hooksJsonNames.has(h)).sort()

    // Assert gw ⊆ fixture-covered: every gw hook must have corpus fixtures
    const gwWithoutFixtures = [...gwRegistryNames].filter(h => !fixtureCoveredNames.has(h)).sort()
    expect(
      gwWithoutFixtures,
      `gw hooks lacking corpus fixtures — add fixtures before T5 rewire:\n` +
      `  missing: ${gwWithoutFixtures.join(', ')}\n` +
      `  rewire-eligible set (for T5): ${rewireEligible.join(', ')}`,
    ).toEqual([])

    const pendingPortSet = new Set<string>(PENDING_PORT_HOOKS)
    const fixturesWithoutGw = [...fixtureCoveredNames]
      .filter(h => !gwRegistryNames.has(h) && !pendingPortSet.has(h))
      .sort()
    expect(
      fixturesWithoutGw,
      `fixture-covered hooks absent from gw registry and not in PENDING_PORT_HOOKS (stale fixture dirs):\n` +
      `  stale: ${fixturesWithoutGw.join(', ')}\n` +
      `  PENDING_PORT (excluded from this check): ${[...pendingPortSet].sort().join(', ')}`,
    ).toEqual([])

    const pendingPortWithoutFixtures = [...pendingPortSet].filter(h => {
      const dirPath = join(CORPUS_DIR, h)
      try {
        return !readdirSync(dirPath).some(f => f.endsWith('.json'))
      } catch {
        return true
      }
    }).sort()
    expect(
      pendingPortWithoutFixtures,
      `PENDING_PORT hooks lacking corpus fixture dirs or JSON files:\n` +
      `  missing: ${pendingPortWithoutFixtures.join(', ')}`,
    ).toEqual([])

    const pendingPortWithoutMjs = [...pendingPortSet].filter(h =>
      !commandsWalked.some(cmd => cmd.includes(h) && cmd.endsWith('.mjs')),
    ).sort()
    expect(
      pendingPortWithoutMjs,
      `PENDING_PORT hooks lacking hooks/<name>.mjs registration in hooks.json:\n` +
      `  missing: ${pendingPortWithoutMjs.join(', ')}`,
    ).toEqual([])

    // Assert gw-hook entries exist (positive control — catches silent extraction failures).
    // With only the .mjs regex, gwHookEntries would be empty (the D-20 registration form is
    // invisible); this assertion fails immediately rather than letting the suite agree vacuously.
    expect(
      gwHookEntries.size,
      `No 'gw-hook hook <name>' entries found in hooks.json — extraction regex may be broken.\n` +
      `  hooksJsonNames (${hooksJsonNames.size}): ${[...hooksJsonNames].sort().join(', ')}`,
    ).toBeGreaterThan(0)

    // Assert no phantom gw-hook registrations: every hooks.json 'gw-hook hook <name>' entry
    // must resolve to a handler in the gw TypeScript registry (else it would fail at runtime).
    const phantomGwHooks = [...gwHookEntries].filter(h => !gwRegistryNames.has(h)).sort()
    expect(
      phantomGwHooks,
      `hooks.json gw-hook commands reference handlers absent from gw TypeScript registry:\n` +
      `  phantom: ${phantomGwHooks.join(', ')}\n` +
      `  gw registry (${gwRegistryNames.size}): ${[...gwRegistryNames].sort().join(', ')}`,
    ).toEqual([])

    // Assert shim integrity: every bare-path shim must dispatch to a real gw handler.
    // A shim that dispatches to a handler absent from the registry is a silent production
    // failure — the hook fires but immediately errors out at dispatch.
    const brokenShims = [...shimDispatchTargets.entries()]
      .filter(([, target]) => !gwRegistryNames.has(target))
      .map(([shim, target]) => `${shim}→${target}`)
      .sort()
    expect(
      brokenShims,
      `bare-path shims dispatch to handler names absent from gw TypeScript registry:\n` +
      `  broken: ${brokenShims.join(', ')}\n` +
      `  gwRegistryNames (${gwRegistryNames.size}): ${[...gwRegistryNames].sort().join(', ')}`,
    ).toEqual([])

    // Assert gwRegistryNames ⊆ effectivelyRegistered: every gw TypeScript handler must be
    // reachable from hooks/hooks.json — either via a direct registration or via a registered
    // shim that dispatches to it.  A handler absent from both is never wired — a silent
    // production failure.  The reverse direction (effectivelyRegistered ⊆ gwRegistryNames)
    // is intentionally NOT asserted: effectivelyRegistered legitimately contains .mjs-only
    // hooks (D-20: spec-guard, deslop-guard, prose-negation-guard, prose-modality-guard,
    // doc-read-guard, doc-size-guard, keyword-router) and bare-path shim names
    // (e.g. session-start), none of which have a gw implementation.
    const gwMissingFromHooksJson = [...gwRegistryNames].filter(h => !effectivelyRegistered.has(h)).sort()
    expect(
      gwMissingFromHooksJson,
      `gw TypeScript handlers not registered in hooks/hooks.json (directly or via shim) — hook exists in code but never fires:\n` +
      `  missing: ${gwMissingFromHooksJson.join(', ')}\n` +
      `  effectivelyRegistered (${effectivelyRegistered.size}): ${[...effectivelyRegistered].sort().join(', ')}\n` +
      `  gwRegistryNames (${gwRegistryNames.size}): ${[...gwRegistryNames].sort().join(', ')}`,
    ).toEqual([])

    // Totality assertion: every command string walked in hooks.json must be classified by at
    // least one extraction pattern.  An unrecognised registration form is otherwise silently
    // dropped — this assertion names the offending command(s) and fails immediately rather than
    // letting downstream set operations agree vacuously on an incomplete hooksJsonNames.
    const unclassifiedCommands = commandsWalked.filter(cmd => !classifiedCommands.has(cmd))
    expect(
      unclassifiedCommands,
      `hooks.json commands not matched by any extraction pattern — ` +
      `update collectRegisteredHooks to cover:\n` +
      `  ${unclassifiedCommands.join('\n  ')}\n` +
      `  (walked ${commandsWalked.length} commands, classified ${classifiedCommands.size})`,
    ).toEqual([])
  })
})

// ── Divergence registry lock ───────────────────────────────────────────────────
//
// KNOWN_DIVERGENCES must not grow silently.  KNOWN_DIVERGENCES_LOCK must equal
// Object.keys(KNOWN_DIVERGENCES).length at all times.  A future engineer cannot
// silence a parity failure by appending to KNOWN_DIVERGENCES alone — they must
// also increment KNOWN_DIVERGENCES_LOCK and cite a decision/TBR inline.

describe('divergence registry lock', () => {
  it('KNOWN_DIVERGENCES has not grown beyond the acknowledged count', () => {
    const actual = Object.keys(KNOWN_DIVERGENCES).length
    expect(
      actual,
      `KNOWN_DIVERGENCES has ${actual} entr${actual === 1 ? 'y' : 'ies'} but ` +
      `KNOWN_DIVERGENCES_LOCK is ${KNOWN_DIVERGENCES_LOCK}. ` +
      'Increment KNOWN_DIVERGENCES_LOCK (and cite a decision/TBR) when adding a divergence.',
    ).toBe(KNOWN_DIVERGENCES_LOCK)
  })
})

// ── Struggle-detector journal oracle ─────────────────────────────────────────
//
// For each struggle-detector fixture that has expected_journal_events, run the
// invocations and assert that the gw hook wrote matching FAILURE events to the
// journal shard at <tempDir>/.groundwork/journal/<date>-<sessionId>.jsonl.
//
// This catches silent loss of emitHookEvent calls that the decision oracle cannot see.

const _struggleScenarios = corpus.filter(s => s.hookName === 'struggle-detector')
describe.skipIf(_struggleScenarios.length === 0)('struggle-detector journal oracle', () => {
  const struggleScenarios = _struggleScenarios

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

const _pendingPortSet = new Set<string>(PENDING_PORT_HOOKS)

for (const [hookName, scenarios] of byHook) {
  describe(`parity: ${hookName}`, () => {
    for (const { fixture, filePath } of scenarios) {
      const key = `${hookName}/${fixture.scenario_name}`
      const divergenceNote = KNOWN_DIVERGENCES[key]

      it(`${fixture.scenario_name} — ${fixture.description}`, () => {
        const { tempDir, cleanup } = setupTempDir(fixture.disk_state_setup)

        try {
          const env = buildEnv(fixture.env, tempDir)
          materialiseVaultForm(fixture.disk_state_setup, tempDir)

          if (_pendingPortSet.has(hookName)) {
            const single = fixture as SingleFixture
            const interpolatedPayload = JSON.parse(
              JSON.stringify(single.stdin_payload).replace(/<(?:temp_dir|isolated_temp_dir)>/g, tempDir),
            )
            const expectedStdout = single.stdout.replace(/<(?:temp_dir|isolated_temp_dir)>/g, tempDir)
            const result = runMjsHook(hookName, interpolatedPayload, env)
            if (!divergenceNote) {
              expect(result.stdout, `stdout mismatch\n  file: ${filePath}`).toBe(expectedStdout)
              expect(result.exit, `exit_code mismatch\n  corpus: ${single.exit_code}\n  mjs:    ${result.exit}\n  file:   ${filePath}`).toBe(single.exit_code)
            }
            return
          }

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
