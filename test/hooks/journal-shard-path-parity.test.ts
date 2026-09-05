/**
 * Parity test: resolveShardPath in src/gw/lib/journal-emit.ts must produce
 * the same path as resolveShardPath in hooks/lib/journal-io.mjs.
 *
 * Guards against the green-slices-broken-seam failure mode where the two
 * formula implementations silently diverge.
 */
import { describe, expect, it } from 'vitest'

import { resolveShardPath } from '../../src/gw/lib/journal-emit.js'
import { resolveShardPath as resolveShardPathIO } from '../../hooks/lib/journal-io.mjs'

// Get today's date the same way both implementations do internally.
// Passing this explicitly to the journal-io.mjs side avoids a midnight race
// between the two new Date() calls.
const today = new Date().toISOString().slice(0, 10)

describe('journal shard-path parity (journal-emit.ts ↔ journal-io.mjs)', () => {
  it('valid sessionId is used verbatim in both implementations', () => {
    const sessionId = 'sess-abc-123'
    expect(resolveShardPath('/proj', sessionId)).toBe(
      resolveShardPathIO('/proj', sessionId, today),
    )
  })

  it('invalid sessionId (contains slash) falls back to "default" in both', () => {
    const sessionId = 'bad/id'
    expect(resolveShardPath('/proj', sessionId)).toBe(
      resolveShardPathIO('/proj', sessionId, today),
    )
    expect(resolveShardPath('/proj', sessionId)).toContain('default')
  })

  it('empty string falls back to "default" in both', () => {
    const sessionId = ''
    expect(resolveShardPath('/proj', sessionId)).toBe(
      resolveShardPathIO('/proj', sessionId, today),
    )
    expect(resolveShardPath('/proj', sessionId)).toContain('default')
  })

  it('maximum valid length (128 chars) is used verbatim in both', () => {
    const sessionId = 'a'.repeat(128)
    expect(resolveShardPath('/proj', sessionId)).toBe(
      resolveShardPathIO('/proj', sessionId, today),
    )
    expect(resolveShardPath('/proj', sessionId)).toContain(sessionId)
  })

  it('one-over-max (129 chars) falls back to "default" in both', () => {
    const sessionId = 'a'.repeat(129)
    expect(resolveShardPath('/proj', sessionId)).toBe(
      resolveShardPathIO('/proj', sessionId, today),
    )
    expect(resolveShardPath('/proj', sessionId)).toContain('default')
  })

  it('uppercase sessionId is used verbatim in both (both regexes include uppercase)', () => {
    const sessionId = 'Session-ABC'
    expect(resolveShardPath('/proj', sessionId)).toBe(
      resolveShardPathIO('/proj', sessionId, today),
    )
    expect(resolveShardPath('/proj', sessionId)).toContain(sessionId)
  })
})
