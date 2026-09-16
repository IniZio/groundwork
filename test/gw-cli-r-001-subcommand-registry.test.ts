// @verifies gw-cli-r-001
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LEDGER_SUBCOMMANDS } from '#src/gw/cli/commands/ledger.js'

/**
 * GW-CLI-R-001 enforcement.
 *
 * The expected subcommand list is derived at test-run time from the EARS
 * sentence in doc/specs/gw-cli/requirements/gw-cli-r-001-subcommand-registry.md.
 *
 * This catches drift in BOTH directions:
 *   - spec updated without updating source (LEDGER_SUBCOMMANDS) → red
 *   - source updated without updating spec → red
 *
 * The parser looks for the first line matching /subcommands: `[a-z]/,
 * extracts every backtick-quoted token before the first semicolon,
 * then filters out multi-word tokens (e.g. `gw ledger`).
 *
 * A rewording of the EARS sentence that changes those two anchor strings is
 * itself a spec change — the author must fix the parser or the sentence to
 * re-synchronise. A false-positive from a reword is preferable to silent drift.
 */

const SPEC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../doc/specs/gw-cli/requirements/gw-cli-r-001-subcommand-registry.md',
)

function parseSpecSubcommands(): ReadonlyArray<string> {
  let content: string
  try {
    content = readFileSync(SPEC_PATH, 'utf8')
  } catch (e) {
    throw new Error(`spec parse failure: could not read ${SPEC_PATH}\n${String(e)}`)
  }

  const earsSentenceLine = content
    .split('\n')
    .find(l => /subcommands: `[a-z]/.test(l))

  if (!earsSentenceLine) {
    throw new Error(
      `spec parse failure: no EARS sentence found in ${SPEC_PATH}\n` +
        `Expected a line matching /subcommands: \`[a-z]/`,
    )
  }

  // The list ends at the first semicolon ("…`nameN`; and when…")
  const beforeSemicolon = earsSentenceLine.split(';')[0]
  const names = [...beforeSemicolon.matchAll(/`([^`]+)`/g)]
    .map(m => m[1])
    .filter(n => !n.includes(' ')) // drop multi-word tokens like `gw ledger`

  if (names.length === 0) {
    throw new Error(
      `spec parse failure: extracted zero subcommand names from EARS sentence in ${SPEC_PATH}`,
    )
  }

  return names
}

const SPEC_SUBCOMMANDS = parseSpecSubcommands()

describe('GW-CLI-R-001 subcommand registry', () => {
  it('matches the spec EARS sentence exactly (set equality)', () => {
    // If this fails, either the spec or the source was changed without updating the other.
    expect([...LEDGER_SUBCOMMANDS].sort()).toEqual([...SPEC_SUBCOMMANDS].sort())
  })

  it('includes init', () => {
    expect(LEDGER_SUBCOMMANDS as ReadonlyArray<string>).toContain('init')
  })
})
