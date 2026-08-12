// Type declarations for traceability-adapter.mjs

/** A ledger slice record returned by NativeSpineAdapter.getSlices(). */
export interface SliceRecord {
  id: string
  status: string
  blocked_by: string[]
  covers_ac: string[]
  decisions: string[]
  test_paths: string[]
  ticket?: string
  desc?: string
}

/** A VERIFICATION journal event returned by NativeSpineAdapter.getVerificationEvents(). */
export interface VerificationEvent {
  claim: string | null
  evidence: string | null
  result: string | null
  ord: number
  linkId?: string | null
}

/** A GATE journal event returned by NativeSpineAdapter.getGateEvents(). */
export interface GateEvent {
  which: string
  verdict: string
  citation?: string | null
  rubric?: string | null
  linkId?: string | null
}

/** A spec requirement record returned by NativeSpineAdapter.getSpecRequirements(). */
export interface SpecReqRecord {
  id: string
  title: string
  verification: string | null
  criticality: string | null
  origin_decision_ref: string | null
}

/** Coverage map keyed by requirement id (from coverage.json by_requirement). */
export type CoverageMap = Record<string, { declared: string | null; verified: boolean; tests: string[] }>

/**
 * NativeSpineAdapter — reads from the groundwork native data sources (ledger,
 * journal, doc/specs) and exposes a read-only SpineAdapter interface.
 */
export declare class NativeSpineAdapter {
  constructor(opts: { projectDir: string; slug: string })

  /** Motive objective string (from motive.md). */
  getObjective(): string

  /** Motive slug. */
  getMotive(): string

  /** All ledger slices for this motive. */
  getSlices(): SliceRecord[]

  /** VERIFICATION journal events for this motive. */
  getVerificationEvents(): VerificationEvent[]

  /** GATE journal events for this motive. */
  getGateEvents(): GateEvent[]

  /** All spec-requirement nodes parsed from doc/specs. */
  getSpecRequirements(): SpecReqRecord[]

  /** coverage.json by_requirement map. */
  getCoverageMap(): CoverageMap
}
