/**
 * Parity test: hooks/ledger.mjs parseFlags vs. the established sibling shape.
 *
 * The reference implementation below is copied verbatim from hooks/journal.mjs
 * (the majority sibling). If ledger's parseFlags drifts from this shape again,
 * the parity assertions catch it. If the sibling itself changes shape, update
 * this reference and ledger together.
 */
import { describe, it, expect } from 'vitest'
import { parseFlags } from '../hooks/ledger.mjs'

// ---------------------------------------------------------------------------
// Reference implementation — verbatim from hooks/journal.mjs parseFlags
// ---------------------------------------------------------------------------
function referenceParseFlagsFromJournal(args) {
  const flags = {}
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next
        i++
      } else {
        flags[key] = true
      }
    } else {
      positionals.push(a)
    }
  }
  return { flags, positionals }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function both(args) {
  return {
    ledger: parseFlags(args),
    reference: referenceParseFlagsFromJournal(args),
  }
}

// ---------------------------------------------------------------------------
// Behaviour cases (also checked for parity)
// ---------------------------------------------------------------------------
describe('ledger parseFlags — behaviour', () => {
  it('--flag value: consumes next token as value', () => {
    const { flags, positionals } = parseFlags(['--motive', 'my-slug'])
    expect(flags).toEqual({ motive: 'my-slug' })
    expect(positionals).toEqual([])
  })

  it('bare --flag at end of argv: becomes boolean true', () => {
    const { flags, positionals } = parseFlags(['--force'])
    expect(flags).toEqual({ force: true })
    expect(positionals).toEqual([])
  })

  it('bare --flag followed by another --flag: both become boolean true', () => {
    const { flags } = parseFlags(['--verbose', '--strict'])
    expect(flags).toEqual({ verbose: true, strict: true })
  })

  it('--flag non-dash-token: consumes token as value (sibling behaviour)', () => {
    // `--force some-id` → force='some-id'; value intent takes precedence over boolean intent
    const { flags, positionals } = parseFlags(['--force', 'some-id'])
    expect(flags).toEqual({ force: 'some-id' })
    expect(positionals).toEqual([])
  })

  it('mixed: --key value, bare --flag (before --other), positionals', () => {
    // The core defect: old code set force='id1', losing id1 from positionals.
    // Now --force followed by 'id1' (no --) consumes 'id1' as value; 'id2' is a positional.
    const { flags, positionals } = parseFlags(['complete', '--motive', 'slug', '--force', 'id1', 'id2'])
    expect(flags).toEqual({ motive: 'slug', force: 'id1' })
    expect(positionals).toEqual(['complete', 'id2'])
  })
})

// ---------------------------------------------------------------------------
// Parity: ledger.mjs must produce identical output to journal.mjs reference
// ---------------------------------------------------------------------------
describe('ledger parseFlags — parity with journal.mjs sibling', () => {
  const cases = [
    { label: '--flag value', argv: ['--motive', 'my-slug'] },
    { label: 'bare --flag at end', argv: ['--force'] },
    { label: 'bare --flag then --other', argv: ['--verbose', '--strict'] },
    { label: '--flag non-dash-token (value consumed)', argv: ['--force', 'some-id'] },
    { label: 'mixed: --flag then non-dash positionals', argv: ['complete', '--motive', 'slug', '--force', 'id1'] },
  ]

  for (const { label, argv } of cases) {
    it(`identical output for: ${label}`, () => {
      const { ledger, reference } = both(argv)
      expect(ledger).toEqual(reference)
    })
  }
})
