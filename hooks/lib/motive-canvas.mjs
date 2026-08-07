/**
 * motive-canvas.mjs — Transforms a D-5 motive-graph document into JSON Canvas format.
 *
 * Pure function, no I/O, no side-effects.
 * Deterministic layout: stable output for stable input.
 *
 * @see https://jsoncanvas.org/spec/1.0/
 *
 * Public API:
 *   toJsonCanvas(d5doc) → { nodes: CanvasNode[], edges: CanvasEdge[] }
 *
 * D-5 input shape (schema_version 1):
 *   { schema_version, motive, nodes: Node[], edges: Edge[] }
 *
 * NodeType ∈ objective | decision | open-item | ticket | acceptance-criterion | slice | spec-requirement
 * EdgeKind ∈ anchors | resolved_by | graduated_to | blocked_by | covers_ac | slice_decision | spec_xref
 */

// ---------------------------------------------------------------------------
// Per-type color map (hex; exported so callers and tests can reference it)
// ---------------------------------------------------------------------------

/** Stable hex color per semantic node type for JSON Canvas `color` field. */
export const TYPE_COLORS = /** @type {Record<string, string>} */ ({
  'objective':            '#3B82F6',  // blue
  'decision':             '#F59E0B',  // amber
  'open-item':            '#EF4444',  // red
  'ticket':               '#22C55E',  // green
  'acceptance-criterion': '#A855F7',  // purple
  'slice':                '#06B6D4',  // cyan
  'spec-requirement':     '#EC4899',  // pink
})

// ---------------------------------------------------------------------------
// Layout constants (ported from groundwork-graph-pilot/src/lib/loadGraph.ts)
// ---------------------------------------------------------------------------

/**
 * Fixed column order; determines x-position of each node type.
 * Mirrors the pilot's COLUMN_ORDER exactly.
 */
const COLUMN_ORDER = /** @type {string[]} */ ([
  'objective',
  'decision',
  'open-item',
  'ticket',
  'acceptance-criterion',
  'slice',
  'spec-requirement',
])

/** Pixels between column left-edges. */
const COLUMN_WIDTH = 300
/** Pixels between row top-edges. */
const ROW_HEIGHT = 100
/** Left margin for the first column. */
const ORIGIN_X = 60
/** Top margin for the first row. */
const ORIGIN_Y = 60
/** Node width in pixels. */
const NODE_WIDTH = 260
/** Node height in pixels. */
const NODE_HEIGHT = 80

// ---------------------------------------------------------------------------
// Layout computation
// ---------------------------------------------------------------------------

/**
 * Group nodes into typed columns, then assign x/y by (colIndex, rowIndex).
 * Nodes with an unrecognised type land in an overflow column to the right.
 *
 * @param {Array<{ id: string; type: string }>} nodes
 * @returns {Map<string, { x: number; y: number }>}
 */
function computePositions(nodes) {
  /** @type {Map<string, string[]>} */
  const columnMap = new Map()
  for (const type of COLUMN_ORDER) {
    columnMap.set(type, [])
  }

  /** @type {string[]} */
  const overflowIds = []

  for (const node of nodes) {
    const col = columnMap.get(node.type)
    if (col !== undefined) {
      col.push(node.id)
    } else {
      overflowIds.push(node.id)
    }
  }

  /** @type {Map<string, { x: number; y: number }>} */
  const positions = new Map()

  COLUMN_ORDER.forEach((type, colIndex) => {
    const ids = columnMap.get(type) ?? []
    ids.forEach((id, rowIndex) => {
      positions.set(id, {
        x: ORIGIN_X + colIndex * COLUMN_WIDTH,
        y: ORIGIN_Y + rowIndex * ROW_HEIGHT,
      })
    })
  })

  // Overflow nodes land in a column to the right of all typed columns.
  const overflowColIndex = COLUMN_ORDER.length
  overflowIds.forEach((id, rowIndex) => {
    positions.set(id, {
      x: ORIGIN_X + overflowColIndex * COLUMN_WIDTH,
      y: ORIGIN_Y + rowIndex * ROW_HEIGHT,
    })
  })

  return positions
}

// ---------------------------------------------------------------------------
// Node text rendering
// ---------------------------------------------------------------------------

/**
 * Render a D-5 node's text content for the JSON Canvas `text` field.
 * Format: first line = "[type] label", subsequent lines = "key: value" pairs
 * from `detail` (null/false/empty-array values omitted).
 *
 * @param {{ type: string; label: string; detail?: unknown }} node
 * @returns {string}
 */
function renderNodeText(node) {
  const lines = [`[${node.type}] ${node.label}`]
  const d = node.detail
  if (d !== null && d !== undefined && typeof d === 'object' && !Array.isArray(d)) {
    for (const [k, v] of Object.entries(/** @type {object} */ (d))) {
      if (v === null || v === undefined || v === false) continue
      if (Array.isArray(v)) {
        if (v.length === 0) continue
        lines.push(`${k}: ${v.join(', ')}`)
      } else if (typeof v === 'object') {
        lines.push(`${k}: ${JSON.stringify(v)}`)
      } else {
        lines.push(`${k}: ${v}`)
      }
    }
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Transform a D-5 motive-graph document into a JSON Canvas document.
 *
 * Invariants preserved:
 *   - Every D-5 node maps to exactly one canvas node (parity).
 *   - Every D-5 edge maps to exactly one canvas edge.
 *   - No dangling edges (D-5 already guarantees both endpoints exist).
 *
 * @param {{
 *   schema_version: number;
 *   motive: string;
 *   nodes: Array<{ id: string; type: string; label: string; detail?: unknown }>;
 *   edges: Array<{ source: string; target: string; kind: string }>;
 * }} d5doc
 * @returns {{ nodes: object[]; edges: object[] }}
 */
export function toJsonCanvas(d5doc) {
  const positions = computePositions(d5doc.nodes)

  const nodes = d5doc.nodes.map((node) => {
    const pos = positions.get(node.id) ?? { x: 0, y: 0 }
    return {
      id: node.id,
      type: /** @type {'text'} */ ('text'),
      text: renderNodeText(node),
      x: pos.x,
      y: pos.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      color: TYPE_COLORS[node.type] ?? '#9CA3AF',
    }
  })

  const edges = d5doc.edges.map((edge) => ({
    id: `e:${edge.source}->${edge.target}:${edge.kind}`,
    fromNode: edge.source,
    toNode: edge.target,
    toEnd: /** @type {'arrow'} */ ('arrow'),
    label: edge.kind,
  }))

  return { nodes, edges }
}
