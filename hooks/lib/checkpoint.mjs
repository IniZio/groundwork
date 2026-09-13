// check-comments-exempt — hook lib; phase-checkpoint artifact freshness helpers
/**
 * checkpoint.mjs — phase-checkpoint helpers for milestone artifact validation.
 *
 * Extracted from pacing.mjs (T1, motive phase-checkpoint-gate).
 * pacing.mjs re-exports these for backward compatibility; T6 deletes pacing.mjs.
 *
 * Pure functions over a ledger doc — no filesystem, no side-effects.
 */

export const STALEABLE_ARTIFACT_KINDS = ['screenshot', 'run_output']
export const KNOWN_ARTIFACT_KINDS = ['screenshot', 'run_output', 'live_url', 'file']

/** @param {object} doc @returns {object|null} */
function getPacing(doc) {
  return doc?.pacing ?? null
}

/**
 * Fail-closed artifact freshness and declaration check (PACING-R-009).
 *
 * Pure function — no filesystem I/O. File existence must be checked by the caller.
 *
 * Fail-closed semantics:
 *   - Artifact kind not in KNOWN_ARTIFACT_KINDS                          → REJECTED
 *   - Artifact kind in STALEABLE_ARTIFACT_KINDS + no captured_build_hash → REJECTED
 *   - Artifact declares captured_build_hash + currentBuildHash matches   → FRESH.
 *   - Artifact declares captured_build_hash + currentBuildHash differs   → STALE.
 *   - Artifact declares captured_build_hash + currentBuildHash is null   → STALE
 *   - Non-stale-able kind (live_url, file) with no captured_build_hash   → FRESH
 *
 * @param {object} doc - Ledger document.
 * @param {string|null} [currentBuildHash] - Current build hash for staleness comparison.
 * @returns {{ satisfied: boolean, staleArtifacts: string[], reason?: string }}
 */
export function checkMilestoneArtifacts(doc, currentBuildHash) {
  const pacing = getPacing(doc)
  if (!pacing) return { satisfied: true, staleArtifacts: [] }
  const artifacts = Array.isArray(pacing.milestone_artifacts) ? pacing.milestone_artifacts : []
  if (artifacts.length === 0) return { satisfied: true, staleArtifacts: [] }

  const stale = []
  let anyHashUnknown = false
  let anyMissingHash = false
  let anyUnknownKind = false

  for (const artifact of artifacts) {
    const kind = artifact.kind ?? ''
    const pathLabel = artifact.path ?? '(unknown)'

    if (!KNOWN_ARTIFACT_KINDS.includes(kind)) {
      stale.push(pathLabel)
      anyUnknownKind = true
      continue
    }

    if (STALEABLE_ARTIFACT_KINDS.includes(kind) && !artifact.captured_build_hash) {
      stale.push(pathLabel)
      anyMissingHash = true
      continue
    }

    if (artifact.captured_build_hash) {
      if (!currentBuildHash) {
        stale.push(pathLabel)
        anyHashUnknown = true
      } else if (artifact.captured_build_hash !== currentBuildHash) {
        stale.push(pathLabel)
      }
    }
  }

  const CAPTURED_KINDS = ['file', 'run_output', 'screenshot']
  const hasLiveUrl = artifacts.some(a => a.kind === 'live_url')
  const hasCapturedCompanion = artifacts.some(a => CAPTURED_KINDS.includes(a.kind ?? ''))
  let anyLiveUrlAlone = false
  if (hasLiveUrl && !hasCapturedCompanion) {
    for (const artifact of artifacts) {
      if (artifact.kind === 'live_url') stale.push(artifact.path ?? '(unknown)')
    }
    anyLiveUrlAlone = true
  }

  const reason = stale.length > 0
    ? anyLiveUrlAlone
      ? `live_url artifact requires a captured companion (file, run_output, or screenshot) in the same milestone — a URL alone is not a capture`
      : anyUnknownKind
        ? `Artifact with unknown kind rejected (fail-closed — must be one of: ${KNOWN_ARTIFACT_KINDS.join(', ')}): ${stale.join(', ')}`
        : anyMissingHash
          ? `screenshot and run_output artifacts require captured_build_hash — omitting the field is rejected (fail-closed): ${stale.join(', ')}`
          : anyHashUnknown
            ? `Stale artifacts (cannot verify freshness — no current build hash supplied; pass --build-hash to ledger claim): ${stale.join(', ')}`
            : `Stale artifacts (build hash mismatch — artifact captured before the current build): ${stale.join(', ')}`
    : undefined

  return {
    satisfied: stale.length === 0,
    staleArtifacts: stale,
    ...(reason != null ? { reason } : {}),
  }
}
