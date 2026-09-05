/**
 * Payload validators for journal append — shared by hooks/journal.mjs and src/gw.
 * Each validator receives `data ?? {}` and returns an error string or null.
 * Types absent from this map accept any payload (free-form).
 */
export const APPEND_PAYLOAD_VALIDATORS = new Map([
  ['DECISION', (d) => {
    if (!d.id) return 'DECISION event requires data.id'
    if (!d.decision) return 'DECISION event requires data.decision'
    if (!d.rationale) return 'DECISION event requires data.rationale'
    return null
  }],
  ['AC_RETRACTION', (d) => (d.ac == null || d.slice == null)
    ? 'AC_RETRACTION event requires data.ac and data.slice (payload contract: ' +
      '{ ac, slice, reason }). Coverage is retracted one (ac, slice) pair at a ' +
      'time; a payload without both fields is silently ignored by the coverage ' +
      'fold. Prefer: journal ac-retract --motive <slug> --ac <ac-id> ' +
      '--slice <slice-id> --reason <text>'
    : null],
  ['GRAPH_MUTATE', (d) => {
    const VALID_OPS = new Set(['node.assert', 'node.retire', 'edge.assert', 'edge.retire', 'attr.set'])
    return (!d.op || !VALID_OPS.has(d.op))
      ? `GRAPH_MUTATE event requires data.op; must be one of: ${[...VALID_OPS].join(', ')}`
      : null
  }],
  ['AC_COVERAGE', (d) => {
    // Accept any of the three documented forms (motive-compile.mjs:382–410):
    //   1. Single-AC:    { ac, slice }               — d.ac != null
    //   2. Array-covers: { slice, covers: [...] }    — Array.isArray(d.covers) && d.slice != null
    //   3. Declaration:  { ac, covering: [] }        — d.ac != null (slice absent)
    // A payload matching none of these is malformed and will be silently discarded by
    // the compile fold; reject at append time instead.
    const hasSingleAc = d.ac != null
    const hasArrayCovers = Array.isArray(d.covers) && d.slice != null
    return (!hasSingleAc && !hasArrayCovers)
      ? 'AC_COVERAGE event payload must match one of: ' +
        '{ ac, slice } (single-AC form), ' +
        '{ slice, covers: [...] } (array-covers form), or ' +
        '{ ac, covering: [] } (declaration form — slice absent)'
      : null
  }],
])
