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
  } else {
    // policy === 'wave'
    // Group non-exempt slices by wave.
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
 * @param {object} doc      - Ledger document.
 * @param {string} sliceId  - Slice being claimed or set in-progress.
 * @returns {{ allowed: boolean, reason?: string, remedy?: string }}
 */
export function checkPace(doc, sliceId) {
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

  // Budget exhausted — block the claim.
  const unitLabel = policy === 'slice' ? `slice "${sliceId}"` : `wave ${targetUnit}`
  const reason =
    `Pacing budget exhausted: ${consumed} of ${cap} unit${cap === 1 ? '' : 's'} consumed ` +
    `(budget=${budget}${grantRange > 0 ? `, grant.range=${grantRange}` : ''}). ` +
    `${unitLabel} would open a new unit but none remains for this session.`
  const remedy =
    `Option A: ask the operator to authorize \`ledger autopilot --range N --reason "…"\` — do not self-grant. ` +
    `Option B: run \`/groundwork:handoff\` and continue in a new session.`

  return { allowed: false, reason, remedy }
}
