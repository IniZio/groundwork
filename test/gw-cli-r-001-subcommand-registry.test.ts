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
 * sentence in doc/specs/gw-cli/requirements/gw-cli-r-001-subcommand-registry.md,
 * not from a hand-maintained list in this file. This catches drift in BOTH
 * directions: spec updated without updating LEDGER_SUBCOMMANDS → red;
 * LEDGER_SUBCOMMANDS updated without updating spec → red. A duplicate list
 * here would catch only source-vs-test drift, missing spec-vs-source drift —
 * which is the defect that let the spec sit at "16 subcommands" while the
 * source had 19.
 */

const SPEC_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../doc/specs/gw-cli/requirements/gw-cli-r-001-subcommand-registry.md',
)

const INDEX_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../doc/specs/gw-cli/index.md',
)

const README_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../doc/specs/README.md',
)

/** EARS SHALL anchor — the opening of the R-001 requirement sentence. */
const EARS_ANCHOR = /\*\*shall\*\* accept exactly the following \d+ subcommands:/

/**
 * Finds the EARS SHALL sentence in the R-001 spec, extracts every
 * backtick-quoted token before the first semicolon, and filters out
 * multi-word tokens (e.g. `gw ledger`). Anchored on the EARS keyword so no
 * earlier bullet can hijack the parse.
 */
function parseSpecSubcommands(): ReadonlyArray<string> {
  let content: string
  try {
    content = readFileSync(SPEC_PATH, 'utf8')
  } catch (e) {
    throw new Error(`spec parse failure: could not read ${SPEC_PATH}\n${String(e)}`)
  }

  const earsSentenceLine = content
    .split('\n')
    .find(l => EARS_ANCHOR.test(l))

  if (!earsSentenceLine) {
    throw new Error(
      `spec parse failure: no EARS sentence found in ${SPEC_PATH}\n` +
        `Expected a line matching ${EARS_ANCHOR}`,
    )
  }

  // The list ends at the first semicolon ("…`nameN`; and when…")
  const beforeSemicolon = earsSentenceLine.split(';')[0]
  const names = [...beforeSemicolon.matchAll(/`([^`]+)`/g)]
    .map(m => m[1])
    .filter(n => !n.includes(' '))

  if (names.length === 0) {
    throw new Error(
      `spec parse failure: extracted zero subcommand names from EARS sentence in ${SPEC_PATH}`,
    )
  }

  return names
}

const SPEC_SUBCOMMANDS = parseSpecSubcommands()

/**
 * Extracts the integer N from "exactly the following N subcommands:" in the
 * EARS sentence. Guards against a numeral left stale while names are updated.
 */
function parseSpecNumeral(): number {
  const content = readFileSync(SPEC_PATH, 'utf8')
  const line = content.split('\n').find(l => EARS_ANCHOR.test(l))
  if (!line) throw new Error(`spec parse failure: no EARS sentence in ${SPEC_PATH}`)
  const m = /following (\d+) subcommands:/.exec(line)
  if (!m) throw new Error(`spec parse failure: no numeral in EARS sentence in ${SPEC_PATH}`)
  return Number(m[1])
}

const SPEC_NUMERAL = parseSpecNumeral()

/**
 * Extracts every integer appearing in a count-of-subcommands context within
 * the given file: "N subcommands" / "N ledger subcommands" / "N entries" /
 * "N-name list".
 */
function extractCountNumerals(filePath: string): number[] {
  const content = readFileSync(filePath, 'utf8')
  const nums: number[] = []
  const patterns = [
    /\b(\d+)\s+(?:gw\s+)?(?:ledger\s+)?subcommands?\b/g,
    /\b(\d+)\s+entries\b/g,
    /\b(\d+)-name\s+list\b/g,
  ]
  for (const pat of patterns) {
    for (const m of content.matchAll(pat)) nums.push(Number(m[1]))
  }
  return nums
}

/** Matches English number words in the range plausible for subcommand counts. */
const SPELLED_COUNT_RE =
  /\b(?:Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty)\b/i

describe('GW-CLI-R-001 subcommand registry', () => {
  it('matches the spec EARS sentence exactly (set equality)', () => {
    expect([...LEDGER_SUBCOMMANDS].sort()).toEqual([...SPEC_SUBCOMMANDS].sort())
  })

  it('spec numeral matches parsed name count', () => {
    expect(SPEC_NUMERAL).toBe(SPEC_SUBCOMMANDS.length)
  })

  it('includes init', () => {
    expect(LEDGER_SUBCOMMANDS as ReadonlyArray<string>).toContain('init')
  })

  it('all count-numerals in R-001 spec equal LEDGER_SUBCOMMANDS.length', () => {
    const nums = extractCountNumerals(SPEC_PATH)
    expect(nums.length).toBeGreaterThan(0)
    for (const n of nums) {
      expect(n, `numeral ${n} in R-001 does not match LEDGER_SUBCOMMANDS.length (${LEDGER_SUBCOMMANDS.length})`).toBe(
        LEDGER_SUBCOMMANDS.length,
      )
    }
  })

  it('all count-numerals in index.md equal LEDGER_SUBCOMMANDS.length', () => {
    const nums = extractCountNumerals(INDEX_PATH)
    expect(nums.length).toBeGreaterThan(0)
    for (const n of nums) {
      expect(n, `numeral ${n} in index.md does not match LEDGER_SUBCOMMANDS.length (${LEDGER_SUBCOMMANDS.length})`).toBe(
        LEDGER_SUBCOMMANDS.length,
      )
    }
  })

  it('no spelled-out count word in R-001 spec', () => {
    const content = readFileSync(SPEC_PATH, 'utf8')
    const m = SPELLED_COUNT_RE.exec(content)
    expect(m, `found spelled-out count word "${m?.[0]}" in ${SPEC_PATH}`).toBeNull()
  })

  it('no spelled-out count word in index.md', () => {
    const content = readFileSync(INDEX_PATH, 'utf8')
    const m = SPELLED_COUNT_RE.exec(content)
    expect(m, `found spelled-out count word "${m?.[0]}" in ${INDEX_PATH}`).toBeNull()
  })

  it('all count-numerals in README.md equal LEDGER_SUBCOMMANDS.length', () => {
    const nums = extractCountNumerals(README_PATH)
    for (const n of nums) {
      expect(n, `numeral ${n} in README.md does not match LEDGER_SUBCOMMANDS.length (${LEDGER_SUBCOMMANDS.length})`).toBe(
        LEDGER_SUBCOMMANDS.length,
      )
    }
  })

  it('no spelled-out count word in README.md', () => {
    const content = readFileSync(README_PATH, 'utf8')
    const m = SPELLED_COUNT_RE.exec(content)
    expect(m, `found spelled-out count word "${m?.[0]}" in ${README_PATH}`).toBeNull()
  })
})
