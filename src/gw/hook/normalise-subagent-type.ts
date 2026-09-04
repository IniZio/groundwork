/**
 * src/gw/hook/normalise-subagent-type.ts
 *
 * Shared normalisation for subagent_type strings, used by nesting-guard and
 * agent-model-guard. Strips any `<prefix>:` namespace (using lastIndexOf so
 * multi-segment types like "a:b:c" resolve to "c") and lowercases.
 *
 * Examples:
 *   "groundwork:general-purpose" → "general-purpose"
 *   "plugin:foo"                 → "foo"
 *   "a:b:c"                     → "c"
 *   "bare-name"                  → "bare-name"
 *   "trailing:"                  → ""  (treated as unknown → passthrough)
 *   ":leading"                   → "leading"
 */
export function normaliseSubagentType(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim().toLowerCase()
  if (!s) return ''
  const colon = s.lastIndexOf(':')
  if (colon === -1) return s
  return s.slice(colon + 1).trim()
}
