#!/usr/bin/env node
/**
 * token-meter — reads Claude Code session JSONL transcripts and reports
 * token consumption per field plus a cost-weighted total.
 *
 * Usage:
 *   token-meter <session.jsonl>          report for a specific session file
 *   token-meter --project <dir>          report for the latest session in <dir>
 *   token-meter --latest                 report for latest session in the auto-resolved project dir
 *   token-meter help                     show this help
 *
 * Exit codes: 0 success · 1 operational failure · 2 usage error
 *
 * ── Pricing multipliers ───────────────────────────────────────────────────────
 * These constants are used to compute a cost-weighted total across the four
 * billing fields. They reflect claude-sonnet-4-x as of 2026-08-16.
 *
 * VERIFIED ratios (confirmed from docs.anthropic.com/en/docs/build-with-claude/prompt-caching,
 * pricing table + multiplier list, 2026-08-16):
 *   cache write (5 min): 1.25× input
 *   cache write (1 hr):  2.00× input   ← NOT 2× the 5m rate; 2× base input
 *   cache read:          0.10× input
 *   output:              5.00× input
 *
 * Source quote: "1-hour cache write tokens are 2 times the base input tokens price"
 * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#pricing
 *
 * To measure against a different model, change BASE_INPUT_PRICE_PER_MTOK.
 */

// ── Pricing constants (USD per million tokens) ────────────────────────────────

/** Base input price for the model being measured. Change for a different model. */
export const BASE_INPUT_PRICE_PER_MTOK = 3.00 // Sonnet 4.x verified at anthropic.com/pricing

export const PRICE_INPUT_PER_MTOK             = BASE_INPUT_PRICE_PER_MTOK           // $3.00 — verified
export const PRICE_CACHE_CREATION_5M_PER_MTOK = BASE_INPUT_PRICE_PER_MTOK * 1.25   // $3.75 — verified ratio
export const PRICE_CACHE_CREATION_1H_PER_MTOK = BASE_INPUT_PRICE_PER_MTOK * 2          // $6.00 — verified ratio (2× base input)
export const PRICE_CACHE_READ_PER_MTOK        = BASE_INPUT_PRICE_PER_MTOK * 0.10   // $0.30 — verified ratio
export const PRICE_OUTPUT_PER_MTOK            = BASE_INPUT_PRICE_PER_MTOK * 5      // $15.00 — verified ratio

// ── Core parsing ──────────────────────────────────────────────────────────────

/**
 * Totals across all deduplicated assistant records in a JSONL session file.
 * @typedef {Object} UsageTotals
 * @property {number} input_tokens
 * @property {number} cache_creation_5m_tokens   ephemeral_5m_input_tokens
 * @property {number} cache_creation_1h_tokens   ephemeral_1h_input_tokens
 * @property {number} cache_creation_input_tokens total (5m + 1h, or raw if breakdown absent)
 * @property {number} cache_read_input_tokens
 * @property {number} output_tokens
 * @property {number} record_count   number of unique assistant usage records
 */

/**
 * Parse a JSONL string and return summed usage totals.
 * Deduplicates by record `uuid`; skips non-assistant records and records
 * without a `message.usage` block.
 *
 * @param {string} jsonl  raw JSONL content
 * @returns {UsageTotals}
 */
export function parseTotals(jsonl) {
  const seen = new Set()
  const totals = {
    input_tokens: 0,
    cache_creation_5m_tokens: 0,
    cache_creation_1h_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
    record_count: 0,
  }

  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let record
    try {
      record = JSON.parse(trimmed)
    } catch {
      continue // skip malformed lines
    }

    // Only assistant records carry billing usage.
    if (record.type !== 'assistant') continue
    const usage = record.message?.usage
    if (!usage) continue

    // Deduplicate: the same message can appear in multiple JSONL lines
    // (e.g. in sidechain records). Key by uuid when present, else requestId.
    const key = record.uuid ?? record.requestId
    if (key !== undefined) {
      if (seen.has(key)) continue
      seen.add(key)
    }

    totals.input_tokens             += usage.input_tokens             ?? 0
    totals.cache_read_input_tokens  += usage.cache_read_input_tokens  ?? 0
    totals.output_tokens            += usage.output_tokens            ?? 0

    // cache_creation: prefer the fine-grained breakdown when available,
    // which lets us apply the correct 5m vs 1h billing rate.
    const breakdown = usage.cache_creation
    if (breakdown) {
      const tokens5m = breakdown.ephemeral_5m_input_tokens ?? 0
      const tokens1h = breakdown.ephemeral_1h_input_tokens ?? 0
      totals.cache_creation_5m_tokens += tokens5m
      totals.cache_creation_1h_tokens += tokens1h
      totals.cache_creation_input_tokens += tokens5m + tokens1h
    } else {
      // Fallback: no breakdown — treat entire creation as 5m for a conservative estimate.
      const raw = usage.cache_creation_input_tokens ?? 0
      totals.cache_creation_5m_tokens    += raw
      totals.cache_creation_input_tokens += raw
    }

    totals.record_count += 1
  }

  return totals
}

/**
 * Compute the cost-weighted USD total for a UsageTotals object.
 * Returns an object with per-field costs and a grand total.
 *
 * @param {UsageTotals} totals
 * @returns {{ input: number, cache_creation_5m: number, cache_creation_1h: number, cache_read: number, output: number, total: number }}
 */
export function computeCost(totals) {
  const M = 1_000_000
  const input          = (totals.input_tokens                / M) * PRICE_INPUT_PER_MTOK
  const cache_creation_5m = (totals.cache_creation_5m_tokens / M) * PRICE_CACHE_CREATION_5M_PER_MTOK
  const cache_creation_1h = (totals.cache_creation_1h_tokens / M) * PRICE_CACHE_CREATION_1H_PER_MTOK
  const cache_read     = (totals.cache_read_input_tokens      / M) * PRICE_CACHE_READ_PER_MTOK
  const output         = (totals.output_tokens               / M) * PRICE_OUTPUT_PER_MTOK
  const total          = input + cache_creation_5m + cache_creation_1h + cache_read + output
  return { input, cache_creation_5m, cache_creation_1h, cache_read, output, total }
}

/**
 * Format a UsageTotals + cost breakdown as a human-readable report string.
 *
 * @param {string} source  label for the file/session being reported
 * @param {UsageTotals} totals
 * @returns {string}
 */
export function formatReport(source, totals) {
  const cost = computeCost(totals)
  const fmt  = (n) => n.toLocaleString('en-US')
  const usd  = (n) => `$${n.toFixed(6)}`

  const p = (n) => n.toFixed(2)
  const lines = [
    `── token-meter ─────────────────────────────────────────────────────────────`,
    `Source : ${source}`,
    `Records: ${fmt(totals.record_count)} assistant message(s) (deduplicated)`,
    ``,
    `Token breakdown`,
    `  input_tokens              : ${fmt(totals.input_tokens).padStart(12)}   ${usd(cost.input)}`,
    `  cache_creation (5-min TTL): ${fmt(totals.cache_creation_5m_tokens).padStart(12)}   ${usd(cost.cache_creation_5m)}`,
    `  cache_creation (1-hr TTL) : ${fmt(totals.cache_creation_1h_tokens).padStart(12)}   ${usd(cost.cache_creation_1h)}`,
    `  cache_read_input_tokens   : ${fmt(totals.cache_read_input_tokens).padStart(12)}   ${usd(cost.cache_read)}`,
    `  output_tokens             : ${fmt(totals.output_tokens).padStart(12)}   ${usd(cost.output)}`,
    ``,
    `Cost-weighted total (USD)   : ${usd(cost.total)}`,
    `  (Sonnet 4.x: input $${p(PRICE_INPUT_PER_MTOK)}/MTok, cache-write-5m $${p(PRICE_CACHE_CREATION_5M_PER_MTOK)}/MTok,`,
    `   cache-write-1h $${p(PRICE_CACHE_CREATION_1H_PER_MTOK)}/MTok, cache-read $${p(PRICE_CACHE_READ_PER_MTOK)}/MTok, output $${p(PRICE_OUTPUT_PER_MTOK)}/MTok)`,
    `────────────────────────────────────────────────────────────────────────────`,
  ]
  return lines.join('\n')
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const HELP = `
token-meter — report token consumption from a Claude Code session transcript.

Usage:
  token-meter <session.jsonl>          report for a specific session file
  token-meter --project <dir>          report for the latest session under <dir>
  token-meter --latest                 report for the latest session in the
                                       auto-resolved project dir (CLAUDE_PROJECT_DIR
                                       → cwd)
  token-meter help                     show this help

The four token fields (input, cache_creation_5m, cache_creation_1h, cache_read,
output) are always reported separately. Collapsing them into one number hides the
cost structure of prompt caching.

Exit codes: 0 success · 1 operational failure · 2 usage error
`.trim()

function die(msg, code = 1) {
  process.stderr.write(`token-meter: ${msg}\n`)
  process.exit(code)
}

async function main() {
  const { readFileSync, readdirSync, statSync } = await import('node:fs')
  const { homedir } = await import('node:os')
  const { resolve, join } = await import('node:path')

  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    console.log(HELP)
    process.exit(args.length === 0 ? 2 : 0)
  }

  let filePath

  if (args[0] === '--project') {
    const dir = args[1]
    if (!dir) die('--project requires a directory argument', 2)
    // dir is a project slug dir under ~/.claude/projects/
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ full: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (files.length === 0) die(`no .jsonl session files found in: ${dir}`)
    filePath = files[0].full
  } else if (args[0] === '--latest') {
    // Resolve project slug from cwd or CLAUDE_PROJECT_DIR
    const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd()
    const slug = projectRoot.replace(/\//g, '-').replace(/^-/, '')
    const projectsDir = join(homedir(), '.claude', 'projects', slug)
    let exists = false
    try { readdirSync(projectsDir); exists = true } catch {}
    if (!exists) die(`cannot find transcript directory: ${projectsDir}`)
    const files = readdirSync(projectsDir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ full: join(projectsDir, f), mtime: statSync(join(projectsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (files.length === 0) die(`no .jsonl session files found in: ${projectsDir}`)
    filePath = files[0].full
  } else {
    filePath = resolve(args[0])
  }

  let content
  try {
    content = readFileSync(filePath, 'utf8')
  } catch (err) {
    die(`cannot read file: ${filePath}\n  ${err.message}`)
  }

  const totals = parseTotals(content)
  console.log(formatReport(filePath, totals))
}

// Only run as CLI when this file is the direct entry point (not when imported).
import { fileURLToPath } from 'node:url'
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`token-meter: unexpected error: ${err.message}\n`)
    process.exit(1)
  })
}
