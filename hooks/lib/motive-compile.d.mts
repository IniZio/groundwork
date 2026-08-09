// Type declarations for motive-compile.mjs

/** Semantic version string for the motive compiler. */
export declare const COMPILER_VERSION: string

export interface CompileProvenance {
  motive: string | null
  at_ord: number | null
  events_folded: number
  [key: string]: unknown
}

export interface AgentResumeView {
  next_actions: Array<{ action: string; slice: string; [key: string]: unknown }>
  [key: string]: unknown
}

/**
 * Typed shape of the agent subview returned by compile().
 * `resume` is non-optional: compile always produces it.
 * `last_pause` is absent when no PAUSE events exist.
 */
export interface AgentView {
  resume: AgentResumeView
  open_items?: Array<{ id?: string; graduated_to?: string; [key: string]: unknown }>
  last_pause?: { pointer: string; [key: string]: unknown }
  [key: string]: unknown
}

export interface CompileView {
  compiler_version: string
  agent: AgentView
  human: Record<string, unknown> | null
  provenance: CompileProvenance
  divergence?: unknown
  [key: string]: unknown
}

/**
 * Compile an ordered event stream into a structured motive view object.
 * Returns { compiler_version, agent, human, provenance, divergence }.
 *
 * @param events - Ordered journal events (e.g. from readOrderedEvents).
 * @param opts   - Optional compile options (charter, groundTruth, at, etc.).
 */
export declare function compile(events: unknown[], opts?: object): CompileView
