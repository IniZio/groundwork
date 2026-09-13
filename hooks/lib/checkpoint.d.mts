// Type declarations for checkpoint.mjs

/** Artifact kinds that can go stale and therefore require captured_build_hash. */
export declare const STALEABLE_ARTIFACT_KINDS: string[]
/** All known artifact kinds for milestone_artifacts validation. */
export declare const KNOWN_ARTIFACT_KINDS: string[]

/**
 * Fail-closed artifact freshness and declaration check (PACING-R-009).
 * - Unknown kind → rejected (fail-closed).
 * - screenshot/run_output without captured_build_hash → rejected (fail-closed).
 * - currentBuildHash null and artifact has captured_build_hash → stale.
 * - live_url without a captured companion (file, run_output, or screenshot) in the same milestone → rejected.
 * - live_url/file without captured_build_hash (but with companion) → passes hash check (existence-only).
 */
export declare function checkMilestoneArtifacts(
  doc: object,
  currentBuildHash?: string | null,
): { satisfied: boolean; staleArtifacts: string[]; reason?: string }
