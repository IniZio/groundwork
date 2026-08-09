// Type declarations for motive-ground-truth.mjs

export interface LedgerSlice {
  id: string
  status: string
  wave?: number
  desc?: string
  blocked_by?: string[]
  acceptance?: string[]
  kind?: string
  [key: string]: unknown
}

export interface LedgerGate {
  advisor?: { verdict?: string; citation?: string; rubric?: string; [key: string]: unknown }
  [key: string]: unknown
}

export interface LedgerInfo {
  found: boolean
  path?: string
  active?: boolean
  slices: LedgerSlice[]
  gate: LedgerGate
  session_id?: string
  session_ids?: string[]
}

export interface GroundTruth {
  collected_at: string
  head_sha: string | null
  branch: string
  dirty_paths: string[]
  existing_paths: Record<string, boolean>
  ledger: LedgerInfo
  session_completed_ids: string[]
  not_checkable: { reason: string; [key: string]: unknown }
  [key: string]: unknown
}

/**
 * Collect ground-truth context for a motive: git state, session IDs, and
 * completed slice IDs from the run ledger.
 *
 * @param opts.projectDir  - Absolute path to the project root.
 * @param opts.events      - Pre-loaded ordered events (default: []).
 * @param opts.motive      - Motive slug to filter events (default: null).
 * @param opts.ledgerPath  - Explicit ledger path override (default: null).
 * @returns                The collected ground-truth object.
 */
export declare function collectGroundTruth(opts: {
  projectDir: string
  events?: object[]
  motive?: string | null
  ledgerPath?: string | null
}): Promise<GroundTruth>
