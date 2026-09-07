import { readdirSync, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  MIN_PASS_RATE,
  MIN_SAMPLE_SIZE,
  RULE_GROUPS,
  SAMPLE_SIZE,
  checkMessage,
  deriveConvention,
  describeRules,
  readRecentMessages,
  validateRulesPerGroup,
} from './derive-convention.mjs'

export const COMMIT_TYPES = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'chore', 'revert',
]

export const SCOPE_PATTERN = /^[a-zA-Z0-9._,\-]+$/

export const SUBJECT_CAP = 72

export const BODY_MAX_LINES = 0

export const ATTRIBUTION_TRAILER_PATTERNS = [
  /^Co-Authored-By:.*(?:Claude|Anthropic|claude\.ai|anthropic\.com).*$/im,
  /^Claude-Session:.*$/im,
  /^Generated with Claude Code.*$/im,
]

export const PROCESS_VOCAB_DENYLIST = [
  { pattern: /gate cycle/i,       label: 'process vocabulary: "gate cycle"' },
  { pattern: /dogfood cleanup/i,  label: 'process vocabulary: "dogfood cleanup"' },
  { pattern: /advisor APPROVE/i,  label: 'process vocabulary: "advisor APPROVE"' },
  { pattern: /\bT\d+\b/,         label: 'process vocabulary: slice id (e.g. T4)' },
  { pattern: /\bD-\d+\b/,        label: 'process vocabulary: decision id (e.g. D-7)' },
]

// Groundwork's own convention as a rule set, so the per-rule oracle measures the exact
// grammar and body policy that lintMessage below enforces — one checker, not two.
export const GROUNDWORK_RULES = {
  shape: 'type-scope',
  types: COMMIT_TYPES,
  scopes: null,
  bodyPermitted: false,
  bodyMaxLines: BODY_MAX_LINES,
  bodySectionDeclared: false,
  templatePath: null,
  breakingMarker: true,
  scopePattern: SCOPE_PATTERN,
  subjectCap: SUBJECT_CAP,
}

const GROUP_LABELS = {
  subjectShape: 'subject shape',
  subjectCap: 'subject length',
  body: 'body policy',
}

export function stripAttribution(text) {
  let stripped = String(text ?? '')
  for (const pattern of ATTRIBUTION_TRAILER_PATTERNS) {
    stripped = stripped.replace(
      new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'),
      '',
    )
  }
  return stripped.replace(/\n+$/, '').trimEnd()
}

export function resolveRepoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: cwd ?? process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null
  } catch {
    return null
  }
}

export function hasOwnCommitTemplate(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot === '') return false
  return existsSync(join(repoRoot, '.gitmessage'))
}

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

export function isGroundworkOwnRepo(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot === '') return false
  if (MODULE_DIR === join(repoRoot, 'hooks', 'lib')) return true
  return resolveRepoRoot(MODULE_DIR) === repoRoot
}

const hostRulesCache = new Map()

function validateGroundworkConvention(repoRoot) {
  const messages = readRecentMessages(repoRoot, SAMPLE_SIZE)
  if (messages === null) {
    return {
      applies: true,
      rules: null,
      reason: "commit history could not be read, so groundwork's convention cannot be validated here",
    }
  }
  const perGroup = validateRulesPerGroup(GROUNDWORK_RULES, messages.map(stripAttribution))
  if (!perGroup.enoughHistory) {
    return {
      applies: true,
      rules: null,
      reason: `only ${perGroup.sampled} usable commits sampled; ${MIN_SAMPLE_SIZE} are needed to validate a convention`,
      perGroup,
    }
  }
  const shape = perGroup.groups.subjectShape
  // Subject shape is load-bearing: without it the length and body measurements score
  // messages the convention does not even claim to describe, so nothing is enforced.
  if (!shape.ok) {
    return {
      applies: true,
      rules: null,
      reason: `groundwork's subject convention matches only ${(shape.passRate * 100).toFixed(1)}% of this repository's own recent commits (threshold ${(MIN_PASS_RATE * 100).toFixed(0)}%)`,
      perGroup,
    }
  }
  const enforce = RULE_GROUPS.filter((g) => perGroup.groups[g].ok)
  const dropped = RULE_GROUPS.filter((g) => !perGroup.groups[g].ok)
  const enforced = enforce.map((g) => GROUP_LABELS[g]).join(', ')
  const droppedText = dropped
    .map((g) => `${GROUP_LABELS[g]} (${perGroup.groups[g].passed}/${perGroup.groups[g].sampled})`)
    .join(', ')
  return {
    applies: false,
    rules: { ...GROUNDWORK_RULES, enforce },
    reason: dropped.length === 0
      ? `groundwork's convention confirmed against ${shape.passed}/${shape.sampled} recent commits`
      : `groundwork's convention confirmed for ${enforced} against ${shape.sampled} recent commits; not enforced here: ${droppedText}`,
    perGroup,
  }
}

// Groundwork's own repository is excluded on purpose: its hardcoded rules are the source
// of truth that .gitmessage and the spec are checked against, so deriving them back out
// would let the two drift apart unnoticed. Every OTHER repository, template or not, must
// earn each rule imposed on it. applies:false means groundwork's convention (rules:null
// for its own repo, or a per-rule-validated subset elsewhere); applies:true with
// rules:null means universal-only — process vocabulary and motive slugs, nothing else.
export function resolveHostRules(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot === '') {
    return { applies: false, rules: null, reason: 'repository root could not be resolved' }
  }
  if (hostRulesCache.has(repoRoot)) return hostRulesCache.get(repoRoot)

  let result
  if (isGroundworkOwnRepo(repoRoot)) {
    result = { applies: false, rules: null, reason: "groundwork's own repository" }
  } else if (!hasOwnCommitTemplate(repoRoot)) {
    result = validateGroundworkConvention(repoRoot)
  } else {
    const derived = deriveConvention(repoRoot)
    result = { applies: true, rules: derived.rules, reason: derived.reason }
  }
  hostRulesCache.set(repoRoot, result)
  return result
}

export function clearHostRulesCache() {
  hostRulesCache.clear()
}

export function getMotiveSlugs(repoRoot) {
  try {
    const root = repoRoot ?? resolveRepoRoot()
    return readdirSync(join(root, '.groundwork', 'motives'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  } catch {
    return []
  }
}

export function lintMessage(text, opts) {
  const stripped = stripAttribution(text)

  const violations = []
  const lines = stripped.split('\n')
  const subject = lines[0] ?? ''
  const isAutoGenerated = /^\(fixup|squash\)! /i.test(subject)

  // A repo shipping its own .gitmessage has declared its convention in the canonical
  // place, so groundwork's rules give way to the ones derived from it.
  const host = opts?.repoRoot ? resolveHostRules(opts.repoRoot) : { applies: false, rules: null }
  const hostConvention = host.applies
  const effectiveRules = hostConvention ? host.rules : (host.rules ?? GROUNDWORK_RULES)

  if (effectiveRules) {
    for (const v of checkMessage(stripped, effectiveRules).violations) {
      if (v.group !== 'subject') {
        violations.push({ line: v.line, reason: v.reason })
        continue
      }
      if (isAutoGenerated) continue
      violations.push({
        line: v.line,
        reason: hostConvention
          ? `${v.reason} — this repository's convention: ${describeRules(effectiveRules)}`
          : `${v.reason} — subject must match type(scope)!: description, allowed types: ${COMMIT_TYPES.join(', ')}`,
      })
    }
  }

  lines.forEach((line, idx) => {
    for (const { pattern, label } of PROCESS_VOCAB_DENYLIST) {
      if (pattern.test(line)) {
        violations.push({ line: idx + 1, reason: `contains ${label}` })
      }
    }
  })

  const slugs = opts?.motiveSlugs ?? getMotiveSlugs(opts?.repoRoot)
  if (slugs.length > 0) {
    lines.forEach((line, idx) => {
      for (const slug of slugs) {
        const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        if (new RegExp(`\\b${escaped}\\b`).test(line)) {
          violations.push({
            line: idx + 1,
            reason: `contains motive slug "${slug}" — process vocabulary not for commit messages`,
          })
        }
      }
    })
  }

  return { stripped, violations }
}
