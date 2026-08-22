// Type declarations for pacing.mjs

export interface PacingGrant {
  range: number
  granted_at: string
  granted_by: string
  reason?: string
}

export interface Pacing {
  policy: string
  budget: number
  exempt_kinds: string[]
  grant?: PacingGrant
}

export declare function resolveUnit(doc: object, sliceId: string): number | string | null

export declare function resolvedUnits(doc: object): number

export declare function inFlightUnit(doc: object): number | string | null

export declare function isExhausted(doc: object): boolean

export declare function checkPace(
  doc: object,
  sliceId: string,
  currentBuildHash?: string | null,
): { allowed: boolean; reason?: string; remedy?: string }

/**
 * Fail-closed artifact freshness check (PACING-R-009).
 * When currentBuildHash is null and any artifact declares a captured_build_hash,
 * that artifact is classified stale — supply --build-hash to ledger claim.
 */
export declare function checkMilestoneArtifacts(
  doc: object,
  currentBuildHash?: string | null,
): { satisfied: boolean; staleArtifacts: string[]; reason?: string }
