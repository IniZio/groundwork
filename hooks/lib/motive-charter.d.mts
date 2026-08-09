// Type declarations for motive-charter.mjs

export interface CharterOpenItem {
  id: string
  kind: 'TBD' | 'TBR'
  statement: string
  body?: string
  owner?: string
  blocked_by?: string
  graduated_to?: string
  [key: string]: unknown
}

export interface CharterAcceptanceCriterionItem {
  id: string
  statement: string
  [key: string]: unknown
}

export interface CharterDecisionItem {
  id: string
  text: string
  [key: string]: unknown
}

export interface Charter {
  objective: string
  open_items: CharterOpenItem[]
  notes: string
  out_of_scope: string
  path: string
  decisions: CharterDecisionItem[]
  acceptance_criteria: CharterAcceptanceCriterionItem[]
}

/**
 * Return the absolute path to the charter file for a motive.
 * Pure — does not touch the filesystem.
 */
export declare function charterPath(projectDir: string, motive: string): string

/**
 * Return the initial charter Markdown source. Pure.
 */
export declare function renderCharterTemplate(opts: { motive: string; objective: string }): string

/**
 * Read and parse the charter file for a motive.
 * Returns null (never throws) when the file is missing, unreadable, or malformed.
 */
export declare function readCharter(opts: { projectDir: string; motive: string }): Charter | null
