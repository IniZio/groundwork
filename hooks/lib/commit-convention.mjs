import { readdirSync, existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  RULE_GROUPS,
  checkMessage,
  describeRules,
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

// The rules groundwork imposes on EVERY repository. They are stated, never inferred, so
// they have no inactive state: nothing a host template says can switch one of them off.
// Subject grammar is deliberately absent — that is the project template's business.
export const UNIVERSAL_RULE_STATEMENTS = [
  'Attribution trailers (Co-Authored-By: Claude, Claude-Session:, "Generated with Claude Code") are stripped automatically.',
  'No groundwork process vocabulary: gate cycle, dogfood cleanup, advisor APPROVE, slice ids (T4), decision ids (D-7), motive slugs.',
  'No commit body — subject line only. The diff shows what changed; the subject communicates intent.',
]

export const UNIVERSAL_RULES = {
  shape: 'type-scope',
  types: null,
  scopes: null,
  bodyPermitted: false,
  bodyMaxLines: 0,
  bodySectionDeclared: false,
  templatePath: null,
  breakingMarker: true,
  scopePattern: null,
  subjectCap: null,
  enforce: ['body'],
}

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

export function readCommitTemplate(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot === '') return null
  const path = join(repoRoot, '.gitmessage')
  if (!existsSync(path)) return null
  try {
    return { path, text: readFileSync(path, 'utf8') }
  } catch {
    return { path, text: null }
  }
}

// The whole active ruleset, assembled rather than inferred: the project's own template
// text plus groundwork's universal rules. Every field is present in every repository, so
// a caller can always read WHICH rules apply instead of guessing whether any did.
export function activeConvention(repoRoot) {
  const host = resolveHostRules(repoRoot)
  const own = isGroundworkOwnRepo(repoRoot)
  const template = readCommitTemplate(repoRoot)
  const rules = host.applies ? host.rules : (host.rules ?? GROUNDWORK_RULES)
  return {
    repoRoot: repoRoot ?? null,
    scope: own ? 'groundwork-own-repo' : 'host-repo',
    source: own
      ? "groundwork's own hardcoded convention (its .gitmessage mirrors it)"
      : template === null
        ? 'groundwork convention (no project .gitmessage to concatenate)'
        : 'project .gitmessage + groundwork universal rules',
    projectTemplate: template === null
      ? { path: null, text: null, note: 'no .gitmessage in this repository' }
      : template,
    universalRules: UNIVERSAL_RULE_STATEMENTS,
    bodyPermitted: rules?.bodyPermitted === true,
    enforcedGroups: Array.isArray(rules?.enforce) ? rules.enforce : RULE_GROUPS,
    reason: host.reason,
  }
}

// Rules are CONCATENATED, never derived. A host repository's .gitmessage supplies its own
// project convention as text an agent reads; groundwork's universal rules apply on top and
// are machine-enforced. Neither source can silently switch the other off, so there is no
// inactive state for a caller to mistake for permission. Subject grammar is never imposed
// on a host repo: groundwork does not guess a project's format from its template.
export function resolveHostRules(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot === '') {
    return { applies: false, rules: null, reason: 'repository root could not be resolved' }
  }
  if (hostRulesCache.has(repoRoot)) return hostRulesCache.get(repoRoot)

  let result
  const template = isGroundworkOwnRepo(repoRoot) ? null : readCommitTemplate(repoRoot)
  if (isGroundworkOwnRepo(repoRoot)) {
    result = { applies: false, rules: null, reason: "groundwork's own repository", template: null }
  } else if (template === null) {
    result = {
      applies: false,
      rules: null,
      reason: "no .gitmessage in this repository — groundwork's own convention applies in full",
      template: null,
    }
  } else {
    result = {
      applies: true,
      rules: UNIVERSAL_RULES,
      reason: `project convention in ${template.path} plus groundwork universal rules`,
      template,
    }
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
