/**
 * Groundwork session-pacing policy engine.
 *
 * Pure functions over a ledger doc — no filesystem, no side-effects.
 * Consumers: hooks/ledger.mjs (claim/set enforcement) and
 * hooks/stop-gate.mjs (exhaustion release path).
 *
 * Design: D-28 / D-29 in motive groundwork-development.
 *
 * Terminology
 * -----------
 * UNIT   — policy=wave  → the wave number (integer)
 *          policy=slice → the slice id (string)
 * EXEMPT — slice whose `kind` appears in pacing.exempt_kinds; never
 *          counted toward resolution or budget.
 * RESOLVED UNIT — every non-exempt slice in the unit is complete.
 * IN-FLIGHT UNIT — the lowest-numbered unit that contains at least one
 *                  non-exempt incomplete slice.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the pacing config from a ledger doc, or null if absent.
 * When null, all enforcement is disabled (back-compat with pre-pacing runs).
 *
 * @param {object} doc - Raw ledger document.
 * @returns {{ policy: string, budget: number, exempt_kinds: string[], grant?: object }|null}
 */
function getPacing(doc) {
  return doc?.pacing ?? null
}

/**
 * Return the slice array from a ledger doc (empty array if absent).
 *
 * @param {object} doc - Raw ledger document.
 * @returns {Array<object>}
 */
function getSlices(doc) {
  return Array.isArray(doc?.slices) ? doc.slices : []
}

/**
 * True when the slice kind is in the exempt list.
 *
 * @param {object} slice
 * @param {string[]} exemptKinds
 * @returns {boolean}
 */
function isExemptSlice(slice, exemptKinds) {
  return exemptKinds.includes(slice.kind ?? '')
}

// ---------------------------------------------------------------------------
// Artifact kind classification for milestone freshness enforcement.
// Stale-able kinds MUST carry captured_build_hash — omitting the field is
// treated as a required-field violation and rejected (fail-closed).
// Non-stale-able kinds: `file` artifacts are verified for local-file existence
// at sign-off time (ledger.mjs); `live_url` artifacts require a captured companion
// (`file`, `run_output`, or `screenshot`) — no reachability probe is performed.
// Hash tracking is optional for both kinds.
// ---------------------------------------------------------------------------
export const STALEABLE_ARTIFACT_KINDS = ['screenshot', 'run_output']
export const KNOWN_ARTIFACT_KINDS = ['screenshot', 'run_output', 'live_url', 'file']

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Resolve the unit identifier a slice belongs to.
 *
 * policy=wave  → the slice's wave number (integer).
 * policy=slice → the slice's own id (string).
 *
 * @param {object} doc      - Ledger document.
 * @param {string} sliceId  - Slice id to look up.
 * @returns {number|string|null}  Unit identifier, or null if slice not found.
 */
export function resolveUnit(doc, sliceId) {
  const pacing = getPacing(doc)
  if (!pacing) return null

  const slice = getSlices(doc).find((s) => s.id === sliceId)
  if (!slice) return null

  return pacing.policy === 'slice' ? slice.id : (slice.wave ?? 0)
}

/**
 * Count how many units are fully resolved (all non-exempt slices complete).
 *
 * @param {object} doc - Ledger document.
 * @returns {number}
 */
export function resolvedUnits(doc) {
  const pacing = getPacing(doc)
  if (!pacing) return 0

  const slices = getSlices(doc)
  const { exempt_kinds: exemptKinds = [], policy, offset = 0 } = pacing

  let raw
  if (policy === 'slice') {
    // Each non-exempt slice is its own unit; count slices that are complete.
    raw = slices.filter(
      (s) => !isExemptSlice(s, exemptKinds) && s.status === 'complete',
    ).length
  } else if (policy === 'wave' || policy === 'milestone') {
    // policy=wave: count fully-resolved waves.
    // policy=milestone: unit count = resolved waves (same computation as wave).
    // The milestone gate's human sign-off check lives in checkPace — when the
    // budget is consumed, checkPace requires pacing.milestone_signoff.verdict=APPROVE
    // before allowing a new unit.  resolvedUnits is policy-neutral for wave/milestone.
    /** @type {Map<number, { total: number, complete: number }>} */
    const waves = new Map()
    for (const s of slices) {
      if (isExemptSlice(s, exemptKinds)) continue
      const w = s.wave ?? 0
      const entry = waves.get(w) ?? { total: 0, complete: 0 }
      entry.total++
      if (s.status === 'complete') entry.complete++
      waves.set(w, entry)
    }

    raw = 0
    for (const { total, complete } of waves.values()) {
      if (total > 0 && complete === total) raw++
    }
  } else {
    // Unrecognized policy — fail-safe: treat as 0 units resolved so enforcement
    // does not block on unknown future policies.
    raw = 0
  }

  // Subtract the adoption offset so completions carried in from a prior-session
  // seed JSON don't count against the current session's budget (F14 fix).
  return Math.max(0, raw - offset)
}

/**
 * Return the in-flight unit: the lowest-numbered unit holding any non-exempt
 * incomplete slice (pending or in_progress).  Returns null when there is no
 * such unit.
 *
 * Both `pending` and `in_progress` slices are considered — the consumer
 * (session-reminder's "in-flight unit" display) wants all incomplete work,
 * not only slices that have been actively claimed.
 * Enforcement lives in checkPace.
 *
 * For policy=wave  the return value is a wave number (integer).
 * For policy=slice the return value is a slice id (string).
 *
 * @param {object} doc - Ledger document.
 * @returns {number|string|null}
 */
export function inFlightUnit(doc) {
  const pacing = getPacing(doc)
  if (!pacing) return null

  const slices = getSlices(doc)
  const { exempt_kinds: exemptKinds = [], policy } = pacing

  const incomplete = slices.filter(
    (s) => !isExemptSlice(s, exemptKinds) && s.status !== 'complete',
  )
  if (incomplete.length === 0) return null

  if (policy === 'slice') {
    // Units are individual slices; return the id of whichever appears first in
    // the slices array (preserving declaration order).
    return incomplete[0].id
  }

  // policy === 'wave' — find the lowest wave number.
  let minWave = Infinity
  for (const s of incomplete) {
    const w = s.wave ?? 0
    if (w < minWave) minWave = w
  }
  return minWave === Infinity ? null : minWave
}

/**
 * Return the unit identifier of the unit that has been ENTERED this session —
 * i.e. the lowest-numbered unit holding at least one non-exempt `in_progress`
 * slice.  Returns null when no unit is actively being worked on.
 *
 * This is used by checkPace to decide whether a claim is "into the in-flight
 * unit" (always free) vs "opening a new unit" (budget-gated).
 *
 * @param {object} doc
 * @returns {number|string|null}
 */
function activeUnit(doc) {
  const pacing = getPacing(doc)
  if (!pacing) return null

  const slices = getSlices(doc)
  const { exempt_kinds: exemptKinds = [], policy } = pacing

  const active = slices.filter(
    (s) => !isExemptSlice(s, exemptKinds) && s.status === 'in_progress',
  )
  if (active.length === 0) return null

  if (policy === 'slice') {
    return active[0].id
  }

  let minWave = Infinity
  for (const s of active) {
    const w = s.wave ?? 0
    if (w < minWave) minWave = w
  }
  return minWave === Infinity ? null : minWave
}

/**
 * True when pacing is enabled and the session can no longer claim any new unit
 * — i.e. resolved_units >= budget + grant.range and no unit is currently
 * in-flight.
 *
 * NOTE: when an in-flight unit exists the session is NOT exhausted — it still
 * has work it is allowed to do.
 *
 * @param {object} doc - Ledger document.
 * @returns {boolean}
 */
export function isExhausted(doc) {
  const pacing = getPacing(doc)
  if (!pacing) return false

  // If a unit is actively being worked on, the session is not exhausted.
  if (activeUnit(doc) !== null) return false

  const { budget = 1, grant } = pacing
  const grantRange = grant?.range ?? 0
  const cap = budget + grantRange

  // Exhausted = resolved units already consumed all of the cap AND there are
  // still non-exempt incomplete slices that would need a new unit.
  const slices = getSlices(doc)
  const { exempt_kinds: exemptKinds = [] } = pacing
  const hasRemainingWork = slices.some(
    (s) => !isExemptSlice(s, exemptKinds) && s.status !== 'complete',
  )

  return hasRemainingWork && resolvedUnits(doc) >= cap
}

/**
 * Decide whether claiming/starting sliceId is allowed under the current pacing
 * policy.
 *
 * Returns `{ allowed: true }` when:
 *   - pacing is absent (back-compat),
 *   - sliceId is exempt,
 *   - sliceId belongs to the entered (active) unit — the lowest-numbered unit holding a non-exempt `in_progress` slice,
 *   - sliceId belongs to a new unit but resolved_units < budget + grant.range.
 *
 * Returns `{ allowed: false, reason: string, remedy: string }` when the slice
 * would open a new unit and the budget (plus any grant) is already consumed.
 *
 * For policy=milestone, an APPROVE sign-off releases the gate ONLY when artifact
 * freshness also holds: every declared artifact whose captured_build_hash differs
 * from currentBuildHash is treated as stale, and the gate remains closed until
 * artifacts are re-captured.  When currentBuildHash is omitted/null AND any artifact
 * declares a captured_build_hash, those artifacts are treated as unverifiable and
 * classified stale (fail-closed — supply --build-hash to ledger claim).  When no
 * artifact declares a captured_build_hash, the hash check is a no-op.
 *
 * @param {object} doc               - Ledger document.
 * @param {string} sliceId           - Slice being claimed or set in-progress.
 * @param {string|null} [currentBuildHash] - Current build hash for artifact-freshness
 *   check (milestone policy only).  Pure — no I/O; the caller supplies this value.
 * @returns {{ allowed: boolean, reason?: string, remedy?: string }}
 */
export function checkPace(doc, sliceId, currentBuildHash) {
  const pacing = getPacing(doc)
  // No pacing config → everything is allowed (pre-pacing back-compat).
  if (!pacing) return { allowed: true }

  const slices = getSlices(doc)
  const slice = slices.find((s) => s.id === sliceId)
  // Unknown slice → allow (not our concern; ledger will handle it).
  if (!slice) return { allowed: true }

  const { exempt_kinds: exemptKinds = [], budget = 1, grant, policy } = pacing

  // Exempt slices are always allowed.
  if (isExemptSlice(slice, exemptKinds)) return { allowed: true }

  const targetUnit = resolveUnit(doc, sliceId)
  // The "active unit" is the unit that has been ENTERED (has ≥1 in_progress
  // slice).  Claiming into the active unit is always free — this preserves
  // unlimited intra-wave subagent fan-out.
  const currentActive = activeUnit(doc)

  if (currentActive !== null && targetUnit === currentActive) {
    return { allowed: true }
  }

  // When there is no in-flight unit, check whether this slice's unit is new.
  // (If the slice is already complete it wouldn't reach here, but be defensive.)
  const grantRange = grant?.range ?? 0
  const cap = budget + grantRange
  const consumed = resolvedUnits(doc)

  if (consumed < cap) {
    // Budget remains — opening a new unit is fine.
    return { allowed: true }
  }

  // Budget exhausted — for milestone policy, check human sign-off before blocking.
  if (policy === 'milestone') {
    const signoff = pacing.milestone_signoff
    if (signoff?.verdict === 'APPROVE') {
      // BOTH conditions must hold (PACING-R-007):
      // (b) sign-off APPROVE is present — check passed.
      // (a) all declared artifacts must be FRESH — check now.
      const artCheck = checkMilestoneArtifacts(doc, currentBuildHash ?? null)
      if (!artCheck.satisfied) {
        // Sign-off recorded but artifacts became stale after a rebuild.
        // DESIGN: hold the gate rather than invalidate the sign-off — the human's
        // decision was correct at sign-off time; the build changed afterward.
        // Remedy: re-capture artifacts against the current build, then re-sign.
        // The original sign-off is preserved in the ledger for audit.
        const hashContext = currentBuildHash
          ? `(build hash changed since sign-off)`
          : `(no current build hash supplied — pass --build-hash <hash> to ledger claim)`
        const staleReason =
          `Milestone gate: APPROVE sign-off is present but artifacts cannot be verified as fresh ` +
          `${hashContext}.\n` +
          `${artCheck.reason}\n` +
          `Re-capture these artifacts against the current build, then record a fresh sign-off.`
        const staleRemedy =
          `1. Re-capture the stale artifacts (current build hash: ${currentBuildHash ?? 'unknown'}).\n` +
          `2. ledger milestone-signoff --verdict APPROVE --verified-by <name> ` +
          `--build-hash <current> --token <write_token>`
        return { allowed: false, reason: staleReason, remedy: staleRemedy }
      }
      // Both conditions satisfied — release the gate.
      return { allowed: true }
    }
    // Gate holds — generate milestone-specific block message.
    const artifacts = Array.isArray(pacing.milestone_artifacts) ? pacing.milestone_artifacts : []
    const artifactList = artifacts.length > 0
      ? artifacts.map((a) => `  • ${a.label ?? a.path ?? '(unnamed)'} (${a.kind ?? 'unknown'})`).join('\n')
      : '  (no artifacts declared)'
    const milestoneReason =
      `Milestone gate: human sign-off required before opening wave ${targetUnit}.\n` +
      `Declared artifacts:\n${artifactList}\n` +
      (signoff ? `Last verdict: ${signoff.verdict} (by ${signoff.verified_by}).` : 'No sign-off recorded yet.')
    const milestoneRemedy =
      `Record a human-verified sign-off with:\n` +
      `  ledger milestone-signoff --verdict APPROVE --verified-by <name> --token <write_token>`
    return { allowed: false, reason: milestoneReason, remedy: milestoneRemedy }
  }

  // Wave/slice budget exhausted — generic block.
  const unitLabel = policy === 'slice' ? `slice "${sliceId}"` : `wave ${targetUnit}`
  const reason =
    `Pacing budget exhausted: ${consumed} of ${cap} unit${cap === 1 ? '' : 's'} consumed ` +
    `(budget=${budget}${grantRange > 0 ? `, grant.range=${grantRange}` : ''}). ` +
    `${unitLabel} would open a new unit but none remains for this session.`
  const remedy =
    `Option A: ask the operator to authorize \`ledger autopilot --range N --reason "…"\` — do not self-grant. ` +
    `Option B: run \`/groundwork:pause\` and continue in a new session.`

  return { allowed: false, reason, remedy }
}

/**
 * Validate milestone artifact freshness and declaration requirements.
 *
 * Pure function — no filesystem I/O. File existence must be checked by the caller.
 *
 * Fail-closed semantics (PACING-R-009):
 *   - Artifact kind not in KNOWN_ARTIFACT_KINDS                          → REJECTED
 *     (unknown kind; cannot determine staleness semantics; fail-closed).
 *   - Artifact kind in STALEABLE_ARTIFACT_KINDS + no captured_build_hash → REJECTED
 *     (stale-able kinds require a hash at declaration time; fail-closed).
 *   - Artifact declares captured_build_hash + currentBuildHash matches   → FRESH.
 *   - Artifact declares captured_build_hash + currentBuildHash differs   → STALE.
 *   - Artifact declares captured_build_hash + currentBuildHash is null   → STALE
 *     (cannot verify freshness without a current hash; fail closed — caller must
 *     supply the hash via --build-hash on ledger claim/set).
 *   - Non-stale-able kind (live_url, file) with no captured_build_hash   → FRESH
 *     (existence-only; hash tracking not required for these kinds).
 *
 * @param {object} doc - Ledger document.
 * @param {string|null} [currentBuildHash] - Current build hash for staleness comparison.
 *   When null/undefined AND an artifact declares a captured_build_hash, that artifact
 *   is classified stale (fail-closed).  Pass the hash explicitly via --build-hash.
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

    // Fail-closed: unknown kind — cannot determine staleness semantics; reject.
    if (!KNOWN_ARTIFACT_KINDS.includes(kind)) {
      stale.push(pathLabel)
      anyUnknownKind = true
      continue
    }

    // Stale-able kinds MUST declare captured_build_hash.
    // Omitting it bypasses freshness enforcement — reject (fail-closed).
    if (STALEABLE_ARTIFACT_KINDS.includes(kind) && !artifact.captured_build_hash) {
      stale.push(pathLabel)
      anyMissingHash = true
      continue
    }

    // Hash comparison for artifacts that declare a captured_build_hash.
    if (artifact.captured_build_hash) {
      if (!currentBuildHash) {
        // Artifact declares a build hash but no current hash was supplied.
        // Fail closed: cannot verify freshness — treat as stale.
        stale.push(pathLabel)
        anyHashUnknown = true
      } else if (artifact.captured_build_hash !== currentBuildHash) {
        // Hash mismatch → stale.
        stale.push(pathLabel)
      }
    }
  }

  // Cross-artifact check: live_url alone does not satisfy the gate.
  // A live_url MUST be accompanied by at least one captured companion
  // (file, run_output, or screenshot) in the same milestone.
  const CAPTURED_KINDS = ['file', 'run_output', 'screenshot']
  const hasLiveUrl = artifacts.some(a => a.kind === 'live_url')
  const hasCapturedCompanion = artifacts.some(a => CAPTURED_KINDS.includes(a.kind ?? ''))
  let anyLiveUrlAlone = false
  if (hasLiveUrl && !hasCapturedCompanion) {
    // Push ALL live_url paths into stale to trigger rejection.
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
