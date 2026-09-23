import { existsSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'

// GOVERNING RULE: this module may only ever NARROW what is rejected. Any parse
// failure, unrecognised shape, unreadable history or sub-threshold validation returns
// confident:false / rules:null, which callers MUST treat as universal-only enforcement.

export const SAMPLE_SIZE = 30

export const MIN_SAMPLE_SIZE = 10

// 0.85 sits in the gap between the two measured populations: correct derivations score
// 0.93-1.00 on real histories (legacy noise is the residue), mis-derivations 0.00-0.73.
export const MIN_PASS_RATE = 0.85

const MAX_REPORTED_FAILURES = 5

// Each rule clears the threshold on its own evidence, so a repo that writes bodies keeps
// subject enforcement and loses only the body rule.
export const RULE_GROUPS = ['subjectShape', 'subjectCap', 'body']



function enforcedGroups(rules) {
  return Array.isArray(rules?.enforce) ? rules.enforce : RULE_GROUPS
}

// Issue keys from branch tooling are hosting artefacts, outside any derived grammar;
// stripping them only ever accepts more, never less.
const SUBJECT_PREFIX_STRIPPERS = [
  /^\s+/,
  /^(?:[[(](?:[A-Z][A-Z0-9]{1,9}-\d+[\s,]*)+[\])]\s*)+/,
]

const SHAPE_TYPE_SCOPE = /^<?types?>?\s*\(\s*<?scopes?>?\s*\)\s*:\s+\S.*$/i
const SHAPE_SCOPE_ONLY = /^<?scopes?>?\s*:\s+\S.*$/i

const BARE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

const PIPE_ENUM = /^(types?|scopes?)\s*:\s*([A-Za-z0-9._-]+(?:\s*\|\s*[A-Za-z0-9._-]+)+)\s*$/i

const DASH_ENUM_ROW = /^\s*([A-Za-z0-9][A-Za-z0-9._-]{0,23})\s+[-–—]\s+\S.*$/

const MIN_ENUM_ROWS = 3

const BODY_SECTION_HEADING = /^[-=\s]*\[?\s*body\s*\]?[-=\s]*$/i

// Prohibition list: when a matching line also fires BODY_INVITATION_CUE, the
// invitation wins (fail open — a missed declaration is more severe than a missed prohibition).
const BODY_PROHIBITION =
  /\bno\s+body\b|\bwithout\s+(?:a\s+|the\s+)?body\b|\bomit\s+(?:the\s+|a\s+)?body\b|\bskip\s+(?:the\s+|a\s+)?body\b|\bleave\s+(?:it\s+)?blank\b|\bsubject\s+(?:line\s+)?only\b|\bno\s+prose\b|\bdo\s+not\s+(?:add|include|write)\s+(?:a\s+)?body\b|\bdon'?t\s+(?:add|include|write)\s+(?:a\s+)?body\b/i

const BODY_INVITATION_CUE =
  /\boptional\b|\bif\s+(?:needed|desired|necessary|applicable)\b|\bwhen\s+(?:needed|applicable)\b|\bmay\s+(?:add|include)\b|\bfeel\s+free\b/i

const BODY_PROSE_MENTION = /\bbody\b/i

function stripCommentMarker(line) {
  return line.replace(/^\s*#\s?/, '')
}

// Purely positional; no prose read. Line 1 holds the specimen even when all-commented.
function findSpecimenLine(lines) {
  for (const raw of lines) {
    const line = stripCommentMarker(raw).trim()
    if (line !== '') return line
  }
  return null
}

function parsePipeEnum(lines) {
  for (const raw of lines) {
    const line = stripCommentMarker(raw).trim()
    const m = PIPE_ENUM.exec(line)
    if (!m) continue
    const values = m[2].split('|').map((v) => v.trim()).filter(Boolean)
    if (values.length >= 2) return { field: m[1].toLowerCase().replace(/s$/, ''), values }
  }
  return null
}

function labelFieldAbove(lines, startIndex) {
  for (let i = startIndex - 1; i >= 0 && i >= startIndex - 3; i -= 1) {
    const prev = stripCommentMarker(lines[i]).toLowerCase()
    if (prev.trim() === '') continue
    if (/\bscopes?\b/.test(prev)) return 'scope'
    if (/\btypes?\b/.test(prev)) return 'type'
    return null
  }
  return null
}

function parseDashEnum(lines) {
  let best = null
  let run = []
  let runStart = -1

  const flush = () => {
    if (run.length >= MIN_ENUM_ROWS && (best === null || run.length > best.values.length)) {
      best = { values: run.slice(), startIndex: runStart }
    }
    run = []
    runStart = -1
  }

  lines.forEach((raw, idx) => {
    const line = stripCommentMarker(raw)
    const m = DASH_ENUM_ROW.exec(line)
    if (m) {
      if (run.length === 0) runStart = idx
      run.push(m[1])
    } else if (line.trim() !== '') {
      flush()
    }
  })
  flush()
  if (best === null) return null
  return { field: labelFieldAbove(lines, best.startIndex), values: best.values }
}

function detectBodySection(lines) {
  return lines.some((raw) => {
    const line = stripCommentMarker(raw).trim()
    if (BODY_SECTION_HEADING.test(line)) return true
    if (!BODY_PROSE_MENTION.test(line)) return false
    if (BODY_PROHIBITION.test(line)) return BODY_INVITATION_CUE.test(line)
    return true
  })
}

export function parseTemplate(text, templatePath) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const lines = text.split(/\r?\n/)

  const specimen = findSpecimenLine(lines)
  if (specimen === null) return null

  let shape = null
  if (SHAPE_TYPE_SCOPE.test(specimen)) shape = 'type-scope'
  else if (SHAPE_SCOPE_ONLY.test(specimen)) shape = 'scope-only'
  if (shape === null) return null

  const boundField = shape === 'type-scope' ? 'type' : 'scope'
  const enumeration = parsePipeEnum(lines) ?? parseDashEnum(lines)
  let types = null
  let scopes = null
  if (enumeration && (enumeration.field === null || enumeration.field === boundField)) {
    const values = enumeration.values.filter((v) => BARE_TOKEN.test(v))
    if (values.length >= 2) {
      if (boundField === 'type') types = values
      else scopes = values
    }
  }

  return {
    shape,
    types,
    scopes,
    // A derived host convention never forbids a body: the only evidence that could say
    // otherwise is free prose, and `true` is the maximally-narrowing choice regardless.
    bodyPermitted: true,
    bodySectionDeclared: detectBodySection(lines),
    templatePath: templatePath ?? null,
  }
}

export function normalizeSubject(subject) {
  let out = String(subject ?? '')
  for (const stripper of SUBJECT_PREFIX_STRIPPERS) out = out.replace(stripper, '')
  return out.trim()
}

// breakingMarker, scopePattern and subjectCap are inert on template-derived rules, which
// never set them; they exist so groundwork's own convention can be expressed AS a rule set.
export function checkSubject(subject, rules) {
  const groups = enforcedGroups(rules)
  const shapeOn = groups.includes('subjectShape')
  const capOn = groups.includes('subjectCap')
  const pass = { ok: true, reason: null }

  const normalized = normalizeSubject(subject)
  if (normalized === '') return shapeOn ? { ok: false, reason: 'empty subject' } : pass

  const m = /^([^:()]+?)(?:\(([^)]*)\))?(!?)\s*:\s+(\S.*)$/.exec(normalized)
  if (m === null) {
    if (!shapeOn) return pass
    return { ok: false, reason: `subject does not match "${describeShape(rules)}"` }
  }
  const [, head, paren, bang, rest] = m
  if (shapeOn && bang === '!' && rules.breakingMarker !== true) {
    return { ok: false, reason: `subject does not match "${describeShape(rules)}"` }
  }
  if (shapeOn && rest.trim() === '') return { ok: false, reason: 'subject text is empty' }
  if (capOn && typeof rules.subjectCap === 'number' && rest.length > rules.subjectCap) {
    return { ok: false, reason: `subject text is ${rest.length} characters; limit is ${rules.subjectCap}` }
  }
  if (!shapeOn) return pass

  const splitList = (v) => v.split(/[,+]/).map((s) => s.trim()).filter(Boolean)

  if (rules.shape === 'type-scope') {
    const type = head.trim()
    if (!BARE_TOKEN.test(type)) return { ok: false, reason: `"${type}" is not a valid type token` }
    if (rules.types && !rules.types.includes(type)) {
      return { ok: false, reason: `type "${type}" is not one of: ${rules.types.join(', ')}` }
    }
    if (paren !== undefined) {
      const scopes = splitList(paren)
      if (rules.scopePattern && scopes.length === 0) {
        return { ok: false, reason: 'empty scope in parentheses' }
      }
      for (const scope of scopes) {
        if (rules.scopePattern && !rules.scopePattern.test(scope)) {
          return { ok: false, reason: `"${scope}" is not a valid scope token` }
        }
        if (rules.scopes && !rules.scopes.includes(scope)) {
          return { ok: false, reason: `scope "${scope}" is not one of: ${rules.scopes.join(', ')}` }
        }
      }
    }
    return { ok: true, reason: null }
  }

  // Comma lists pass even under "choose one": accepting more cannot false-reject.
  const declared = splitList(head)
  if (declared.length === 0) return { ok: false, reason: 'missing scope' }
  for (const scope of declared) {
    if (!BARE_TOKEN.test(scope)) return { ok: false, reason: `"${scope}" is not a valid scope token` }
    if (rules.scopes && !rules.scopes.includes(scope)) {
      return { ok: false, reason: `scope "${scope}" is not one of: ${rules.scopes.join(', ')}` }
    }
  }
  return { ok: true, reason: null }
}

// The one message-level checker. The per-rule oracle scores history through it and every
// enforcer lints through it, so what is measured is exactly what is enforced.
export function checkMessage(message, rules) {
  const groups = enforcedGroups(rules)
  const violations = []
  const lines = String(message ?? '').split('\n')

  const verdict = checkSubject(lines[0] ?? '', rules)
  if (!verdict.ok) violations.push({ line: 1, group: 'subject', reason: verdict.reason })

  if (!groups.includes('body') || rules.bodyPermitted === true) return { violations }

  const maxBodyLines = typeof rules.bodyMaxLines === 'number' ? rules.bodyMaxLines : 0
  if (lines.length > 1 && lines[1] !== '') {
    violations.push({
      line: 2,
      group: 'body',
      reason: 'line 2 must be blank (the separator between subject and body)',
    })
  }
  if (lines.length > 2) {
    const bodyLines = lines.slice(2)
    const nonBlankBody = bodyLines.filter((l) => l.trim() !== '')
    if (nonBlankBody.length > maxBodyLines) {
      violations.push({
        line: 3,
        group: 'body',
        reason: `body has ${nonBlankBody.length} non-blank lines; limit is ${maxBodyLines}`,
      })
    }
    bodyLines.forEach((bodyLine, idx) => {
      if (/^\s*[-*•]\s/.test(bodyLine)) {
        violations.push({
          line: 3 + idx,
          group: 'body',
          reason: 'body lines must not use bullet markers (-, *, •); write plain prose',
        })
      }
    })
  }
  return { violations }
}

export function describeShape(rules) {
  return rules.shape === 'type-scope' ? 'type(scope): subject' : 'scope: subject'
}

export function describeRules(rules) {
  const parts = [`subject must look like "${describeShape(rules)}"`]
  if (rules.types) parts.push(`type is one of: ${rules.types.join(', ')}`)
  if (rules.scopes) parts.push(`scope is one of: ${rules.scopes.join(', ')}`)
  parts.push('a body is permitted')
  return parts.join('; ')
}

function usableSubjects(subjects) {
  return subjects
    .map((s) => String(s ?? '').trim())
    .filter((s) => s !== '')
    .filter((s) => !/^Revert\s+"/i.test(s))
    .filter((s) => !/^Merge\s+(branch|pull request|remote-tracking)\b/i.test(s))
}

export function validateRules(rules, subjects, minPassRate = MIN_PASS_RATE) {
  const sample = usableSubjects(subjects)
  const failures = []
  let passed = 0
  for (const subject of sample) {
    if (checkSubject(subject, rules).ok) passed += 1
    else if (failures.length < MAX_REPORTED_FAILURES) failures.push(subject)
  }
  const passRate = sample.length === 0 ? 0 : passed / sample.length
  return {
    sampled: sample.length,
    passed,
    passRate,
    threshold: minPassRate,
    enoughHistory: sample.length >= MIN_SAMPLE_SIZE,
    ok: sample.length >= MIN_SAMPLE_SIZE && passRate >= minPassRate,
    failures,
  }
}

function usableMessages(messages) {
  return messages
    .map((m) => String(m ?? ''))
    .filter((m) => m.trim() !== '')
    .filter((m) => usableSubjects([m.split('\n')[0] ?? '']).length === 1)
}

// Scores each rule group in isolation against the SAME full messages, reusing the shared
// threshold and minimum sample. A group that fails is simply not enforced.
export function validateRulesPerGroup(rules, messages, minPassRate = MIN_PASS_RATE) {
  const sample = usableMessages(messages)
  const enoughHistory = sample.length >= MIN_SAMPLE_SIZE
  const groups = {}
  for (const group of RULE_GROUPS) {
    const scoped = { ...rules, enforce: [group] }
    const failures = []
    let passed = 0
    for (const message of sample) {
      if (checkMessage(message, scoped).violations.length === 0) passed += 1
      else if (failures.length < MAX_REPORTED_FAILURES) failures.push(message.split('\n')[0] ?? '')
    }
    const passRate = sample.length === 0 ? 0 : passed / sample.length
    groups[group] = {
      sampled: sample.length,
      passed,
      passRate,
      threshold: minPassRate,
      enoughHistory,
      ok: enoughHistory && passRate >= minPassRate,
      failures,
    }
  }
  return { sampled: sample.length, enoughHistory, groups }
}

export function readRecentMessages(repoRoot, limit = SAMPLE_SIZE) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--first-parent', '--no-merges', `-${limit}`, '--pretty=format:%B%x00'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out
      .split('\0')
      .map((record) => record.replace(/^\n+/, '').replace(/\s+$/, ''))
      .filter((record) => record !== '')
  } catch {
    return null
  }
}

export function readRecentSubjects(repoRoot, limit = SAMPLE_SIZE) {
  try {
    const out = execFileSync(
      'git',
      ['log', '--first-parent', '--no-merges', `-${limit}`, '--pretty=format:%s'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    )
    return out.split('\n').filter((line) => line.trim() !== '')
  } catch {
    return null
  }
}

function fallback(reason, validation = null) {
  return { confident: false, rules: null, reason, validation }
}

export function deriveConvention(repoRoot, opts = {}) {
  const minPassRate = opts.minPassRate ?? MIN_PASS_RATE
  const templatePath = opts.templatePath ?? (repoRoot ? join(repoRoot, '.gitmessage') : null)

  let text = opts.templateText
  if (text === undefined) {
    if (templatePath === null || !existsSync(templatePath)) {
      return fallback('no .gitmessage template found')
    }
    try {
      text = readFileSync(templatePath, 'utf8')
    } catch {
      return fallback('.gitmessage could not be read')
    }
  }

  const rules = parseTemplate(text, templatePath)
  if (rules === null) {
    return fallback('.gitmessage does not present a recognised subject shape')
  }

  const subjects = opts.subjects ?? readRecentSubjects(repoRoot, opts.sampleSize ?? SAMPLE_SIZE)
  if (subjects === null) {
    return fallback('commit history could not be read, so the derivation cannot be validated')
  }

  const validation = validateRules(rules, subjects, minPassRate)
  if (!validation.enoughHistory) {
    return fallback(
      `only ${validation.sampled} usable commits sampled; ${MIN_SAMPLE_SIZE} are needed to validate a derivation`,
      validation,
    )
  }
  if (!validation.ok) {
    return fallback(
      `derived rules match only ${(validation.passRate * 100).toFixed(1)}% of this repository's own recent commits (threshold ${(minPassRate * 100).toFixed(0)}%)`,
      validation,
    )
  }

  return {
    confident: true,
    rules,
    reason: `derived from ${templatePath ?? '.gitmessage'} and confirmed against ${validation.passed}/${validation.sampled} recent commits`,
    validation,
  }
}
