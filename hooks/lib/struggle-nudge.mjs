/**
 * Side-effect-free helper: build the struggle-nudge context block.
 *
 * Importing this module is instant and safe — no top-level I/O, no stdin reads.
 * session-reminder.mjs imports and calls buildStruggleNudge at runtime;
 * tests import this module directly to avoid the hook's stdin execution path.
 */

import { readSignals } from './signals-io.mjs'

/**
 * Build a short struggle-nudge block when recent (within `windowDays`) signals
 * exist in the project's JSONL store.  Returns '' when there are no signals to
 * show — safe to append unconditionally.
 *
 * @param {string} projectDir   Absolute path to the project root.
 * @param {object} [opts]
 * @param {number} [opts.windowDays=7]  How many days back to look.
 * @param {number} [opts.maxLines=4]    Max signal summary lines to emit.
 */
export function buildStruggleNudge(projectDir, { windowDays = 7, maxLines = 4 } = {}) {
  let signals
  try {
    signals = readSignals(projectDir)
  } catch {
    return '' // never fail the hook
  }
  if (!signals.length) return ''

  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
  const recent = signals.filter((s) => {
    try { return new Date(s.ts).getTime() >= cutoff } catch { return false }
  })
  if (!recent.length) return ''

  // Group by kind + fingerprint to produce a compact summary.
  /** @type {Map<string, {kind: string, fingerprint: string, count: number, detail: unknown}>} */
  const groups = new Map()
  for (const s of recent) {
    const key = `${s.kind ?? ''}::${s.fingerprint ?? ''}`
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
    } else {
      groups.set(key, { kind: s.kind ?? '?', fingerprint: s.fingerprint ?? '', count: 1, detail: s.detail })
    }
  }

  const lines = ['', '## ⚠ Struggle signals detected']
  let shown = 0
  for (const { kind, fingerprint, count, detail } of groups.values()) {
    if (shown >= maxLines) break
    const label = fingerprint || (detail && typeof detail === 'object' && 'cmd' in detail ? detail.cmd : '')
    const suffix = label ? ` \`${label}\`` : ''
    lines.push(`- ${kind}×${count}${suffix}`)
    shown++
  }
  if (groups.size > maxLines) lines.push(`  … and ${groups.size - maxLines} more pattern(s)`)
  lines.push('')
  lines.push('Consider running `/retrospective` to codify the lesson before ending this session.')
  return `\n${lines.join('\n')}`
}
