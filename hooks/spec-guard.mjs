#!/usr/bin/env node
// check-comments-exempt — hook; opening block-comment is the tool doc
/**
 * Groundwork spec-guard — PreToolUse hook that guards writes to doc/specs/
 * and docs/steering/.
 *
 * Current behaviour: pass-through for all writes (RFC gate removed in S6).
 * The hook registration is retained for future re-enable.
 *
 * ── KNOWN FAIL-OPEN PATHS (pinned by tests) ──
 *
 * 1. Cross-repo writes are NOT intercepted.
 *    GUARDED_PREFIXES contains project-root-relative strings ("doc/specs/",
 *    "docs/steering/"). Writes in another repo fall outside projectDir so
 *    isGuarded = false → immediate passthrough().
 *    See: the isGuarded block at ~line 75 and relativeFromProject() at ~line 50.
 *
 * 2. A session with no run ledger is fail-open.
 *    When no ledger file exists on disk for the current session, the guard
 *    emits a WARN to stderr and exits 0 (permit).
 *    See: the `if (!ledger) return warnAndPermit(...)` block at ~line 100.
 *
 * Both behaviors are intentional and are pinned by tests.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { readStdin, passthrough } from './lib/hook-io.mjs'
import { resolveLedgerPath } from './lib/ledger-io.mjs'

// ── Constants ────────────────────────────────────────────────────────────────

/** Canonical tool names (after normalization) that this guard intercepts. */
const GUARDED_TOOLS = new Set(['edit', 'write', 'multiedit'])

/** Relative path prefixes (from project root) that this guard intercepts. */
const GUARDED_PREFIXES = ['doc/specs/', 'docs/steering/']

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize a tool name: lowercase, strip leading "fast_". */
function normalizeTool(name) {
  if (typeof name !== 'string') return ''
  const lower = name.toLowerCase()
  return lower.startsWith('fast_') ? lower.slice(5) : lower
}

/** Print a WARN to stderr and return (fail-open — exit 0). */
function warnAndPermit(msg) {
  process.stderr.write(`spec-guard: WARN — ${msg}\n`)
  process.exit(0)
}

/**
 * Compute the path of `filePath` relative to `projectDir`, using forward slashes.
 * If `filePath` is already relative, returns it with slashes normalised.
 * If `filePath` is absolute but outside `projectDir`, returns null (not guarded).
 */
function relativeFromProject(filePath, projectDir) {
  const resolved = path.resolve(filePath)
  const projResolved = path.resolve(projectDir)
  if (resolved.startsWith(projResolved + path.sep)) {
    return resolved.slice(projResolved.length + 1).replace(/\\/g, '/')
  }
  // Already relative (or absolute outside project) — normalise slashes only.
  // If it's absolute and outside the project, the prefix check will fail → pass-through.
  const norm = filePath.replace(/\\/g, '/')
  return norm
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // FAIL-OPEN: parse errors → permit silently.
  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  // Only intercept edit/write/multiedit variants.
  const toolName = normalizeTool(input?.tool_name)
  if (!GUARDED_TOOLS.has(toolName)) return passthrough()

  const rawPath = input?.tool_input?.file_path ?? input?.tool_input?.path
  if (typeof rawPath !== 'string' || !rawPath) return passthrough()

  // Resolve project dir (passed as cwd in the hook payload, or process.cwd()).
  const projectDir =
    typeof input?.cwd === 'string' && input.cwd ? input.cwd : process.cwd()

  // Compute relative path from project root for prefix checks.
  const relPath = relativeFromProject(rawPath, projectDir)

  // ── Step 2: pass-through for paths outside guarded prefixes ────────────────
  const isGuarded = GUARDED_PREFIXES.some(
    (prefix) => relPath === prefix.slice(0, -1) || relPath.startsWith(prefix),
  )
  if (!isGuarded) return passthrough()

  // ── Step 3: load session ledger ────────────────────────────────────────────
  const sessionId = process.env.CLAUDE_SESSION_ID ?? input?.session_id
  let ledger = null
  let ledgerPath = null
  try {
    ledgerPath = resolveLedgerPath({ projectDir, sessionId })
    if (ledgerPath && existsSync(ledgerPath)) {
      ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'))
    }
  } catch {
    return warnAndPermit(
      `could not read ledger at ${ledgerPath ?? '<unknown>'} — permitting write to ${relPath}`,
    )
  }

  if (!ledger) {
    return warnAndPermit(`no run ledger found — permitting write to ${relPath}`)
  }

  return passthrough()
}

main().catch(() => passthrough())
