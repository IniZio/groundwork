import { readdirSync, existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { readRecentSubjects } from './derive-convention.mjs'
import {
  lintCommitMessage,
  readConfigPreset,
  SCOPE_PATTERN,
  PRESET_BODY_ONLY,
  PRESET_CONVENTIONAL,
  PRESET_HANDBOOK,
} from '../../plugins/house-rules/rules/commit-message/lint.mjs'

export { SCOPE_PATTERN } from '../../plugins/house-rules/rules/commit-message/lint.mjs'

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

function getMarketplacePluginNames(repoRoot) {
  try {
    const root = repoRoot ?? resolveRepoRoot()
    const raw = readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8')
    const parsed = JSON.parse(raw)
    const plugins = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.plugins) ? parsed.plugins : [])
    return plugins.map((p) => p.name).filter(Boolean)
  } catch {
    return []
  }
}

const DERIVE_MIN_SAMPLE = 10
const DERIVE_THRESHOLD = 0.85

function derivePreset(repoRoot) {
  if (!repoRoot) return PRESET_HANDBOOK
  try {
    const subjects = readRecentSubjects(repoRoot)
    if (!subjects || subjects.length < DERIVE_MIN_SAMPLE) return PRESET_HANDBOOK
    const sample = subjects.slice(0, 30)
    const n = sample.filter(s => lintCommitMessage(s, { preset: PRESET_CONVENTIONAL }).violations.length === 0).length
    return n / sample.length >= DERIVE_THRESHOLD ? PRESET_CONVENTIONAL : PRESET_HANDBOOK
  } catch {
    return PRESET_HANDBOOK
  }
}

export function lintMessage(text, opts) {
  const stripped = stripAttribution(text)
  const repoRoot = opts?.repoRoot ?? null

  let preset
  if (repoRoot && hasOwnCommitTemplate(repoRoot)) {
    preset = PRESET_BODY_ONLY
  } else if (repoRoot && existsSync(join(repoRoot, '.house-rules.json'))) {
    preset = readConfigPreset(repoRoot)
  } else {
    preset = derivePreset(repoRoot)
  }

  const violations = []
  const lines = stripped.split('\n')

  const { violations: presetViolations } = lintCommitMessage(stripped, { preset })
  for (const v of presetViolations) {
    violations.push({ line: v.line, reason: v.reason })
  }

  lines.forEach((line, idx) => {
    for (const { pattern, label } of PROCESS_VOCAB_DENYLIST) {
      if (pattern.test(line)) {
        violations.push({ line: idx + 1, reason: `contains ${label}` })
      }
    }
  })

  const allSlugs = opts?.motiveSlugs ?? getMotiveSlugs(opts?.repoRoot)
  const pluginNames = new Set(getMarketplacePluginNames(opts?.repoRoot))
  const slugs = allSlugs.filter((s) => !pluginNames.has(s))
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
