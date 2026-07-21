#!/usr/bin/env node
/**
 * hooks/struggle-detector.mjs — PostToolUse struggle detector (Slice 1)
 *
 * Fires on every Bash, Edit, and Write tool-use completion. Keeps a
 * session-scoped tally in `.groundwork/runs/<session_id>.detector.json` and
 * emits a cross-session signal to `.groundwork/struggle-signals.jsonl` when a
 * threshold is crossed.
 *
 * Signal kinds:
 *   repeat-command   — same Bash fingerprint seen ≥ THRESHOLD times
 *   fail-retry       — same fingerprint retried after a non-zero exit (≥2 with prior fail)
 *   file-thrash      — same file path Edit/Write ≥ THRESHOLD times
 *   error-signature  — same stderr hash seen ≥ THRESHOLD times
 *
 * Design guarantees:
 *   - FAIL-OPEN. Any error, missing field, or missing session_id → exit 0.
 *     PostToolUse cannot block a tool anyway, but we must never crash.
 *   - ONCE-PER-SESSION. Each distinct (session_id × kind × fingerprint) is
 *     emitted at most once; the tally records emitted signals.
 *   - THRESHOLD. Default 3; override via GROUNDWORK_STRUGGLE_THRESHOLD env.
 */

import path from 'node:path'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readStdin, passthrough } from './lib/hook-io.mjs'
import { appendSignal } from './lib/signals-io.mjs'
import { commandFingerprint, toSlug } from './lib/concept-slug.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const THRESHOLD = (() => {
  const raw = process.env.GROUNDWORK_STRUGGLE_THRESHOLD
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : 3
})()

/** Stable 12-char hex hash of the first 200 chars of a string. */
function shortHash(str) {
  return createHash('sha1')
    .update(String(str).slice(0, 200))
    .digest('hex')
    .slice(0, 12)
}

/** Resolve the path to the session-scoped detector tally file. */
function tallyPath(projectDir, sessionId) {
  return path.join(projectDir, '.groundwork', 'runs', `${sessionId}.detector.json`)
}

/** Read tally; returns a fresh empty tally on any error. */
function readTally(tallyFile) {
  try {
    const raw = readFileSync(tallyFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    // Missing or corrupt — start fresh.
  }
  return { fingerprints: {}, errorSigs: {}, emitted: {} }
}

/** Write tally; silently swallows errors (fail-open). */
function writeTally(tallyFile, tally) {
  try {
    mkdirSync(path.dirname(tallyFile), { recursive: true })
    writeFileSync(tallyFile, JSON.stringify(tally), 'utf8')
  } catch {
    // Swallow — must not crash the hook.
  }
}

/**
 * Emit a signal to the cross-session store unless already emitted this session.
 * Returns true if the signal was freshly emitted.
 */
function maybeEmit(tally, projectDir, sessionId, kind, fingerprint, detail) {
  const key = `${kind}:${fingerprint}`
  if (tally.emitted[key]) return false
  tally.emitted[key] = true
  try {
    appendSignal(projectDir, {
      ts: new Date().toISOString(),
      session_id: sessionId,
      kind,
      fingerprint,
      detail,
    })
  } catch {
    // Swallow — fail-open.
  }
  return true
}

// ---------------------------------------------------------------------------
// Core detection logic — exported for testing
// ---------------------------------------------------------------------------

/**
 * Process one PostToolUse payload object.
 *
 * This is the pure detection function: it reads/writes the tally and may
 * append to the signals store.  It does NOT call `passthrough()` (process.exit)
 * so tests can call it directly without the process dying.
 *
 * `opts.threshold` lets tests override THRESHOLD without touching env.
 */
export async function processPayload(input, opts = {}) {
  const threshold = (opts && typeof opts.threshold === 'number') ? opts.threshold : THRESHOLD

  // Fail-open on non-object / null input.
  if (!input || typeof input !== 'object') return

  // --- Extract core fields -------------------------------------------------

  const toolName = typeof input.tool_name === 'string' ? input.tool_name : ''
  if (!['Bash', 'Edit', 'Write'].includes(toolName)) return

  // Resolve project directory: prefer CLAUDE_PROJECT_DIR env, then cwd field.
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR ||
    (typeof input.cwd === 'string' ? input.cwd : '') ||
    ''
  if (!projectDir) return

  // session_id is mandatory — without it we cannot scope the tally.
  const sessionId = typeof input.session_id === 'string' ? input.session_id : ''
  if (!sessionId) return

  const toolInput = input.tool_input
  const toolResponse = input.tool_response

  // --- Load tally ----------------------------------------------------------

  const tFile = tallyPath(projectDir, sessionId)
  const tally = readTally(tFile)
  if (!tally.fingerprints) tally.fingerprints = {}
  if (!tally.errorSigs) tally.errorSigs = {}
  if (!tally.emitted) tally.emitted = {}

  // --- Process by tool name ------------------------------------------------

  if (toolName === 'Bash') {
    const cmd = typeof toolInput?.command === 'string' ? toolInput.command : ''
    if (!cmd) {
      writeTally(tFile, tally)
      return
    }

    const fp = commandFingerprint(cmd)

    // exit_code: Claude Code may nest it at tool_response.exit_code or at the
    // top-level tool_response directly (observed variation in real payloads).
    const exitCode = (() => {
      const direct = toolResponse?.exit_code
      if (typeof direct === 'number') return direct
      const nested = toolResponse?.result?.exit_code
      if (typeof nested === 'number') return nested
      return 0
    })()

    // Initialise record for this fingerprint.
    if (!tally.fingerprints[fp]) {
      tally.fingerprints[fp] = { count: 0, lastExitCode: 0, lastCmd: cmd, fails: 0 }
    }
    const rec = tally.fingerprints[fp]
    rec.count += 1
    rec.lastCmd = cmd
    const hadFail = rec.fails > 0
    if (exitCode !== 0) rec.fails += 1
    rec.lastExitCode = exitCode

    // Signal: fail-retry — same fp retried after a prior non-zero exit.
    if (hadFail && rec.count >= 2) {
      maybeEmit(tally, projectDir, sessionId, 'fail-retry', fp, {
        cmd,
        count: rec.count,
        fails: rec.fails,
      })
    }

    // Signal: repeat-command — same fp seen ≥ threshold times.
    if (rec.count >= threshold) {
      maybeEmit(tally, projectDir, sessionId, 'repeat-command', fp, {
        cmd,
        count: rec.count,
      })
    }

    // Signal: error-signature — recurring stderr hash.
    const stderr = (() => {
      const s = toolResponse?.stderr
      if (typeof s === 'string') return s
      const t = toolResponse?.result?.stderr
      if (typeof t === 'string') return t
      return ''
    })()
    if (stderr && exitCode !== 0) {
      const errHash = shortHash(stderr)
      tally.errorSigs[errHash] = (tally.errorSigs[errHash] || 0) + 1
      if (tally.errorSigs[errHash] >= threshold) {
        maybeEmit(tally, projectDir, sessionId, 'error-signature', errHash, {
          stderrPrefix: stderr.slice(0, 200),
          count: tally.errorSigs[errHash],
        })
      }
    }
  } else {
    // Edit or Write — detect file thrashing.
    const filePath = typeof toolInput?.file_path === 'string' ? toolInput.file_path : ''
    if (!filePath) {
      writeTally(tFile, tally)
      return
    }

    const fp = toSlug(filePath)

    if (!tally.fingerprints[fp]) {
      tally.fingerprints[fp] = { count: 0, lastExitCode: 0, lastCmd: filePath, fails: 0 }
    }
    const rec = tally.fingerprints[fp]
    rec.count += 1

    if (rec.count >= threshold) {
      maybeEmit(tally, projectDir, sessionId, 'file-thrash', fp, {
        filePath,
        count: rec.count,
      })
    }
  }

  writeTally(tFile, tally)
}

// ---------------------------------------------------------------------------
// Main — stdin/stdout entrypoint
// ---------------------------------------------------------------------------

async function main() {
  let input = {}
  try {
    const raw = await readStdin()
    if (raw.trim()) input = JSON.parse(raw)
  } catch {
    return passthrough()
  }

  try {
    await processPayload(input)
  } catch {
    // Fail-open: any unexpected error → proceed.
  }

  return passthrough()
}

// Only run as a script (not when imported by tests).
// import.meta.url matches process.argv[1] when executed directly.
const scriptUrl = new URL(import.meta.url).pathname
const entryUrl = process.argv[1] ? new URL(`file://${process.argv[1]}`).pathname : ''
if (scriptUrl === entryUrl) {
  main().catch(() => passthrough())
}
