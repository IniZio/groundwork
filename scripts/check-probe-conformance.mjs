#!/usr/bin/env node
/**
 * scripts/check-probe-conformance.mjs
 *
 * Runs six structural conformance checks (SC-A1..SC-B2) against a target repository.
 * Prints one line per check: PASS|FAIL|UNKNOWN <id> <reason>
 * Exits 0 only when no check FAILs; exits 1 on any FAIL; exits 2 on usage error.
 *
 * Usage: node check-probe-conformance.mjs <repo-path>
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoPath = process.argv[2]
if (!repoPath) {
  process.stderr.write('Usage: check-probe-conformance.mjs <repo-path>\n')
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readText(p) {
  try { return readFileSync(p, 'utf8') } catch { return null }
}

/**
 * Recursively collect files matching pred, skipping node_modules / .git / dist / build.
 * @param {string} dir
 * @param {(fullPath: string, name: string) => boolean} pred
 * @param {string[]} out
 */
function findFiles(dir, pred, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'build') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) findFiles(full, pred, out)
    else if (pred(full, e.name)) out.push(full)
  }
  return out
}

/**
 * Recursively collect directories matching pred, skipping node_modules / .git.
 * @param {string} dir
 * @param {(fullPath: string, name: string) => boolean} pred
 * @param {string[]} out
 */
function findDirs(dir, pred, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (pred(full, e.name)) out.push(full)
      findDirs(full, pred, out)
    }
  }
  return out
}

/** Five-field waiver contract (D-18). */
const WAIVER_REQUIRED = ['dependency', 'failing_criterion', 'scope', 'expiry_condition', 'contract_test']

/** Identity-provider keywords for SC-B2 suppression. */
const IDP_KEYWORDS = ['authgear', 'keycloak', 'auth0', 'okta', 'oidc']

/**
 * Read waivers from two sources for a repo:
 *   1. <repo>/.groundwork/journal/*.jsonl  — events with type:"WAIVER", fields under `data`
 *   2. <repo>/.groundwork/waivers/*.json   — top-level fields (stacks.md Postmark shape)
 *
 * Returns { valid: waiver[], malformed: string[] } where malformed contains
 * the dependency name (or "(unknown)") of each waiver missing a required field.
 */
function readWaivers(repo) {
  const valid = []
  const malformed = []

  function process(fields) {
    const dep = (fields.dependency ?? '(unknown)')
    const hasAll = WAIVER_REQUIRED.every(k => {
      const v = fields[k]
      return v != null && String(v).trim() !== ''
    })
    if (hasAll) valid.push(fields)
    else malformed.push(dep)
  }

  // Source 1: journal JSONL events
  const journalDir = join(repo, '.groundwork', 'journal')
  let jFiles = []
  try { jFiles = readdirSync(journalDir).filter(f => f.endsWith('.jsonl')) } catch {}
  for (const f of jFiles) {
    const text = readText(join(journalDir, f))
    if (!text) continue
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t) continue
      try {
        const event = JSON.parse(t)
        if (event.type !== 'WAIVER') continue
        process(event.data ?? {})
      } catch { /* ignore parse errors */ }
    }
  }

  // Source 2: .groundwork/waivers/*.json files (stacks.md Postmark shape: fields at top level)
  const waiverDir = join(repo, '.groundwork', 'waivers')
  let wFiles = []
  try { wFiles = readdirSync(waiverDir).filter(f => f.endsWith('.json')) } catch {}
  for (const f of wFiles) {
    try {
      const data = JSON.parse(readFileSync(join(waiverDir, f), 'utf8'))
      process(data)
    } catch { /* ignore parse errors */ }
  }

  return { valid, malformed }
}

/**
 * Returns true if the docker-compose service name matches the waiver dependency
 * (case-insensitive whole-word match — handles "Postmark transactional-email API" ↔ "postmark").
 */
function serviceMatchesWaiver(serviceName, waiverDep) {
  try {
    const escaped = serviceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[-]')
    return new RegExp(`\\b${escaped}\\b`, 'i').test(waiverDep)
  } catch { return false }
}

/** Returns true if the waiver covers an identity provider (suppresses SC-B2). */
function waiverIsIdentityProvider(waiver) {
  if (waiver.role === 'identity-provider') return true
  const dep = (waiver.dependency ?? '').toLowerCase()
  return IDP_KEYWORDS.some(k => dep.includes(k))
}

// ---------------------------------------------------------------------------
// SC-A1: Toolchain-enforced module boundaries (D-12 data-driven recognizer table)
//
// Table layout: each entry describes one recognizable enforcer.
//   detect(repo) → true when the enforcer evidence is present.
// Resolution:
//   Any entry matches → PASS
//   No entry matches, but package.json or go.mod present → FAIL
//   No stack detected at all → UNKNOWN (not a failure)
// ---------------------------------------------------------------------------

const ENFORCER_TABLE = [
  {
    name: 'nestjs-modules',
    description: 'NestJS @Module( decorators in src/',
    detect(repo) {
      // Recognized when any package.json in the tree mentions @nestjs/core
      const pkgFiles = findFiles(repo, (_, n) => n === 'package.json')
      const hasNestJS = pkgFiles.some(p => readText(p)?.includes('@nestjs/core'))
      if (!hasNestJS) return false
      // Enforcer evidence: @Module( decorator present in any .ts file
      return findFiles(repo, f => f.endsWith('.ts')).some(f => readText(f)?.includes('@Module('))
    },
  },
  {
    name: 'go-internal',
    description: 'Go internal/ package directories',
    detect(repo) {
      if (!existsSync(join(repo, 'go.mod'))) return false
      return findDirs(repo, (_, n) => n === 'internal').length > 0
    },
  },
  {
    name: 'dependency-cruiser',
    description: 'dependency-cruiser config file',
    detect(repo) {
      const candidates = [
        '.dependency-cruiser.js', '.dependency-cruiser.cjs', '.dependency-cruiser.mjs',
        '.dependency-cruiser.json', '.dependency-cruiser.yaml', '.dependency-cruiser.yml',
      ]
      return candidates.some(c => existsSync(join(repo, c)))
    },
  },
  {
    name: 'eslint-boundaries',
    description: 'eslint-plugin-boundaries config',
    detect(repo) {
      const candidates = [
        '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.mjs', '.eslintrc.json',
        '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc',
        'eslint.config.js', 'eslint.config.cjs', 'eslint.config.mjs',
      ]
      return candidates.some(c => {
        const text = readText(join(repo, c))
        return text != null && text.includes('boundaries')
      })
    },
  },
]

function checkSCA1() {
  const match = ENFORCER_TABLE.find(e => e.detect(repoPath))
  if (match) return { result: 'PASS', reason: `enforcer detected: ${match.description}` }

  const hasStack =
    findFiles(repoPath, (_, n) => n === 'package.json').length > 0 ||
    existsSync(join(repoPath, 'go.mod'))

  if (hasStack) {
    return { result: 'FAIL', reason: 'recognized stack (package.json or go.mod) but no toolchain-enforced module boundary found' }
  }
  return { result: 'UNKNOWN', reason: 'no package.json or go.mod; unrecognized stack' }
}

// ---------------------------------------------------------------------------
// SC-A2: No route/controller handler file importing ≥3 distinct concern namespaces
//
// Concern namespaces: auth, session, render/view, audit, authorization/policy, storage
// Checked on files under routes/, controllers/, or named *.controller.* / *.router.* / *.routes.*
// ---------------------------------------------------------------------------

const CONCERN_NAMESPACES = [
  { name: 'auth',          pattern: /[/\\](auth|authentication)[/\\]/i },
  { name: 'session',       pattern: /[/\\]session[/\\]/i },
  { name: 'render',        pattern: /[/\\](render|view|template)[/\\]/i },
  { name: 'audit',         pattern: /[/\\]audit[/\\]/i },
  { name: 'authorization', pattern: /[/\\](authori[sz]ation|policy|permission)[/\\]/i },
  { name: 'storage',       pattern: /[/\\](storage|repository|repositories)[/\\]/i },
]

function extractImportPaths(content) {
  const paths = []
  const re = /(?:from\s+['"](.+?)['"]|require\s*\(\s*['"](.+?)['"]\s*\))/g
  let m
  while ((m = re.exec(content)) !== null) paths.push(m[1] ?? m[2])
  return paths
}

function countConcernNamespaces(importPaths) {
  const found = new Set()
  for (const p of importPaths) {
    for (const ns of CONCERN_NAMESPACES) {
      if (ns.pattern.test(p)) found.add(ns.name)
    }
  }
  return found
}

function isControllerFile(fullPath, name) {
  if (/\.(controller|router|routes?|handler)\.(ts|js|mjs)$/.test(name)) return true
  return /[/\\](routes?|controllers?|router)[/\\]/.test(fullPath) && /\.(ts|js|mjs)$/.test(name)
}

function checkSCA2() {
  const files = findFiles(repoPath, isControllerFile)
  for (const f of files) {
    const content = readText(f)
    if (!content) continue
    const concerns = countConcernNamespaces(extractImportPaths(content))
    if (concerns.size >= 3) {
      return {
        result: 'FAIL',
        reason: `${f} imports ${concerns.size} distinct concern namespaces (${[...concerns].join(', ')})`,
      }
    }
  }
  return { result: 'PASS', reason: 'no route/controller handler imports ≥3 distinct concern namespaces' }
}

// ---------------------------------------------------------------------------
// SC-A3: No optional (?:) fields on load-bearing wiring option types
//
// Types whose name matches /Options|Config|Deps/ must not have ?-optional fields.
// Uses line-by-line parsing with brace-depth tracking to find type bodies.
// ---------------------------------------------------------------------------

function isTestFile(fullPath) {
  if (/\.(spec|test)\.(ts|js|mjs)$/.test(fullPath)) return true
  return /[/\\](__tests__|tests?|features)[/\\]/.test(fullPath)
}

/**
 * Returns true when a TypeScript type string is a primitive or literal union:
 * boolean, number, string, bigint, null, undefined, void, any, unknown, never,
 * string/number/boolean literals, and arrays or unions of those.
 * Anything referencing a named class, interface, callback, or generic is non-primitive.
 */
function isPrimitiveType(typeStr) {
  const t = typeStr.replace(/;$/, '').trim()
  const ATOM = /^(?:boolean|number|string|bigint|null|undefined|void|any|unknown|never|true|false|'[^']*'|"[^"]*"|`[^`]*`|\d+(?:\.\d+)?)(?:\[\])?$/
  return t.split(/\s*\|\s*/).every(part => ATOM.test(part.trim()))
}

function checkSCA3() {
  const tsFiles = findFiles(repoPath, (f) => f.endsWith('.ts') && !isTestFile(f))
  const violations = []
  for (const f of tsFiles) {
    const content = readText(f)
    if (!content) continue
    const lines = content.split('\n')
    let inTargetType = false
    let braceDepth = 0
    for (const line of lines) {
      if (!inTargetType) {
        if (/(?:interface|type)\s+\w*(?:Options|Config|Deps)\w*/.test(line)) {
          inTargetType = true
          braceDepth = 0
        }
      }
      if (inTargetType) {
        for (const ch of line) {
          if (ch === '{') braceDepth++
          else if (ch === '}') {
            braceDepth--
            if (braceDepth <= 0) { inTargetType = false; break }
          }
        }
        if (inTargetType && /^\s*\w+\?\s*:/.test(line)) {
          const fieldMatch = line.match(/\w+\?\s*:\s*(.+?)(?:\s*;)?\s*$/)
          const typeStr = fieldMatch?.[1]?.trim() ?? ''
          if (typeStr && isPrimitiveType(typeStr)) continue // optional primitive — allowed
          const nameMatch = line.match(/(\w+\?)/)
          violations.push(`${nameMatch?.[1] ?? '?'}: ${typeStr} (in ${f})`)
        }
      }
    }
  }
  if (violations.length === 0) {
    return { result: 'PASS', reason: 'no optional non-primitive fields on load-bearing wiring option types' }
  }
  return {
    result: 'FAIL',
    reason: `optional non-primitive fields in Options/Config/Deps types: ${violations.join('; ')} (verify the absent-case default: fail-closed is acceptable)`,
  }
}

// ---------------------------------------------------------------------------
// SC-A4: Acceptance/e2e tests import the production entrypoint
//
// Isolated controller unit specs using Test.createTestingModule are legitimate;
// only the acceptance layer is checked here.
//
// Resolution:
//   No acceptance/e2e/feature files found → UNKNOWN (SC-B1 handles missing layer)
//   At least one acceptance file imports the production entrypoint → PASS
//   Acceptance layer exists but none import the production entrypoint → FAIL
// ---------------------------------------------------------------------------

const PRODUCTION_ENTRYPOINT_PATTERNS = [
  /app\.module/i,
  /AppModule\b/,
  /app\/main/i,
  /['"]\.\.\/?.*main['"]/i,
  /\bcreateApp\s*\(/,
  /\bbootstrap\s*\(/,
]

function checkSCA4() {
  const acceptanceFiles = findFiles(repoPath, isE2eTestFile)
  if (acceptanceFiles.length === 0) {
    return { result: 'UNKNOWN', reason: 'no acceptance/e2e/feature test files found; SC-B1 covers this gap' }
  }
  const importsProduction = acceptanceFiles.some(f =>
    PRODUCTION_ENTRYPOINT_PATTERNS.some(p => p.test(readText(f) ?? '')))
  if (importsProduction) {
    return { result: 'PASS', reason: 'at least one acceptance test imports the production entrypoint' }
  }
  return {
    result: 'FAIL',
    reason: 'acceptance/e2e tests found but none import the production entrypoint (AppModule / app factory)',
  }
}

// ---------------------------------------------------------------------------
// SC-B1: docker-compose exists AND acceptance/e2e tests reference it or its services
//
// A WAIVER at .groundwork/waivers/*.json with {dependency, criterion:"SC-B1",...}
// suppresses only its named dependency.
// ---------------------------------------------------------------------------

function parseServiceNames(composeContent) {
  const names = []
  const lines = composeContent.split('\n')
  let inServices = false
  for (const line of lines) {
    if (/^services\s*:/.test(line)) { inServices = true; continue }
    // Any non-indented non-empty line ends the services block
    if (inServices && line.trim() !== '' && !/^\s/.test(line)) inServices = false
    if (inServices) {
      // Top-level keys under services: exactly 2-space indent
      const m = line.match(/^  ([\w-]+)\s*:/)
      if (m) names.push(m[1])
    }
  }
  return names
}

function isE2eTestFile(fullPath, name) {
  if (/\.(e2e|acceptance|feature|integration)\.(test|spec)\.(ts|js|mjs)$/.test(name)) return true
  if (/[/\\](e2e|acceptance|features?|integration)[/\\]/.test(fullPath) && /\.(ts|js|mjs)$/.test(name)) return true
  return false
}

function checkSCB1() {
  const composePath =
    existsSync(join(repoPath, 'docker-compose.yml')) ? join(repoPath, 'docker-compose.yml') :
    existsSync(join(repoPath, 'docker-compose.yaml')) ? join(repoPath, 'docker-compose.yaml') :
    null

  if (!composePath) {
    return { result: 'FAIL', reason: 'no docker-compose.yml found; no real-service acceptance layer' }
  }

  const composeContent = readText(composePath) ?? ''
  const serviceNames = parseServiceNames(composeContent)

  const e2eFiles = findFiles(repoPath, isE2eTestFile)
  if (e2eFiles.length === 0) {
    return { result: 'FAIL', reason: 'docker-compose.yml exists but no e2e/acceptance test suite found' }
  }

  const allContent = e2eFiles.map(f => readText(f) ?? '').join('\n')
  const refsCompose = allContent.includes('docker-compose')

  const { valid: waivers, malformed } = readWaivers(repoPath)
  const malformedNote = malformed.length > 0
    ? `; ignored malformed waiver for ${malformed.join(', ')}`
    : ''

  // A service is covered when: all tests reference docker-compose directly, OR its
  // hostname appears in test content, OR a valid waiver matches it.
  const uncovered = serviceNames.filter(s =>
    !refsCompose &&
    !allContent.includes(s) &&
    !waivers.some(w => serviceMatchesWaiver(s, w.dependency ?? '')))

  if (uncovered.length === 0) {
    const waivedNames = serviceNames
      .filter(s => !refsCompose && !allContent.includes(s) &&
        waivers.some(w => serviceMatchesWaiver(s, w.dependency ?? '')))
    const detail = refsCompose
      ? 'docker-compose file reference'
      : `service hostnames: ${serviceNames.filter(s => allContent.includes(s)).join(', ')}`
    const waivedNote = waivedNames.length > 0 ? `; waived: ${waivedNames.join(', ')}` : ''
    return { result: 'PASS', reason: `acceptance tests reference ${detail}${waivedNote}${malformedNote}` }
  }

  return {
    result: 'FAIL',
    reason: `docker-compose.yml exists but acceptance tests do not cover all services (uncovered: ${uncovered.join(', ')})${malformedNote}`,
  }
}

// ---------------------------------------------------------------------------
// SC-B2: Auth in acceptance tests is the real service, not a synthetic JWT
//
// FAIL if e2e/acceptance tests contain patterns indicating hand-crafted tokens
// sent to auth-guarded endpoints (jwt.sign with test secret, hardcoded bearer
// tokens marked localfixture/test-secret, etc.).
// ---------------------------------------------------------------------------

const SYNTHETIC_AUTH_PATTERNS = [
  /jwt\.sign\s*\(/,
  /sign\s*\([^)]*(?:test[_-]?secret|secret[_-]?test|localfixture|test[_-]?key)/i,
  /Authorization['":\s]+Bearer\s+localfixture/i,
  /test[_-]?jwt[_-]?secret/i,
  /fake[_-]?token|stub[_-]?token|mock[_-]?bearer/i,
]

function checkSCB2() {
  const e2eFiles = findFiles(repoPath, isE2eTestFile)
  if (e2eFiles.length === 0) {
    return { result: 'PASS', reason: 'no acceptance/e2e test files found; check not applicable' }
  }
  for (const f of e2eFiles) {
    const content = readText(f)
    if (!content) continue
    for (const p of SYNTHETIC_AUTH_PATTERNS) {
      if (p.test(content)) {
        // An identity-provider waiver suppresses SC-B2 (IDP stubbed by recorded waiver decision)
        const { valid: waivers } = readWaivers(repoPath)
        const idpWaiver = waivers.find(w => waiverIsIdentityProvider(w))
        if (idpWaiver) {
          return {
            result: 'PASS',
            reason: `synthetic auth suppressed by identity-provider waiver for ${idpWaiver.dependency}`,
          }
        }
        return {
          result: 'FAIL',
          reason: `${f} injects a synthetic bearer token (pattern: ${p.source.slice(0, 50)})`,
        }
      }
    }
  }
  return { result: 'PASS', reason: 'no synthetic JWT injection detected in acceptance/e2e tests' }
}

// ---------------------------------------------------------------------------
// Run all checks
// ---------------------------------------------------------------------------

let hasFail = false

function run(id, fn) {
  const { result, reason } = fn()
  process.stdout.write(`${result} ${id} ${reason}\n`)
  if (result === 'FAIL') hasFail = true
}

run('SC-A1', checkSCA1)
run('SC-A2', checkSCA2)
run('SC-A3', checkSCA3)
run('SC-A4', checkSCA4)
run('SC-B1', checkSCB1)
run('SC-B2', checkSCB2)

process.exit(hasFail ? 1 : 0)
