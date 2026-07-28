#!/usr/bin/env node
/**
 * Groundwork spec-guard — PreToolUse hook that advises on RFC-authorized writes
 * to doc/specs/ and docs/steering/.
 *
 * ── ADVISORY-ONLY MODE (RFC gate intentionally disabled) ──
 *
 * The RFC status gate and spec_delta coverage gate previously issued hard denials
 * (exit 2). They have been converted to warn-and-permit (exit 0 + WARN to stderr)
 * so that editing a spec file does NOT require an RFC. The hook file and its
 * hooks.json registration are intentionally retained for future re-enable; to
 * restore enforcement, change the two warnAndPermit() calls at Steps 5 and 6–7
 * back to deny() calls and reinstate the deny() helper.
 *
 * Current behaviour summary:
 *  - All writes exit 0 (permit). Advisory WARNs are emitted to stderr when the
 *    RFC status is not accepted/implementing, or when no spec_delta entry covers
 *    the target path, but these WARNs do NOT block the write.
 *  - doc/specs/_generated/ is unconditionally exempt (no WARN, no ledger load).
 *  - FAIL-OPEN: any read/parse/resolution error → permit + WARN to stderr.
 *    A guard must never wedge real work.
 *
 * Exit codes:
 *  0 — permit (always, in advisory mode)
 *
 * Advisory messages are written to stderr; stdout is always empty.
 *
 * ── KNOWN FAIL-OPEN PATHS (pinned by tests) ──
 *
 * 1. Cross-repo writes are NOT authorization-checked.
 *    GUARDED_PREFIXES contains project-root-relative strings ("doc/specs/",
 *    "docs/steering/"). When the hook fires for a write in another repo (e.g.
 *    /home/newman/magic/hanlun-lms/doc/specs/...), relativeFromProject() returns
 *    the absolute path unchanged (it is outside projectDir). The absolute path
 *    does not start with "doc/specs/", so isGuarded = false → immediate
 *    passthrough(), with no RFC check performed.
 *    See: the isGuarded block at ~line 146-149 and relativeFromProject() at ~line 67.
 *
 * 2. A session with no run ledger is fail-open.
 *    When no ledger file exists on disk for the current session, the guard emits
 *    a WARN to stderr and exits 0 (permit).
 *    See: the `if (!ledger) return warnAndPermit(...)` block at ~line 169-171.
 *
 * Both behaviors are intentional and are pinned by tests.
 * If the design decision later flips to fail-closed, invert those tests.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { readStdin, passthrough } from './lib/hook-io.mjs'
import { resolveLedgerPath } from './lib/ledger-io.mjs'
import { findRfcByUid, readRfcFrontmatter } from './lib/rfc-io.mjs'

// ── Constants ────────────────────────────────────────────────────────────────

/** Canonical tool names (after normalization) that this guard intercepts. */
const GUARDED_TOOLS = new Set(['edit', 'write', 'multiedit'])

/** Relative path prefixes (from project root) that require RFC authorization. */
const GUARDED_PREFIXES = ['doc/specs/', 'docs/steering/']

/** Paths under this prefix are unconditionally permitted (generated files). */
const GENERATED_EXEMPT = 'doc/specs/_generated/'

/** RFC statuses that allow writes. */
const ALLOWED_RFC_STATUSES = new Set(['accepted', 'implementing'])

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

/**
 * Locate an RFC directory given `rfc_ref`.
 *
 * `rfc_ref` may be:
 *  1. A relative path from projectDir: `.groundwork/rfcs/0001-spec-rfc-journal`
 *  2. An RFC UID string: `"0001"` or `"RFC-0001"` — searched via findRfcByUid.
 *
 * Returns the absolute path to the RFC directory, or null if not found.
 * Never throws.
 */
function resolveRfcDir(projectDir, rfcRef) {
  try {
    // Strategy 1: treat as a relative (or absolute) path to the RFC directory.
    const candidate = path.isAbsolute(rfcRef)
      ? rfcRef
      : path.join(path.resolve(projectDir), rfcRef)
    // Accept the directory if it contains rfc.yaml (sidecar) or rfc.md (legacy).
    if (existsSync(path.join(candidate, 'rfc.yaml'))) return candidate
    if (existsSync(path.join(candidate, 'rfc.md'))) return candidate

    // Strategy 2: treat as a UID and search .groundwork/rfcs/.
    const rfcsDir = path.join(path.resolve(projectDir), '.groundwork', 'rfcs')
    return findRfcByUid(rfcsDir, rfcRef)
  } catch {
    return null
  }
}

/**
 * Returns true when a spec_delta entry covers `relPath`.
 * Match is exact OR target is a prefix of relPath (directory coverage).
 */
function entryCovers(entry, relPath) {
  const target = entry?.target
  if (typeof target !== 'string' || !target) return false
  if (relPath === target) return true
  // Prefix match: target must be followed by '/' (avoids 'doc/specs/foo' matching 'doc/specs/foobar').
  const withSlash = target.endsWith('/') ? target : target + '/'
  return relPath.startsWith(withSlash)
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

  // Extract the target file path.
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

  // ── Step 3: unconditionally permit _generated/ ─────────────────────────────
  if (relPath.startsWith(GENERATED_EXEMPT)) return passthrough()

  // ── Step 4: load session ledger ────────────────────────────────────────────
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

  const rfcRef = ledger.rfc_ref
  if (!rfcRef || typeof rfcRef !== 'string') {
    return warnAndPermit(`ledger has no rfc_ref — permitting write to ${relPath}`)
  }

  // ── Steps 5–8: validate RFC status and spec_delta coverage ────────────────
  let frontmatter = null
  let rfcUid = rfcRef

  try {
    const rfcDir = resolveRfcDir(projectDir, rfcRef)
    if (!rfcDir) {
      return warnAndPermit(
        `RFC not found for rfc_ref "${rfcRef}" — permitting write (fail-open)`,
      )
    }
    const parsed = readRfcFrontmatter(rfcDir)
    frontmatter = parsed.frontmatter
    rfcUid = typeof frontmatter.uid === 'string' ? frontmatter.uid : rfcRef
  } catch {
    return warnAndPermit(
      `could not parse RFC frontmatter for "${rfcRef}" — permitting write (fail-open)`,
    )
  }

  // Step 5: RFC status advisory (warn-only; does not block).
  const rfcStatus = frontmatter?.status
  if (!ALLOWED_RFC_STATUSES.has(rfcStatus)) {
    return warnAndPermit(
      `RFC ${rfcUid} is ${rfcStatus}; consider advancing to accepted/implementing before editing doc/specs/ (advisory only — write permitted)`,
    )
  }

  // Steps 6–7: spec_delta coverage advisory (warn-only; does not block).
  const specDelta = Array.isArray(frontmatter?.spec_delta) ? frontmatter.spec_delta : []
  const covered = specDelta.some((entry) => entryCovers(entry, relPath))
  if (!covered) {
    return warnAndPermit(
      `no spec_delta entry in RFC ${rfcUid} covers ${rawPath}; consider adding an op to spec_delta (advisory only — write permitted)`,
    )
  }

  // Step 8: permit.
  return passthrough()
}

main().catch(() => passthrough())
