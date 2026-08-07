// Type declarations for motive-canvas.mjs

/** Stable hex color per semantic node type. */
export declare const TYPE_COLORS: Record<string, string>

export interface JsonCanvasNode {
  id: string
  type: 'text'
  text: string
  x: number
  y: number
  width: number
  height: number
  color: string
}

export interface JsonCanvasEdge {
  id: string
  fromNode: string
  toNode: string
  toEnd: 'arrow'
  label: string
}

export interface JsonCanvasDocument {
  nodes: JsonCanvasNode[]
  edges: JsonCanvasEdge[]
}

export interface D5Node {
  id: string
  type: string
  label: string
  detail?: unknown
}

export interface D5Edge {
  source: string
  target: string
  kind: string
}

export interface D5Document {
  schema_version: number
  motive: string
  nodes: D5Node[]
  edges: D5Edge[]
}

/** Transform a D-5 motive-graph document into a JSON Canvas document. */
export declare function toJsonCanvas(d5doc: D5Document): JsonCanvasDocument
