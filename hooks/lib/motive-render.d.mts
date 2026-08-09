// Type declarations for motive-render.mjs

export interface NarrativeSection {
  source: string
  [key: string]: unknown
}

export interface HumanLayer {
  title: string
  banner: string
  narrative_sections: NarrativeSection[]
  [key: string]: unknown
}

/**
 * Build the human-readable layer of a compiled motive view.
 * Returns the human layer object (banner, title, sections, etc.).
 */
export declare function buildHumanLayer(view: object): HumanLayer

/**
 * Render a compiled motive view as a Markdown string.
 * Builds the human layer if absent. Banner appears first.
 */
export declare function renderView(view: object): string
