/**
 * Tests for the shared estimateTokens function in hooks/lib/doc-io.mjs.
 *
 * Pins the unified implementation (bytes/3.5) and verifies it handles:
 * - ASCII text
 * - Non-ASCII text (where the old chars/4 formula diverged most)
 * - Empty string and null/undefined inputs
 */

import { describe, it, expect } from 'vitest'
import { estimateTokens } from '../../hooks/lib/doc-io.mjs'

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('returns 0 for null', () => {
    expect(estimateTokens(null as unknown as string)).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(estimateTokens(undefined as unknown as string)).toBe(0)
  })

  it('estimates ASCII text using bytes/3.5', () => {
    // "hello" = 5 ASCII bytes → ceil(5/3.5) = ceil(1.43) = 2
    expect(estimateTokens('hello')).toBe(2)
  })

  it('matches formula Math.ceil(byteLength / 3.5) for ASCII', () => {
    const text = 'The quick brown fox jumps over the lazy dog'
    const expected = Math.ceil(Buffer.byteLength(text, 'utf8') / 3.5)
    expect(estimateTokens(text)).toBe(expected)
  })

  it('uses byte length (not char length) for non-ASCII — CJK divergence', () => {
    // "你好世界" = 4 JS chars, 12 UTF-8 bytes
    // Old formula (chars/4): ceil(4/4) = 1
    // Correct formula (bytes/3.5): ceil(12/3.5) = ceil(3.43) = 4
    const cjk = '你好世界'
    expect(cjk.length).toBe(4)                   // 4 chars
    expect(Buffer.byteLength(cjk, 'utf8')).toBe(12) // 12 bytes
    expect(estimateTokens(cjk)).toBe(4)           // bytes/3.5, not chars/4
    // Demonstrate the old formula would have returned 1 (wrong)
    expect(Math.ceil(cjk.length / 4)).toBe(1)
  })

  it('handles emoji (multi-byte) correctly', () => {
    // "🎉" = 1 JS char (surrogate pair = 2 code units), 4 UTF-8 bytes
    // chars/4 formula: ceil(2/4) = 1  (or ceil(1/4) = 1 depending on how .length counts)
    // bytes/3.5: ceil(4/3.5) = ceil(1.14) = 2
    const emoji = '🎉'
    const byteLen = Buffer.byteLength(emoji, 'utf8')
    expect(byteLen).toBe(4)
    expect(estimateTokens(emoji)).toBe(Math.ceil(4 / 3.5))
  })

  it('rounds up (ceil) not down', () => {
    // 1 ASCII byte → ceil(1/3.5) = ceil(0.286) = 1, not 0
    expect(estimateTokens('a')).toBe(1)
  })
})
