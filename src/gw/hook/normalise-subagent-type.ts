/**
 * Two normalisers for subagent_type strings — deliberately asymmetric because
 * deny lists and allow lists fail closed in opposite directions.
 *
 * Deny lists OVER-match: strip ANY prefix (lastIndexOf) so no namespace can
 * hide a denied type. "plugin:junior-orchestrator" must deny even when the
 * namespace is unknown.
 *
 * Allow lists UNDER-MATCH: only a bare name or the `groundwork:` namespace is
 * accepted; any other namespace returns '' and falls through to deny. This
 * prevents namespace squatting — "evil:explore" must NOT satisfy an allowlist
 * that contains "explore".
 */
export function normaliseSubagentType(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().toLowerCase()
  if (!s) return ''
  const colon = s.lastIndexOf(':')
  if (colon === -1) return s
  return s.slice(colon + 1).trim()
}

/**
 * Allowlist normalisation — bare name or `groundwork:` namespace only.
 * Unknown namespaces return '' so the caller falls through to deny.
 */
export function normaliseAllowlistType(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().toLowerCase()
  if (!s) return ''
  if (!s.includes(':')) return s                  // bare name — no namespace restriction
  if (s.startsWith('groundwork:')) {              // only known namespace accepted
    const rest = s.slice('groundwork:'.length).trim()
    return rest.includes(':') ? '' : rest         // multi-colon → reject (namespace squatting)
  }
  return ''                                       // unknown namespace → reject (fail closed)
}
