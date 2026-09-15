// @verifies ARTIFACT-R-008
/**
 * Tests for hooks/lib/motive-tickets.mjs
 *
 * Covers:
 *   - sanitizeId: valid ids, path-traversal guard
 */

import { describe, it, expect } from 'vitest'
import { sanitizeId } from '../../hooks/lib/motive-tickets.mjs'

describe('sanitizeId', () => {
  it('lowercases and preserves valid kebab ids', () => {
    expect(sanitizeId('map-autogen')).toBe('map-autogen')
    expect(sanitizeId('TBD-1')).toBe('tbd-1')
    expect(sanitizeId('S-ANCHOR')).toBe('s-anchor')
  })

  it('replaces invalid characters with hyphens', () => {
    expect(sanitizeId('foo bar')).toBe('foo-bar')
    expect(sanitizeId('foo:bar')).toBe('foo-bar')
  })

  it('collapses multiple hyphens', () => {
    expect(sanitizeId('foo--bar')).toBe('foo-bar')
    expect(sanitizeId('S1::io')).toBe('s1-io')
  })

  it('returns null for path-traversal ids', () => {
    expect(sanitizeId('../etc/passwd')).toBeNull()
    expect(sanitizeId('foo/bar')).toBeNull()
  })

  it('returns null for empty or non-string input', () => {
    expect(sanitizeId('')).toBeNull()
    expect(sanitizeId(null as unknown as string)).toBeNull()
    expect(sanitizeId(undefined as unknown as string)).toBeNull()
  })

  it('TBD-1 and TBD.1 produce the same stem (collision scenario)', () => {
    expect(sanitizeId('TBD-1')).toBe('tbd-1')
    expect(sanitizeId('TBD.1')).toBe('tbd-1')
  })
})
