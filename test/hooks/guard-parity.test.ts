/**
 * guard-parity.test.ts — S11: parity tests spanning duplicated contracts
 *
 * SEAM 1  PATH-TRAVERSAL / SAFE-ID guard (SECURITY — highest priority)
 *   Three copies bound only by comments:
 *     hooks/lib/ledger-io.mjs   — SAFE_ID (original)
 *     hooks/lib/gate-seal.mjs   — SAFE_ID (mirrors ledger-io)
 *     hooks/lib/graph-seal.mjs  — SAFE_SLUG (mirrors gate-seal / ledger-io)
 *   A table-driven test feeds the same hostile + valid inputs to all three.
 *   Regex-pattern parity is checked at source level; accept/reject behaviour
 *   is checked against all three exported functions.
 *
 * SEAM 2  pacing `policy` enum — schemas/run-ledger.schema.json ↔ pacing.mjs
 *
 * SEAM 3  `kind` enum duplicated within schemas/run-ledger.schema.json
 *   $defs/slice.kind  ↔  pacing.exempt_kinds.items  (exempt ⊆ slice)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveLedgerPath } from '../../hooks/lib/ledger-io.mjs'
import { keyPath as gateSealKeyPath } from '../../hooks/lib/gate-seal.mjs'
import { keyPath as graphSealKeyPath } from '../../hooks/lib/graph-seal.mjs'
import { checkPace, resolvedUnits } from '../../hooks/lib/pacing.mjs'

// Repo root — this file lives at test/hooks/guard-parity.test.ts
const REPO = new URL('../..', import.meta.url).pathname

// A non-existent projectDir so resolveLedgerPath always falls to the
// "new run" branch (neither per-session nor legacy file exists on disk).
const PROJ = '/tmp/gp-parity-test'

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the inner pattern string from `const <name> = /pattern/` in source.
 * Throws if the declaration is absent — that itself is a finding.
 */
function extractRegexSource(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name}\\s*=\\s*/([^/]+)/`))
  if (!m) throw new Error(`regex const ${name} not found in source`)
  return m[1]
}

// ─────────────────────────────────────────────────────────────────────────────
// SEAM 1: PATH-TRAVERSAL / SAFE-ID guard (SECURITY)
// ─────────────────────────────────────────────────────────────────────────────

/** Shared input table driven against all three guard implementations. */
const GUARD_CASES: Array<{ id: string; expectAccept: boolean; label: string }> = [
  // ── Hostile: must be REJECTED ─────────────────────────────────────────────
  { id: '../escape',        expectAccept: false, label: 'single dotdot traversal' },
  { id: 'a/../../b',       expectAccept: false, label: 'double dotdot mid-path' },
  { id: '/etc/passwd',     expectAccept: false, label: 'absolute path' },
  { id: 'a\x00b',         expectAccept: false, label: 'null byte' },
  { id: '',                expectAccept: false, label: 'empty string' },
  { id: '.',               expectAccept: false, label: 'single dot' },
  { id: '..',              expectAccept: false, label: 'double dot' },
  { id: 'a'.repeat(129),  expectAccept: false, label: 'too long (129 chars)' },
  { id: '..\\windows',    expectAccept: false, label: 'backslash traversal' },
  { id: '%2e%2e%2f',      expectAccept: false, label: 'URL-encoded traversal' },
  { id: '\u0430-cyrillic', expectAccept: false, label: 'unicode lookalike (Cyrillic а)' },
  { id: 'path/sub',       expectAccept: false, label: 'path with slash' },
  { id: 'hello world',    expectAccept: false, label: 'space in id' },
  { id: 'id@host',        expectAccept: false, label: 'at-sign' },
  { id: '<script>',       expectAccept: false, label: 'angle brackets' },
  { id: 'a=b',            expectAccept: false, label: 'equals sign' },
  // ── Valid: must be ACCEPTED ───────────────────────────────────────────────
  { id: 'abc',             expectAccept: true,  label: 'simple lowercase' },
  { id: 'ABC',             expectAccept: true,  label: 'simple uppercase' },
  { id: 'abc-123',         expectAccept: true,  label: 'alphanumeric with dash' },
  { id: 'abc_123',         expectAccept: true,  label: 'alphanumeric with underscore' },
  { id: 'a',               expectAccept: true,  label: 'single char' },
  { id: 'a'.repeat(128),  expectAccept: true,  label: 'max length (128 chars)' },
  { id: 'My-Session_2024', expectAccept: true,  label: 'mixed valid chars' },
  { id: 'spine-beads-hitl',expectAccept: true,  label: 'motive-slug style' },
  { id: 'ABC123',          expectAccept: true,  label: 'alphanumeric only' },
  { id: 'Z',               expectAccept: true,  label: 'single uppercase char' },
]

describe('SEAM 1 — SAFE_ID / SAFE_SLUG path-traversal guard parity (SECURITY)', () => {

  // ── Source-level parity ───────────────────────────────────────────────────
  // All three regex declarations must be byte-identical.
  // If this test fails, a SECURITY GUARD HAS DRIFTED — do not suppress.

  it('all three source copies carry the same regex pattern (security parity)', () => {
    const ledgerSrc = readFileSync(join(REPO, 'hooks/lib/ledger-io.mjs'), 'utf8')
    const gateSrc   = readFileSync(join(REPO, 'hooks/lib/gate-seal.mjs'), 'utf8')
    const graphSrc  = readFileSync(join(REPO, 'hooks/lib/graph-seal.mjs'), 'utf8')

    const ledgerPattern = extractRegexSource(ledgerSrc, 'SAFE_ID')
    const gatePattern   = extractRegexSource(gateSrc,   'SAFE_ID')
    const graphPattern  = extractRegexSource(graphSrc,  'SAFE_SLUG')

    // SECURITY: any divergence is a real finding; do not weaken these assertions
    expect(gatePattern,
      'SECURITY DRIFT: gate-seal.mjs SAFE_ID diverges from ledger-io.mjs SAFE_ID',
    ).toBe(ledgerPattern)

    expect(graphPattern,
      'SECURITY DRIFT: graph-seal.mjs SAFE_SLUG diverges from ledger-io.mjs SAFE_ID',
    ).toBe(ledgerPattern)
  })

  // ── ledger-io.mjs: resolveLedgerPath ─────────────────────────────────────

  describe('ledger-io resolveLedgerPath accept / reject', () => {
    for (const { id, expectAccept, label } of GUARD_CASES) {
      it(`${expectAccept ? 'ACCEPT' : 'REJECT'}: ${label}`, () => {
        // Valid sessionId → per-session path ending /<id>.json
        // Invalid sessionId → legacy path ending with run.json (never contains id)
        const result = resolveLedgerPath({ projectDir: PROJ, sessionId: id })
        const accepted = result.endsWith(`/${id}.json`)
        expect(accepted).toBe(expectAccept)
      })
    }
  })

  // ── gate-seal.mjs: keyPath ───────────────────────────────────────────────

  describe('gate-seal keyPath accept / reject', () => {
    for (const { id, expectAccept, label } of GUARD_CASES) {
      it(`${expectAccept ? 'ACCEPT' : 'REJECT'}: ${label}`, () => {
        // Valid sessionId → path ending /<id>.seal.key
        // Invalid sessionId → path ending legacy.seal.key
        const result = gateSealKeyPath({ projectDir: PROJ, sessionId: id })
        const accepted = result.endsWith(`/${id}.seal.key`)
        expect(accepted).toBe(expectAccept)
      })
    }
  })

  // ── graph-seal.mjs: keyPath ──────────────────────────────────────────────

  describe('graph-seal keyPath accept / reject', () => {
    for (const { id, expectAccept, label } of GUARD_CASES) {
      it(`${expectAccept ? 'ACCEPT' : 'REJECT'}: ${label}`, () => {
        // Valid slug → path ending /<slug>/graph.seal.key
        // Invalid slug → path ending unknown/graph.seal.key
        const result = graphSealKeyPath({ projectDir: PROJ, slug: id })
        const accepted = result.endsWith(`/${id}/graph.seal.key`)
        expect(accepted).toBe(expectAccept)
      })
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SEAM 2: pacing `policy` enum — schema ↔ pacing.mjs
// ─────────────────────────────────────────────────────────────────────────────

describe('SEAM 2 — pacing policy enum parity (schema ↔ pacing.mjs)', () => {
  const schema = JSON.parse(
    readFileSync(join(REPO, 'schemas/run-ledger.schema.json'), 'utf8'),
  ) as {
    properties: { pacing: { properties: { policy: { enum: string[] } } } }
  }
  const schemaPolicies = schema.properties.pacing.properties.policy.enum
  const pacingSrc = readFileSync(join(REPO, 'hooks/lib/pacing.mjs'), 'utf8')

  it('schema policy enum is non-empty', () => {
    expect(schemaPolicies.length).toBeGreaterThan(0)
  })

  it('pacing.mjs references every schema policy value (schema→engine direction)', () => {
    // Adding a policy to the schema without handling it in pacing.mjs makes this fail.
    // pacing.mjs uses 'wave' in `// policy === 'wave'` comments and 'slice' in code.
    for (const policy of schemaPolicies) {
      expect(pacingSrc,
        `pacing.mjs must reference policy value '${policy}' — it is in the schema but appears unhandled`,
      ).toContain(`'${policy}'`)
    }
  })

  it('every explicitly-named policy in pacing.mjs is in the schema (engine→schema direction)', () => {
    // Adding a policy branch in pacing.mjs without updating the schema makes this fail.
    const found = [...pacingSrc.matchAll(/policy\s*!?===?\s*'(\w+)'/g)].map((m) => m[1])
    const unique = [...new Set(found)]
    for (const p of unique) {
      expect(schemaPolicies,
        `pacing.mjs explicitly handles policy '${p}' which is not in the schema enum`,
      ).toContain(p)
    }
  })

  it('checkPace returns a typed result for every schema policy value', () => {
    // Behavioural: no schema policy value may cause checkPace to throw or return undefined.
    for (const policy of schemaPolicies) {
      const doc = {
        pacing: { policy, budget: 2, exempt_kinds: [] as string[] },
        slices: [{ id: 's1', wave: 1, kind: 'impl', status: 'pending' }],
      }
      const result = checkPace(doc, 's1')
      expect(result,
        `checkPace must return an object for policy='${policy}'`,
      ).toBeDefined()
      expect(typeof result.allowed,
        `allowed field must be boolean for policy='${policy}'`,
      ).toBe('boolean')
    }
  })

  it('wave and slice policies produce distinct resolvedUnits (proves branching is live)', () => {
    // A doc where waves and slices give different counts — confirms the engine branches.
    // wave 1: s1 complete + s2 pending → wave 1 NOT fully resolved
    // wave 2: s3 complete              → wave 2 resolved
    // slice:  s1 + s3 complete         → 2 units resolved
    const slices = [
      { id: 's1', wave: 1, kind: 'impl', status: 'complete' },
      { id: 's2', wave: 1, kind: 'impl', status: 'pending'  },
      { id: 's3', wave: 2, kind: 'impl', status: 'complete' },
    ]
    const waveDoc  = { pacing: { policy: 'wave',  budget: 3, exempt_kinds: [] as string[] }, slices }
    const sliceDoc = { pacing: { policy: 'slice', budget: 3, exempt_kinds: [] as string[] }, slices }

    expect(resolvedUnits(waveDoc),  'wave policy: only wave 2 fully resolved').toBe(1)
    expect(resolvedUnits(sliceDoc), 'slice policy: s1 + s3 resolved').toBe(2)
  })

  it('each schema policy is exercised by a live code branch in resolvedUnits (defeat-device guard)', () => {
    // Fixture: wave 1 fully resolved (s1 + s2 complete), wave 2 incomplete (s3 pending).
    // SECURITY INTENT: if a policy is in the schema enum but NOT handled by an
    // explicit code branch in resolvedUnits (e.g. falls to an unrecognized-policy
    // guard returning 0), this test fails because 0 ≠ the expected non-zero count.
    // A source-text comment cannot satisfy this — the branch must be executable code.
    const slices = [
      { id: 's1', wave: 1, kind: 'impl', status: 'complete' },
      { id: 's2', wave: 1, kind: 'impl', status: 'complete' },
      { id: 's3', wave: 2, kind: 'impl', status: 'pending'  },
    ]
    // expectedByPolicy is itself a contract: adding a new policy to the schema enum
    // without adding it here causes expect(expected).toBeDefined() to fail → RED.
    const expectedByPolicy: Record<string, number> = {
      wave:      1,  // wave 1 fully resolved (s1 + s2 complete, s2→wave1 done)
      slice:     2,  // s1 + s2 each a unit, both complete
      milestone: 1,  // defers to wave-unit counting (S7 stub); same as 'wave'
    }
    for (const policy of schemaPolicies) {
      const expected = expectedByPolicy[policy]
      expect(expected,
        `Policy '${policy}' is in the schema enum but missing from expectedByPolicy — add it with the correct resolvedUnits count`,
      ).toBeDefined()
      const doc = { pacing: { policy, budget: 5, exempt_kinds: [] as string[] }, slices }
      const count = resolvedUnits(doc)
      expect(count,
        `resolvedUnits(policy='${policy}') returned ${count}, expected ${expected}. ` +
        `If '${policy}' lacks a live branch in resolvedUnits, the unrecognized-policy guard returns 0.`,
      ).toBe(expected)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SEAM 3: `kind` enum duplicated within run-ledger.schema.json
// ─────────────────────────────────────────────────────────────────────────────

describe('SEAM 3 — kind enum parity within run-ledger.schema.json', () => {
  const schema = JSON.parse(
    readFileSync(join(REPO, 'schemas/run-ledger.schema.json'), 'utf8'),
  ) as {
    $defs: { slice: { properties: { kind: { enum: string[] } } } }
    properties: { pacing: { properties: { exempt_kinds: { items: { enum: string[] } } } } }
  }

  const sliceKinds  = schema.$defs.slice.properties.kind.enum
  const exemptKinds = schema.properties.pacing.properties.exempt_kinds.items.enum

  it('slice kind enum is non-empty', () => {
    expect(sliceKinds.length).toBeGreaterThan(0)
  })

  it('exempt_kinds item enum is non-empty', () => {
    expect(exemptKinds.length).toBeGreaterThan(0)
  })

  it('every exempt kind is a valid slice kind — exempt_kinds ⊆ slice kinds', () => {
    // Logical invariant: you cannot exempt a kind that does not exist as a slice kind.
    // Adding a bogus value to exempt_kinds.items.enum without adding it to slice.kind.enum fails here.
    for (const kind of exemptKinds) {
      expect(sliceKinds,
        `exempt kind '${kind}' is not in $defs/slice.kind.enum — schema is inconsistent`,
      ).toContain(kind)
    }
  })

  it('both enums currently enumerate the same set (documents intended invariant)', () => {
    // At the time this test was written both enums carry identical values.
    // If they diverge intentionally, update this test with a comment explaining the policy.
    for (const kind of sliceKinds) {
      expect(exemptKinds,
        `slice kind '${kind}' is absent from exempt_kinds.items.enum — sets have diverged`,
      ).toContain(kind)
    }
    expect(sliceKinds.length).toBe(exemptKinds.length)
  })
})
