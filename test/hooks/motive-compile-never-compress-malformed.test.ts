/**
 * NEVER_COMPRESS malformed event surfacing
 *
 * Verifies that when the fold encounters a NEVER_COMPRESS event whose payload
 * is unusable, the fact is recorded in provenance.malformed_never_compress_events
 * rather than silently discarded, AND that a named list is produced so the
 * discard is actionable (type + shard + ts + reason per dropped event).
 *
 * Acceptance criteria:
 *   NC-1  — malformed AC_RETRACTION (missing slice) increments the counter
 *   NC-2  — malformed AC_COVERAGE (no ac, no covers) increments the counter
 *   NC-3  — well-formed AC_RETRACTION folds correctly and produces zero warnings
 *            (positive control: ensures the check cannot degenerate to
 *             "warn on everything")
 *   NC-1b — malformed AC_RETRACTION is NAMED in the event list (type, shard, ts, reason)
 *   NC-2b — malformed AC_COVERAGE is NAMED in the event list
 *   NC-3b — well-formed AC_RETRACTION produces an EMPTY event list (positive control)
 *   NC-4  — declaration-form AC_COVERAGE ({ ac, covering: [] }, slice absent) is NOT
 *            named and does NOT increment the counter (third-form positive control)
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest'
import { compile } from '../../hooks/lib/motive-compile.mjs'

/** Build a minimal event list with synthetic _order provenance. */
function mkEvents(...defs: any[]) {
  return defs.map((d, i) => ({ ...d, ts: '2026-01-01T00:00:00Z', _order: { shard: 'test.jsonl', line: i } }))
}

describe('NEVER_COMPRESS malformed event surfacing', () => {
  it('NC-1: malformed AC_RETRACTION (missing slice) increments malformed_never_compress_events', () => {
    const evts = mkEvents(
      { type: 'AC_COVERAGE', session: 's1', data: { ac: 'AC-1', slice: 'S1' } },
      // malformed: slice is absent → guard (d.ac != null && d.slice != null) fails
      { type: 'AC_RETRACTION', session: 's1', data: { ac: 'AC-1' } },
    )
    const result = compile(evts)
    expect(result.provenance.malformed_never_compress_events).toBeGreaterThan(0)
  })

  it('NC-2: malformed AC_COVERAGE (no ac, no covers) increments malformed_never_compress_events', () => {
    const evts = mkEvents(
      // malformed: neither d.ac nor d.covers present → neither form applies
      { type: 'AC_COVERAGE', session: 's1', data: {} },
    )
    const result = compile(evts)
    expect(result.provenance.malformed_never_compress_events).toBeGreaterThan(0)
  })

  it('NC-3 (positive control): well-formed AC_RETRACTION folds correctly, zero warnings', () => {
    const evts = mkEvents(
      { type: 'AC_COVERAGE', session: 's1', data: { ac: 'AC-1', slice: 'S1' } },
      // well-formed retraction: both ac and slice present
      { type: 'AC_RETRACTION', session: 's1', data: { ac: 'AC-1', slice: 'S1' } },
    )
    const result = compile(evts)
    // No malformed events — positive control ensures check is not vacuously "warn on all"
    expect(result.provenance.malformed_never_compress_events).toBe(0)
    // Retraction was applied: AC-1 appears in unmet (covering set emptied)
    const ac1 = result.agent.ac_coverage.unmet.find((e: any) => e.id === 'AC-1')
    expect(ac1).toBeDefined()
    expect(ac1.covering).toEqual([])
    expect(ac1.met).toBe(false)
  })

  it('NC-1b: malformed AC_RETRACTION is named in event list (type, shard, ts, reason)', () => {
    const evts = mkEvents(
      { type: 'AC_COVERAGE', session: 's1', data: { ac: 'AC-1', slice: 'S1' } },
      { type: 'AC_RETRACTION', session: 's1', data: { ac: 'AC-1' } },
    )
    const result = compile(evts)
    const list = result.provenance.malformed_never_compress_event_list
    expect(list).toBeDefined()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('AC_RETRACTION')
    expect(list[0].shard).toBe('test.jsonl')
    expect(list[0].ts).toBe('2026-01-01T00:00:00Z')
    expect(list[0].reason).toBeTruthy()
  })

  it('NC-2b: malformed AC_COVERAGE is named in event list (type, shard, ts, reason)', () => {
    const evts = mkEvents(
      { type: 'AC_COVERAGE', session: 's1', data: {} },
    )
    const result = compile(evts)
    const list = result.provenance.malformed_never_compress_event_list
    expect(list).toBeDefined()
    expect(list).toHaveLength(1)
    expect(list[0].type).toBe('AC_COVERAGE')
    expect(list[0].shard).toBe('test.jsonl')
    expect(list[0].ts).toBe('2026-01-01T00:00:00Z')
    expect(list[0].reason).toBeTruthy()
  })

  it('NC-3b (positive control): well-formed AC_RETRACTION produces empty event list', () => {
    const evts = mkEvents(
      { type: 'AC_COVERAGE', session: 's1', data: { ac: 'AC-1', slice: 'S1' } },
      { type: 'AC_RETRACTION', session: 's1', data: { ac: 'AC-1', slice: 'S1' } },
    )
    const result = compile(evts)
    const list = result.provenance.malformed_never_compress_event_list
    expect(list).toBeDefined()
    expect(list).toHaveLength(0)
  })

  it('NC-4 (positive control): declaration-form AC_COVERAGE is NOT named, count stays 0', () => {
    // Declaration form: { ac, covering: [] } — slice absent/null
    // This is a legitimate form (AC declared with no covering slices yet).
    // It must NOT appear in the malformed list.
    const evts = mkEvents(
      { type: 'AC_COVERAGE', session: 's1', data: { ac: 'AC-1', covering: [] } },
    )
    const result = compile(evts)
    const list = result.provenance.malformed_never_compress_event_list
    expect(list).toBeDefined()
    expect(list).toHaveLength(0)
    expect(result.provenance.malformed_never_compress_events).toBe(0)
  })
})
