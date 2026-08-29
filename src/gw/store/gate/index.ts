/**
 * src/gw/store/gate/index.ts — Per-session advisor gate note store.
 *
 * Gate notes are stored at:
 *   <repoRoot>/<tracker>/motives/<motive>/gate-<sessionId>.md
 *
 * Each note has a tamper-evident sidecar seal written alongside it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { GateSchema, gateNotePath, motiveDir, type Gate } from '../../schema/index.js'
import { writeSeal, verifyNote, GATE_MACHINE_KEYS } from '../seal/index.js'

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Write a gate note. Creates parent dir if needed. Writes seal sidecar.
 * Returns the written note path.
 */
export function writeGate(opts: {
  repoRoot: string
  tracker: string
  motive: string
  gate: Gate
}): string {
  const { repoRoot, tracker, motive, gate } = opts
  const notePath = gateNotePath(repoRoot, tracker, motive, gate.session)
  const dir = path.dirname(notePath)
  mkdirSync(dir, { recursive: true })

  // Validate before writing
  const fm = GateSchema.parse(gate) as Record<string, unknown>

  const output = matter.stringify('\n', fm)
  writeFileSync(notePath, output, 'utf8')

  // Write seal sidecar covering machine-owned keys
  const mDir = motiveDir(repoRoot, tracker, motive)
  writeSeal(notePath, mDir, fm, GATE_MACHINE_KEYS)

  return notePath
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Read a gate note for a session. Returns null if not found.
 */
export function readGate(
  repoRoot: string,
  tracker: string,
  motive: string,
  sessionId: string,
): (Gate & { sealed: true | false | null }) | null {
  const notePath = gateNotePath(repoRoot, tracker, motive, sessionId)
  if (!existsSync(notePath)) return null

  const raw = readFileSync(notePath, 'utf8')
  const { data } = matter(raw)
  const parsed = GateSchema.parse(data)
  const mDir = path.dirname(notePath)
  const sealed = verifyNote(notePath, mDir, 'gate')
  return { ...parsed, sealed }
}

// ---------------------------------------------------------------------------
// Advisor verdict extraction
// ---------------------------------------------------------------------------

function extractVerdict(advisor: Gate['advisor']): string | null {
  if (!advisor) return null
  if (typeof advisor === 'string') return advisor
  if (typeof advisor === 'object' && 'verdict' in advisor) return advisor.verdict
  return null
}

/**
 * Extract advisor verdict string from the gate note for a session.
 * Handles both string form ('APPROVE') and object form ({verdict: 'APPROVE'}).
 * Returns null if no gate note or advisor field is absent.
 */
export function advisorVerdict(
  repoRoot: string,
  tracker: string,
  motive: string,
  sessionId: string,
): string | null {
  const gate = readGate(repoRoot, tracker, motive, sessionId)
  if (!gate) return null
  return extractVerdict(gate.advisor)
}
