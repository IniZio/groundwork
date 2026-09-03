// check-comments-exempt
/**
 * Groundwork concept-slug helpers — shared by the struggle-detector hook,
 * the Learnings KB lib, and the retrospective skill.
 *
 * Three exports:
 *   toSlug(str)              — stable kebab-case slug for arbitrary concept strings
 *   normalizeCommand(cmd)    — canonical shell command for near-duplicate matching
 *   commandFingerprint(cmd)  — 12-char sha1 hex of normalizeCommand(cmd)
 *
 * No external dependencies — Node built-ins only.
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// toSlug
// ---------------------------------------------------------------------------

/**
 * Normalise an arbitrary concept string to a stable kebab-case slug.
 *
 * Steps:
 *  1. Lowercase
 *  2. Replace any non-alphanumeric character run with a single hyphen
 *  3. Trim leading/trailing hyphens
 *
 * Examples:
 *   "Prod Binary Deploy!"  → "prod-binary-deploy"
 *   "go build ./cmd"       → "go-build-cmd"
 *   "  retry  loop  "      → "retry-loop"
 */
export function toSlug(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ---------------------------------------------------------------------------
// normalizeCommand
// ---------------------------------------------------------------------------

/**
 * Canonicalise a shell command string for near-identical matching.
 *
 * Goals:
 *  - `go build ./x`, `go build ./x -o /tmp/a`, `go build ./x -o /tmp/b`
 *    all normalise to the SAME fingerprint.
 *  - `go build ./x` and `go test ./x` produce DIFFERENT fingerprints.
 *
 * Algorithm:
 *  1. Strip leading environment-variable assignments (FOO=bar VAR=baz cmd …).
 *  2. Collapse all internal whitespace to a single space and tokenise.
 *  3. Keep only the "structural identity" of the command:
 *       - The command executable (position 0).
 *       - Bare-word subcommands (tokens that don't start with `-`, `/`, `./`,
 *         `../`, and are not SHA-like hex strings) — these distinguish
 *         `go build` from `go test`.
 *       - All flags (tokens starting with `-`) AND their values are DROPPED.
 *         Flags are per-invocation details; their presence/absence must not
 *         prevent matching the same repeated command pattern.
 *       - Positional path-like arguments (`./x`, `/tmp/a`) are also dropped.
 *  4. Trim.
 *
 * Rationale: the detector cares whether the user is running the same
 * command+subcommand repeatedly (e.g. retrying `go build` or `npm test`),
 * not which exact flags they used each time.
 *
 * The result is a human-readable canonical form, not a hash.
 * Use `commandFingerprint` when you need a compact key.
 */

/** Return true if a token is a path or hash-like value that should be dropped. */
function isVariantToken(tok) {
  // Absolute or relative paths.
  if (tok.startsWith('/') || tok.startsWith('./') || tok.startsWith('../')) return true
  // SHA-like: 7–64 hex chars (git hashes, content digests, etc.).
  if (/^[0-9a-f]{7,64}$/i.test(tok)) return true
  return false
}

export function normalizeCommand(cmd) {
  // 1. Strip leading env assignments: sequences of IDENTIFIER=value before the
  //    first non-assignment word.
  const stripped = cmd.replace(/^(\s*[A-Z_][A-Z0-9_]*=\S*\s+)+/i, '')

  // 2. Tokenise on whitespace.
  const tokens = stripped.trim().split(/\s+/)

  // 3. Walk tokens keeping only structural (command + subcommand) ones.
  //    All flags and their values are dropped entirely.
  const kept = []
  let inFlagValue = false // true when consuming a flag's value token(s)

  for (const tok of tokens) {
    if (tok.startsWith('-')) {
      // Flag — drop it; if it has no embedded `=`, the next token is its value.
      inFlagValue = !tok.includes('=')
      continue
    }

    if (inFlagValue) {
      // This token is a value for the previous flag — drop it and stay in
      // flag-value mode (handles multi-word values split by whitespace).
      continue
    }

    // Non-flag, not in flag-value mode.
    if (isVariantToken(tok)) {
      // Path-like or hash-like positional arg — drop it.
      continue
    }

    // Bare word: command executable or subcommand — keep it.
    // Exit flag-value mode: a new bare word closes the value window.
    inFlagValue = false
    kept.push(tok)
  }

  return kept.join(' ').trim()
}

// ---------------------------------------------------------------------------
// commandFingerprint
// ---------------------------------------------------------------------------

/**
 * Return a 12-character hex sha1 of `normalizeCommand(cmd)`.
 *
 * Stable: same command string → same fingerprint across runs.
 * Short enough to embed in a signal record without bloat.
 */
export function commandFingerprint(cmd) {
  const normalised = normalizeCommand(cmd)
  return createHash('sha1').update(normalised).digest('hex').slice(0, 12)
}
