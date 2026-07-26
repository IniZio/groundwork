#!/usr/bin/env node
/**
 * Groundwork feature ledger CLI — validate + resume for .feature.yaml.
 *
 * Subcommands:
 *   validate <path>  — schema + invariant check (exit 0/1)
 *   resume   <slug>  — validate + print resume briefing (exit 0/1)
 *
 * Hand-rolled validation (no ajv). Enums/patterns loaded from
 * skills/groundwork/feature/feature.schema.json so validator + schema
 * stay aligned. additionalProperties fail-closed at every object level.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { load as yamlLoad } from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const SCHEMA_PATH = path.join(REPO_ROOT, 'skills', 'groundwork', 'feature', 'feature.schema.json')

// ---------------------------------------------------------------------------
// Schema-driven constants (loaded once)
// ---------------------------------------------------------------------------

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'))

const STATUS_ENUM = new Set(schema.properties.status.enum)
const HEALTH_ENUM = new Set(schema.properties.health.enum)
const ID_PATTERN = new RegExp(schema.properties.id.pattern)
const SLUG_PATTERN = new RegExp(schema.properties.slug.pattern)
const AC_KEY_PATTERN = new RegExp(schema.properties.ac_coverage.propertyNames.pattern)
const SLICE_ID_PATTERN = new RegExp(schema.properties.ac_coverage.additionalProperties.items.pattern)
const ACTIVE_POINTER_PATTERN = /^(slice|milestone|ac):[A-Za-z0-9][A-Za-z0-9_.-]*$/
const HISTORY_TYPE_ENUM = new Set(schema.$defs.historyEvent.properties.type.enum)
const GATE_ADVISOR_ENUM = new Set(
  schema.$defs.gate.properties.advisor.enum.filter((v) => v !== null),
)
const RUN_GATE_ADVISOR_ENUM = new Set(
  schema.$defs.run.properties.gate_advisor.enum.filter((v) => v !== null),
)

const TOP_LEVEL_KEYS = new Set(Object.keys(schema.properties))
const RESUME_KEYS = new Set(Object.keys(schema.$defs.resume.properties))
const RUN_KEYS = new Set(Object.keys(schema.$defs.run.properties))
const HISTORY_KEYS = new Set(Object.keys(schema.$defs.historyEvent.properties))
const DECISION_KEYS = new Set(Object.keys(schema.$defs.decision.properties))
const LINKS_KEYS = new Set(Object.keys(schema.$defs.links.properties))
const GATE_KEYS = new Set(Object.keys(schema.$defs.gate.properties))

const REQUIRED_TOP = schema.required
const TERMINAL_STATUSES = new Set(['completed', 'canceled'])
const ACTIVE_STATUSES = new Set(['planned', 'started', 'paused'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write(String(msg).endsWith('\n') ? msg : `${msg}\n`)
  process.exit(code)
}

function usage(code = 0) {
  const text = `Usage:
  feature validate <path>   Validate a .feature.yaml (file or feature dir)
  feature resume   <slug>   Print resume briefing for .groundwork/features/<slug>

Exit codes: 0 ok, 1 invalid/error, 2 usage
`
  if (code === 0) process.stdout.write(text)
  else process.stderr.write(text)
  process.exit(code)
}


function resolveFeaturePath(inputPath) {
  const abs = path.resolve(inputPath)
  if (!existsSync(abs)) {
    throw Object.assign(new Error(`path not found: ${inputPath}`), { exitCode: 1 })
  }
  const st = statSync(abs)
  if (st.isDirectory()) {
    const yaml = path.join(abs, '.feature.yaml')
    if (existsSync(yaml)) return yaml
    const yml = path.join(abs, '.feature.yml')
    if (existsSync(yml)) return yml
    throw Object.assign(
      new Error(`no .feature.yaml in directory: ${inputPath}`),
      { exitCode: 1 },
    )
  }
  return abs
}

function loadFeatureYaml(filePath) {
  const raw = readFileSync(filePath, 'utf8')
  let doc
  try {
    doc = yamlLoad(raw)
  } catch (e) {
    throw Object.assign(new Error(`YAML parse error: ${e.message}`), { exitCode: 1 })
  }
  if (doc === null || doc === undefined || typeof doc !== 'object' || Array.isArray(doc)) {
    throw Object.assign(new Error('feature document must be a YAML mapping/object'), { exitCode: 1 })
  }
  return doc
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function typeName(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a feature document against the schema contract.
 * Returns { ok: true } or { ok: false, errors: string[] }.
 */
export function validateFeature(doc) {
  const errors = []
  const err = (field, reason) => errors.push(`${field}: ${reason}`)

  if (!isPlainObject(doc)) {
    return { ok: false, errors: ['$: document must be an object'] }
  }

  // additionalProperties: false at top level
  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      err(key, 'unrecognized field (additionalProperties: false)')
    }
  }

  // required top-level
  for (const key of REQUIRED_TOP) {
    if (!(key in doc) || doc[key] === undefined) {
      err(key, 'required field missing')
    }
  }

  // version === 1
  if ('version' in doc) {
    if (doc.version !== 1) {
      err('version', `must be const 1, got ${JSON.stringify(doc.version)}`)
    }
  }

  // id
  if ('id' in doc && doc.id !== undefined) {
    if (typeof doc.id !== 'string' || doc.id.length < 1) {
      err('id', `must be non-empty string, got ${typeName(doc.id)}`)
    } else if (!ID_PATTERN.test(doc.id)) {
      err('id', `must match ${ID_PATTERN}, got ${JSON.stringify(doc.id)}`)
    }
  }

  // slug
  if ('slug' in doc && doc.slug !== undefined) {
    if (typeof doc.slug !== 'string') {
      err('slug', `must be string, got ${typeName(doc.slug)}`)
    } else if (!SLUG_PATTERN.test(doc.slug)) {
      err('slug', `must match ${SLUG_PATTERN}, got ${JSON.stringify(doc.slug)}`)
    }
  }

  // active
  if ('active' in doc && doc.active !== undefined && typeof doc.active !== 'boolean') {
    err('active', `must be boolean, got ${typeName(doc.active)}`)
  }

  // status enum
  if ('status' in doc && doc.status !== undefined) {
    if (typeof doc.status !== 'string' || !STATUS_ENUM.has(doc.status)) {
      err(
        'status',
        `must be one of [${[...STATUS_ENUM].join(', ')}], got ${JSON.stringify(doc.status)}`,
      )
    }
  }

  // health enum
  if ('health' in doc && doc.health !== undefined) {
    if (typeof doc.health !== 'string' || !HEALTH_ENUM.has(doc.health)) {
      err(
        'health',
        `must be one of [${[...HEALTH_ENUM].join(', ')}], got ${JSON.stringify(doc.health)}`,
      )
    }
  }

  // optional nullable strings: plan_ref, spec_ref, branch, created_by_session
  for (const key of ['plan_ref', 'spec_ref', 'branch', 'created_by_session']) {
    if (key in doc && doc[key] !== undefined && doc[key] !== null) {
      if (typeof doc[key] !== 'string' || doc[key].length < 1) {
        err(key, `must be non-empty string or null, got ${typeName(doc[key])}`)
      }
    }
  }

  // created_at / updated_at
  for (const key of ['created_at', 'updated_at']) {
    if (key in doc && doc[key] !== undefined) {
      if (typeof doc[key] !== 'string' || doc[key].length < 1) {
        err(key, `must be non-empty string, got ${typeName(doc[key])}`)
      }
    }
  }

  // ac_coverage
  if ('ac_coverage' in doc && doc.ac_coverage !== undefined) {
    validateAcCoverage(doc.ac_coverage, err)
  }

  // resume
  if ('resume' in doc && doc.resume !== undefined) {
    validateResume(doc.resume, err)
  }

  // runs
  if ('runs' in doc && doc.runs !== undefined) {
    validateRuns(doc.runs, err)
  }

  // history
  if ('history' in doc && doc.history !== undefined) {
    validateHistory(doc.history, err)
  }

  // decisions (optional)
  if ('decisions' in doc && doc.decisions !== undefined) {
    validateDecisions(doc.decisions, err)
  }

  // links (optional)
  if ('links' in doc && doc.links !== undefined) {
    validateLinks(doc.links, err)
  }

  // gate (optional)
  if ('gate' in doc && doc.gate !== undefined) {
    validateGate(doc.gate, err)
  }

  // THE INVARIANT (oneOf) — only when status + resume are present enough to judge
  if (
    typeof doc.status === 'string' &&
    STATUS_ENUM.has(doc.status) &&
    isPlainObject(doc.resume)
  ) {
    validateInvariant(doc, err)
  }

  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors }
}

function validateAcCoverage(ac, err) {
  if (!isPlainObject(ac)) {
    err('ac_coverage', `must be object, got ${typeName(ac)}`)
    return
  }
  for (const [key, val] of Object.entries(ac)) {
    if (!AC_KEY_PATTERN.test(key)) {
      err(`ac_coverage.${key}`, `key must match ${AC_KEY_PATTERN}`)
    }
    if (!Array.isArray(val)) {
      err(`ac_coverage.${key}`, `must be array of slice ids, got ${typeName(val)}`)
      continue
    }
    const seen = new Set()
    for (let i = 0; i < val.length; i++) {
      const s = val[i]
      if (typeof s !== 'string' || s.length < 1) {
        err(`ac_coverage.${key}[${i}]`, `must be non-empty string, got ${typeName(s)}`)
        continue
      }
      if (!SLICE_ID_PATTERN.test(s)) {
        err(`ac_coverage.${key}[${i}]`, `must match ${SLICE_ID_PATTERN}, got ${JSON.stringify(s)}`)
      }
      if (seen.has(s)) {
        err(`ac_coverage.${key}`, `duplicate slice id ${JSON.stringify(s)} (uniqueItems)`)
      }
      seen.add(s)
    }
  }
}

function validateResume(resume, err) {
  if (!isPlainObject(resume)) {
    err('resume', `must be object, got ${typeName(resume)}`)
    return
  }
  for (const key of Object.keys(resume)) {
    if (!RESUME_KEYS.has(key)) {
      err(`resume.${key}`, 'unrecognized field (additionalProperties: false)')
    }
  }
  if (!('next_actions' in resume) || resume.next_actions === undefined) {
    err('resume.next_actions', 'required field missing')
  } else if (!Array.isArray(resume.next_actions)) {
    err('resume.next_actions', `must be array, got ${typeName(resume.next_actions)}`)
  } else {
    resume.next_actions.forEach((a, i) => {
      if (typeof a !== 'string' || a.length < 1) {
        err(`resume.next_actions[${i}]`, `must be non-empty string, got ${typeName(a)}`)
      }
    })
  }
  // pointer: string | null | undefined
  if ('pointer' in resume && resume.pointer !== undefined && resume.pointer !== null) {
    if (typeof resume.pointer !== 'string') {
      err('resume.pointer', `must be string or null, got ${typeName(resume.pointer)}`)
    }
  }
  for (const key of ['slice_id', 'blocked_reason', 'waiting_on', 'updated_at', 'updated_by_session']) {
    if (key in resume && resume[key] !== undefined && resume[key] !== null) {
      if (typeof resume[key] !== 'string') {
        err(`resume.${key}`, `must be string or null, got ${typeName(resume[key])}`)
      }
    }
  }
}

function validateRuns(runs, err) {
  if (!Array.isArray(runs)) {
    err('runs', `must be array, got ${typeName(runs)}`)
    return
  }
  runs.forEach((run, i) => {
    const p = `runs[${i}]`
    if (!isPlainObject(run)) {
      err(p, `must be object, got ${typeName(run)}`)
      return
    }
    for (const key of Object.keys(run)) {
      if (!RUN_KEYS.has(key)) {
        err(`${p}.${key}`, 'unrecognized field (additionalProperties: false)')
      }
    }
    if (!('session_id' in run) || run.session_id === undefined) {
      err(`${p}.session_id`, 'required field missing')
    } else if (typeof run.session_id !== 'string' || run.session_id.length < 1) {
      err(`${p}.session_id`, `must be non-empty string, got ${typeName(run.session_id)}`)
    }
    if (!('slices_completed' in run) || run.slices_completed === undefined) {
      err(`${p}.slices_completed`, 'required field missing')
    } else if (!Array.isArray(run.slices_completed)) {
      err(`${p}.slices_completed`, `must be array, got ${typeName(run.slices_completed)}`)
    } else {
      const seen = new Set()
      run.slices_completed.forEach((s, j) => {
        if (typeof s !== 'string' || s.length < 1) {
          err(`${p}.slices_completed[${j}]`, `must be non-empty string, got ${typeName(s)}`)
        } else if (seen.has(s)) {
          err(`${p}.slices_completed`, `duplicate slice id ${JSON.stringify(s)} (uniqueItems)`)
        }
        seen.add(s)
      })
    }
    // run_path: string | null | undefined
    if ('run_path' in run && run.run_path !== undefined && run.run_path !== null) {
      if (typeof run.run_path !== 'string' || run.run_path.length < 1) {
        err(`${p}.run_path`, `must be non-empty string or null, got ${typeName(run.run_path)}`)
      }
    }
    for (const key of ['started_at', 'ended_at']) {
      if (key in run && run[key] !== undefined && run[key] !== null && typeof run[key] !== 'string') {
        err(`${p}.${key}`, `must be string or null, got ${typeName(run[key])}`)
      }
    }
    if ('gate_advisor' in run && run.gate_advisor !== undefined && run.gate_advisor !== null) {
      if (typeof run.gate_advisor !== 'string' || !RUN_GATE_ADVISOR_ENUM.has(run.gate_advisor)) {
        err(
          `${p}.gate_advisor`,
          `must be one of [${[...RUN_GATE_ADVISOR_ENUM].join(', ')}] or null, got ${JSON.stringify(run.gate_advisor)}`,
        )
      }
    }
  })
}

function validateHistory(history, err) {
  if (!Array.isArray(history)) {
    err('history', `must be array, got ${typeName(history)}`)
    return
  }
  history.forEach((ev, i) => {
    const p = `history[${i}]`
    if (!isPlainObject(ev)) {
      err(p, `must be object, got ${typeName(ev)}`)
      return
    }
    for (const key of Object.keys(ev)) {
      if (!HISTORY_KEYS.has(key)) {
        err(`${p}.${key}`, 'unrecognized field (additionalProperties: false)')
      }
    }
    for (const req of ['at', 'type', 'summary']) {
      if (!(req in ev) || ev[req] === undefined) {
        err(`${p}.${req}`, 'required field missing')
      }
    }
    if ('at' in ev && ev.at !== undefined && (typeof ev.at !== 'string' || ev.at.length < 1)) {
      err(`${p}.at`, `must be non-empty string, got ${typeName(ev.at)}`)
    }
    if ('type' in ev && ev.type !== undefined) {
      if (typeof ev.type !== 'string' || !HISTORY_TYPE_ENUM.has(ev.type)) {
        err(
          `${p}.type`,
          `must be one of [${[...HISTORY_TYPE_ENUM].join(', ')}], got ${JSON.stringify(ev.type)}`,
        )
      }
    }
    if ('summary' in ev && ev.summary !== undefined && typeof ev.summary !== 'string') {
      err(`${p}.summary`, `must be string, got ${typeName(ev.summary)}`)
    }
    if ('session_id' in ev && ev.session_id !== undefined && ev.session_id !== null && typeof ev.session_id !== 'string') {
      err(`${p}.session_id`, `must be string or null, got ${typeName(ev.session_id)}`)
    }
    if ('ref' in ev && ev.ref !== undefined && ev.ref !== null && typeof ev.ref !== 'string') {
      err(`${p}.ref`, `must be string or null, got ${typeName(ev.ref)}`)
    }
  })
}

function validateDecisions(decisions, err) {
  if (!Array.isArray(decisions)) {
    err('decisions', `must be array, got ${typeName(decisions)}`)
    return
  }
  decisions.forEach((d, i) => {
    const p = `decisions[${i}]`
    if (!isPlainObject(d)) {
      err(p, `must be object, got ${typeName(d)}`)
      return
    }
    for (const key of Object.keys(d)) {
      if (!DECISION_KEYS.has(key)) {
        err(`${p}.${key}`, 'unrecognized field (additionalProperties: false)')
      }
    }
    for (const req of ['at', 'summary']) {
      if (!(req in d) || d[req] === undefined) {
        err(`${p}.${req}`, 'required field missing')
      } else if (typeof d[req] !== 'string' || d[req].length < 1) {
        err(`${p}.${req}`, `must be non-empty string, got ${typeName(d[req])}`)
      }
    }
    if ('adr' in d && d.adr !== undefined && d.adr !== null && typeof d.adr !== 'string') {
      err(`${p}.adr`, `must be string or null, got ${typeName(d.adr)}`)
    }
  })
}

function validateLinks(links, err) {
  if (!isPlainObject(links)) {
    err('links', `must be object, got ${typeName(links)}`)
    return
  }
  for (const key of Object.keys(links)) {
    if (!LINKS_KEYS.has(key)) {
      err(`links.${key}`, 'unrecognized field (additionalProperties: false)')
    }
  }
  for (const key of ['linear_project_id', 'github_issue']) {
    if (key in links && links[key] !== undefined && links[key] !== null && typeof links[key] !== 'string') {
      err(`links.${key}`, `must be string or null, got ${typeName(links[key])}`)
    }
  }
  for (const key of ['linear_issue_ids', 'github_prs', 'handoffs']) {
    if (key in links && links[key] !== undefined) {
      if (!Array.isArray(links[key])) {
        err(`links.${key}`, `must be array, got ${typeName(links[key])}`)
      } else {
        links[key].forEach((v, i) => {
          if (typeof v !== 'string') {
            err(`links.${key}[${i}]`, `must be string, got ${typeName(v)}`)
          }
        })
      }
    }
  }
}

function validateGate(gate, err) {
  if (!isPlainObject(gate)) {
    err('gate', `must be object, got ${typeName(gate)}`)
    return
  }
  for (const key of Object.keys(gate)) {
    if (!GATE_KEYS.has(key)) {
      err(`gate.${key}`, 'unrecognized field (additionalProperties: false)')
    }
  }
  if ('advisor' in gate && gate.advisor !== undefined && gate.advisor !== null) {
    if (typeof gate.advisor !== 'string' || !GATE_ADVISOR_ENUM.has(gate.advisor)) {
      err(
        'gate.advisor',
        `must be one of [${[...GATE_ADVISOR_ENUM].join(', ')}] or null, got ${JSON.stringify(gate.advisor)}`,
      )
    }
  }
  if (
    'last_verdict_at' in gate &&
    gate.last_verdict_at !== undefined &&
    gate.last_verdict_at !== null &&
    typeof gate.last_verdict_at !== 'string'
  ) {
    err('gate.last_verdict_at', `must be string or null, got ${typeName(gate.last_verdict_at)}`)
  }
}

/**
 * oneOf invariant:
 *   (A) status ∈ {completed,canceled} AND resume.pointer ∈ {done, null, absent}
 *   (B) status ∈ {planned,started,paused} AND resume.pointer matches active pattern
 */
function validateInvariant(doc, err) {
  const status = doc.status
  const pointer = doc.resume?.pointer
  const pointerAbsent = !('pointer' in doc.resume) || pointer === undefined
  const pointerNull = pointer === null
  const pointerDone = pointer === 'done'
  const pointerActive =
    typeof pointer === 'string' && ACTIVE_POINTER_PATTERN.test(pointer)

  if (TERMINAL_STATUSES.has(status)) {
    // Branch A: pointer must be done | null | absent
    if (!(pointerDone || pointerNull || pointerAbsent)) {
      err(
        'invariant',
        `terminal status ${JSON.stringify(status)} requires resume.pointer to be "done" or null/absent, got ${JSON.stringify(pointer)}`,
      )
    }
    return
  }

  if (ACTIVE_STATUSES.has(status)) {
    // Branch B: pointer must match active pattern
    if (!pointerActive) {
      err(
        'invariant',
        `active status ${JSON.stringify(status)} requires resume.pointer matching ${ACTIVE_POINTER_PATTERN}, got ${JSON.stringify(pointer)}`,
      )
    }
    return
  }

  // Unknown status already reported by enum check; no further invariant noise.
}

// ---------------------------------------------------------------------------
// AC met/unmet derivation (gap #2)
// ---------------------------------------------------------------------------

/**
 * completed = union(runs[*].slices_completed)
 * AC met iff ac_coverage[ACn] non-empty AND every listed slice ∈ completed
 */
export function deriveAcCoverage(doc) {
  const completed = new Set()
  const runs = Array.isArray(doc.runs) ? doc.runs : []
  for (const run of runs) {
    const slices = Array.isArray(run?.slices_completed) ? run.slices_completed : []
    for (const s of slices) completed.add(s)
  }

  const ac = isPlainObject(doc.ac_coverage) ? doc.ac_coverage : {}
  const met = []
  const unmet = []
  // Stable sort by AC number
  const keys = Object.keys(ac).sort((a, b) => {
    const na = parseInt(a.replace(/^AC/, ''), 10)
    const nb = parseInt(b.replace(/^AC/, ''), 10)
    return na - nb
  })
  for (const key of keys) {
    const covering = Array.isArray(ac[key]) ? ac[key] : []
    const isMet =
      covering.length > 0 && covering.every((s) => completed.has(s))
    const entry = {
      id: key,
      covering,
      missing: covering.filter((s) => !completed.has(s)),
      met: isMet,
    }
    if (isMet) met.push(entry)
    else unmet.push(entry)
  }
  return { completed: [...completed], met, unmet }
}

// ---------------------------------------------------------------------------
// Goal extraction from spec.md
// ---------------------------------------------------------------------------

function extractGoal(specText) {
  if (!specText || typeof specText !== 'string') return null
  // Prefer a ## Goal / # Goal section
  const section = specText.match(/^#{1,3}\s*Goal\s*\n+([\s\S]*?)(?=^#{1,3}\s|\s*$)/im)
  if (section) {
    const body = section[1].trim().split(/\n\n/)[0].trim()
    if (body) return body.replace(/\s+/g, ' ')
  }
  // Fall back to first non-heading, non-empty paragraph
  const lines = specText.split(/\r?\n/)
  const buf = []
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (buf.length) break
      continue
    }
    if (line.trim() === '') {
      if (buf.length) break
      continue
    }
    buf.push(line.trim())
  }
  return buf.length ? buf.join(' ') : null
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdValidate(args) {
  const target = args[0]
  if (!target) die('validate requires <path> (file or feature dir)', 2)

  let filePath
  try {
    filePath = resolveFeaturePath(target)
  } catch (e) {
    die(e.message, e.exitCode ?? 1)
  }

  let doc
  try {
    doc = loadFeatureYaml(filePath)
  } catch (e) {
    die(e.message, e.exitCode ?? 1)
  }

  const result = validateFeature(doc)
  if (result.ok) {
    const slug = typeof doc.slug === 'string' ? doc.slug : path.basename(path.dirname(filePath))
    const status = doc.status ?? '?'
    const acKeys = isPlainObject(doc.ac_coverage) ? Object.keys(doc.ac_coverage).length : 0
    process.stdout.write(
      `OK  ${filePath}  slug=${slug} status=${status} acs=${acKeys}\n`,
    )
    process.exit(0)
  }

  process.stderr.write(`INVALID  ${filePath}\n`)
  for (const e of result.errors) {
    process.stderr.write(`  - ${e}\n`)
  }
  process.exit(1)
}

function cmdResume(args) {
  const slug = args[0]
  if (!slug) die('resume requires <slug>', 2)
  if (!SLUG_PATTERN.test(slug)) {
    die(`invalid slug ${JSON.stringify(slug)} (must match ${SLUG_PATTERN})`, 1)
  }

  const base = process.env.CLAUDE_PROJECT_DIR || process.cwd()
  const featureDir = path.join(base, '.groundwork', 'features', slug)
  const yamlPath = path.join(featureDir, '.feature.yaml')

  if (!existsSync(yamlPath)) {
    die(`feature not found: ${yamlPath}`, 1)
  }

  let doc
  try {
    doc = loadFeatureYaml(yamlPath)
  } catch (e) {
    die(e.message, e.exitCode ?? 1)
  }

  const result = validateFeature(doc)
  if (!result.ok) {
    process.stderr.write(`INVALID  ${yamlPath}\n`)
    for (const e of result.errors) {
      process.stderr.write(`  - ${e}\n`)
    }
    process.exit(1)
  }

  // Sibling docs
  const specPath = path.join(featureDir, 'spec.md')
  const planPath = path.join(featureDir, 'plan.md')
  const tasksPath = path.join(featureDir, 'tasks.md')
  const specText = existsSync(specPath) ? readFileSync(specPath, 'utf8') : null
  const goal = extractGoal(specText) ?? '(no spec.md goal found)'

  const { completed, met, unmet } = deriveAcCoverage(doc)
  const resume = doc.resume || {}
  const runs = Array.isArray(doc.runs) ? doc.runs : []
  const pruned = runs.filter((r) => r && (r.run_path === null || r.run_path === undefined))

  const lines = []
  lines.push(`# Resume: ${doc.slug ?? slug}`)
  lines.push('')
  lines.push(`Status: ${doc.status}   Health: ${doc.health}   Active: ${doc.active}`)
  lines.push(`Goal: ${goal}`)
  lines.push('')
  lines.push('## Program counter')
  lines.push(`pointer: ${resume.pointer === undefined ? '(absent)' : JSON.stringify(resume.pointer)}`)
  lines.push(`slice_id: ${resume.slice_id == null ? 'null' : JSON.stringify(resume.slice_id)}`)
  if (resume.blocked_reason) {
    lines.push(`blocked_reason: ${resume.blocked_reason}`)
  }
  if (resume.waiting_on) {
    lines.push(`waiting_on: ${resume.waiting_on}`)
  }
  lines.push('')
  lines.push('## Next actions')
  const actions = Array.isArray(resume.next_actions) ? resume.next_actions : []
  if (actions.length === 0) {
    lines.push('(none)')
  } else {
    actions.forEach((a, i) => lines.push(`${i + 1}. ${a}`))
  }
  lines.push('')
  lines.push('## Acceptance criteria')
  lines.push(`completed slices (union of runs): ${completed.length ? completed.join(', ') : '(none)'}`)
  if (met.length === 0 && unmet.length === 0) {
    lines.push('(no ac_coverage entries)')
  } else {
    for (const a of met) {
      lines.push(`MET   ${a.id}  covering=[${a.covering.join(', ')}]`)
    }
    for (const a of unmet) {
      const why =
        a.covering.length === 0
          ? 'no covering slices assigned'
          : `missing slices: ${a.missing.join(', ')}`
      lines.push(`UNMET ${a.id}  covering=[${a.covering.join(', ')}]  (${why})`)
    }
  }
  lines.push('')
  lines.push(`## Runs (${runs.length})`)
  for (const r of runs) {
    const rp = r.run_path === null || r.run_path === undefined ? 'null' : r.run_path
    const sc = Array.isArray(r.slices_completed) ? r.slices_completed.join(', ') : ''
    lines.push(`- session=${r.session_id}  run_path=${rp}  slices_completed=[${sc}]  gate=${r.gate_advisor ?? 'null'}`)
  }
  if (pruned.length > 0) {
    lines.push('')
    lines.push(
      `NOTE: ${pruned.length} run(s) have null/absent run_path (pruned or never written) — tolerated; file not required.`,
    )
  }

  // Sibling presence (informational)
  const siblings = [
    existsSync(specPath) ? 'spec.md' : null,
    existsSync(planPath) ? 'plan.md' : null,
    existsSync(tasksPath) ? 'tasks.md' : null,
  ].filter(Boolean)
  lines.push('')
  lines.push(`Siblings: ${siblings.length ? siblings.join(', ') : '(none)'}`)
  lines.push('')

  process.stdout.write(lines.join('\n'))
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2)
  const [cmd, ...rest] = argv

  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    usage(0)
  }

  try {
    switch (cmd) {
      case 'validate':
        return cmdValidate(rest)
      case 'resume':
        return cmdResume(rest)
      default:
        die(`unknown command "${cmd}". Run feature --help for a list.`, 2)
    }
  } catch (e) {
    die(e?.message ?? String(e), e?.exitCode ?? 1)
  }
}

// Only run main when executed as CLI (not when imported by tests)
const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main()
}
