// check-comments-exempt — hook lib; schema format documented inline
/**
 * Groundwork schema I/O — shared JSON Schema loader for hooks.
 *
 * Loads schemas from the top-level `schemas/` directory, compiles them with
 * Ajv (draft 2020-12), and caches compiled validators so repeated calls within
 * the same process do not recompile.
 *
 * Error formatting:
 *   ajvErrorsToLines(errors, prefix?) converts Ajv's raw error objects into the
 *   line style used by existing runners:
 *     spec-lint:  `<invariant-name>: <problem>`
 *     rfc:        `<field>: <problem>`
 *   Both formats share the same `field: problem` shape, so a single helper
 *   covers both runners.
 *
 * Exit-code contract: 0 success · 1 operational failure · 2 usage error.
 * This module does not call process.exit(); callers decide exit codes.
 *
 * ESM only — Node 22+, no build step.
 */

import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
// Static ESM imports let bun's bundler inline these CJS packages into the committed
// bundle (dist/hooks-spec-lint.mjs) so the bundle runs with zero node_modules.
// Node 22+ ESM interop exposes CJS module.exports as the default export.
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

/** Absolute path to the repo root `schemas/` directory.
 *
 * When running from the committed bundle (dist/hooks-spec-lint.mjs), import.meta.url
 * points to the bundle file rather than the source, so the relative navigation
 * breaks. CLAUDE_PLUGIN_ROOT (set by the Claude Code harness during hook invocation
 * and by build scripts that run the bundle) anchors the path correctly in all contexts.
 */
const SCHEMAS_DIR = process.env.CLAUDE_PLUGIN_ROOT
  ? resolve(process.env.CLAUDE_PLUGIN_ROOT, 'schemas')
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas')

/** Single Ajv instance shared across all compiled schemas in this process. */
const ajv = new Ajv2020({ strict: true, allErrors: true })
// Register standard formats (date-time, uri, email, etc.) so schemas that use
// "format" keywords compile correctly under strict:true.
addFormats(ajv)

/** Cache: schema name → compiled ValidateFunction. */
const cache = new Map()

/**
 * Load and compile a schema by its base name (without directory or extension).
 *
 * Example: loadSchema('rfc-frontmatter') loads
 *   <repo-root>/schemas/rfc-frontmatter.schema.json
 *
 * Throws on file-not-found or invalid JSON — callers should wrap in try/catch
 * and map to their appropriate exit code (1 = operational failure).
 *
 * @param {string} name  Base name of the schema file (no path, no extension).
 * @returns {import('ajv').ValidateFunction}  Compiled, cached validator.
 */
export function loadSchema(name) {
  if (cache.has(name)) return cache.get(name)

  const schemaPath = resolve(SCHEMAS_DIR, `${name}.schema.json`)
  const raw = readFileSync(schemaPath, 'utf8')
  const schema = JSON.parse(raw)
  const validate = ajv.compile(schema)
  cache.set(name, validate)
  return validate
}

/**
 * Convert Ajv error objects into the `field: problem` line style used by
 * spec-lint and rfc runners.
 *
 * Mapping:
 *   instancePath "/uid"           → field "uid"
 *   instancePath "/tasks/0/name"  → field "tasks[0].name"
 *   instancePath "" (root)        → field prefix (if provided) or "schema"
 *
 * The resulting strings are ready to push into a `violations` or `errors`
 * array and then write to stdout/stderr — no further formatting is needed.
 *
 * @param {import('ajv').ErrorObject[]} errors  Ajv error array from validate.errors.
 * @param {string} [prefix]  Optional prefix for root-level errors (e.g. "rfc").
 * @returns {string[]}  Formatted `field: problem` strings.
 */
export function ajvErrorsToLines(errors, prefix) {
  if (!errors || errors.length === 0) return []

  return errors.map(err => {
    const field = instancePathToField(err.instancePath, prefix)
    const problem = ajvMessageToString(err)
    return `${field}: ${problem}`
  })
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert an Ajv instancePath string to a human-readable field name.
 *
 * Ajv paths use "/" as separator and "/0" for array indices.
 * We convert to the "field[0].sub" style familiar to JS developers.
 *
 * @param {string} instancePath  e.g. "/tasks/0/trigger"
 * @param {string|undefined} prefix
 * @returns {string}
 */
function instancePathToField(instancePath, prefix) {
  if (!instancePath || instancePath === '/') {
    return prefix ?? 'schema'
  }
  const parts = instancePath.replace(/^\//, '').split('/')
  let result = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (/^\d+$/.test(part)) {
      // Array index — attach to the previous segment
      result += `[${part}]`
    } else if (i === 0) {
      result = part
    } else {
      result += `.${part}`
    }
  }
  return result
}

/**
 * Produce a short, readable problem description from an Ajv ErrorObject.
 *
 * Ajv's `message` is already human-readable for most keywords; we just
 * append `params` detail for the keywords where it adds useful specificity.
 *
 * @param {import('ajv').ErrorObject} err
 * @returns {string}
 */
function ajvMessageToString(err) {
  const msg = err.message ?? 'invalid'
  const { keyword, params } = err

  switch (keyword) {
    case 'enum':
      return `${msg} — allowed: ${(params.allowedValues ?? []).join(', ')}`
    case 'pattern':
      return `${msg} (pattern: ${params.pattern})`
    case 'type':
      return `${msg} (got ${params.type})`
    case 'additionalProperties':
      return `${msg}: ${params.additionalProperty}`
    case 'required':
      return `missing required field: ${params.missingProperty}`
    default:
      return msg
  }
}
