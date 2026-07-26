#!/usr/bin/env node
/**
 * spec-steer.mjs — `spec steer <concept-path>` subcommand
 *
 * Prints the resolved steering ancestry for a concept, bottom-up (most
 * specific first, then parent concepts, then root). Warns if the chain
 * exceeds 4000 tokens.
 *
 * NEVER writes to docs/steering/. Opens all steering files read-only.
 * The sole write path to docs/steering/ is the spec-guard governed one
 * established by T4.
 *
 * Exit codes: 0 success  1 operational failure  2 usage error
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Token estimation — same formula as hooks/lib/doc-io.mjs
// ---------------------------------------------------------------------------

/**
 * Estimate token count of a string.
 * Uses Math.ceil(utf8-byte-length / 3.5) — same ratio as doc-io.mjs line ~45.
 * This is an estimate, not a tokenizer count.
 */
function estimateTokens(content) {
  return Math.ceil(Buffer.byteLength(content ?? '', 'utf8') / 3.5)
}

// ---------------------------------------------------------------------------
// Steering directory helpers
// ---------------------------------------------------------------------------

/**
 * Find the project root by walking up from the hooks dir.
 * Returns the directory containing hooks/ (the project root).
 */
function findProjectRoot() {
  // hooks/spec-steer.mjs lives in <projectRoot>/hooks/
  return dirname(dirname(fileURLToPath(import.meta.url)))
}

/**
 * Return the top-level docs/steering/ path.
 */
function steeringDirPath(projectDir) {
  return join(projectDir, 'docs', 'steering')
}

/**
 * Read all markdown files directly under docs/steering/ (non-recursive).
 * AC 2: only top-level files, no subdirectory recursion.
 * AC 8: read-only.
 *
 * Returns an array of { relName, absPath, content } sorted alphabetically.
 */
function readTopLevelSteeringFiles(steeringDir) {
  if (!existsSync(steeringDir)) return []
  const entries = readdirSync(steeringDir)
  const files = []
  for (const name of entries.sort()) {
    const absPath = join(steeringDir, name)
    // Non-recursive: skip subdirectories. AC 2.
    try {
      if (statSync(absPath).isDirectory()) continue
    } catch {
      continue
    }
    if (!name.endsWith('.md')) continue
    let content
    try {
      content = readFileSync(absPath, 'utf8') // read-only open
    } catch {
      continue
    }
    files.push({ relName: name, absPath, content })
  }
  return files
}

/**
 * Read steering files for a specific concept directory under docs/steering/.
 * E.g. docs/steering/<concept>/*.md (non-recursive, only direct children).
 * AC 8: read-only.
 */
function readConceptSteeringFiles(steeringDir, conceptPath) {
  const conceptDir = join(steeringDir, conceptPath)
  if (!existsSync(conceptDir)) return []
  try {
    if (!statSync(conceptDir).isDirectory()) return []
  } catch {
    return []
  }
  const entries = readdirSync(conceptDir)
  const files = []
  for (const name of entries.sort()) {
    const absPath = join(conceptDir, name)
    try {
      if (statSync(absPath).isDirectory()) continue
    } catch {
      continue
    }
    if (!name.endsWith('.md')) continue
    let content
    try {
      content = readFileSync(absPath, 'utf8')
    } catch {
      continue
    }
    files.push({ relName: `${conceptPath}/${name}`, absPath, content })
  }
  return files
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const ANCESTRY_TOKEN_WARN = 4000

function usage() {
  process.stdout.write(`Usage: spec steer <concept-path>

  Print the resolved steering ancestry for <concept-path>, bottom-up
  (most specific first). Warns if the chain exceeds ${ANCESTRY_TOKEN_WARN} tokens.

  <concept-path> is a concept name (e.g. "orchestration") or "." for root.

  Steering files are opened read-only; this command never writes to docs/steering/.

Exit codes: 0 success  1 operational failure  2 usage error
`)
}

const argv = process.argv.slice(2)
const helpFlag = argv.includes('--help') || argv.includes('-h')

if (helpFlag || argv.length === 0) {
  usage()
  process.exit(helpFlag ? 0 : 2)
}

const conceptPath = argv[0]
const projectDir = process.env.GROUNDWORK_PROJECT_DIR ?? findProjectRoot()
const steeringDir = steeringDirPath(projectDir)

if (!existsSync(steeringDir)) {
  process.stderr.write(`spec steer: steering directory not found: ${steeringDir}\n`)
  process.exit(1)
}

// Resolve the ancestry: concept-specific files first (most specific),
// then top-level files (root, always applies).
const ancestryBlocks = []

// 1. If a concept path was given (not "."), look for concept-specific steering.
const normalizedConcept = conceptPath === '.' ? '' : conceptPath.replace(/^\/+|\/+$/g, '')
if (normalizedConcept) {
  const conceptFiles = readConceptSteeringFiles(steeringDir, normalizedConcept)
  if (conceptFiles.length > 0) {
    ancestryBlocks.push({
      label: `## Concept steering: ${normalizedConcept}`,
      files: conceptFiles,
    })
  }
}

// 2. Top-level (root) steering — always included.
const topLevelFiles = readTopLevelSteeringFiles(steeringDir)
if (topLevelFiles.length > 0) {
  ancestryBlocks.push({
    label: '## Root steering (docs/steering/)',
    files: topLevelFiles,
  })
}

if (ancestryBlocks.length === 0) {
  process.stdout.write('No steering documents found.\n')
  process.exit(0)
}

// Render bottom-up (ancestryBlocks[0] is most specific).
const parts = []
for (const block of ancestryBlocks) {
  parts.push(block.label)
  for (const f of block.files) {
    parts.push(`\n### ${f.relName}\n`)
    parts.push(f.content.trim())
  }
  parts.push('')
}

const rendered = parts.join('\n')
process.stdout.write(rendered + '\n')

// Warn if total exceeds 4000 tokens. AC 4.
const totalTokens = estimateTokens(rendered)
if (totalTokens > ANCESTRY_TOKEN_WARN) {
  process.stderr.write(
    `⚠ Warning: steering ancestry for "${conceptPath}" is ${totalTokens} estimated tokens ` +
    `(limit: ${ANCESTRY_TOKEN_WARN}). Consider trimming steering documents.\n`,
  )
}
