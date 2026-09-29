import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, RULE_ALIASES, parseConfig } from './schema.mjs'
import { detectPreset } from './detect.mjs'

export const DEFAULT_SEVERITY = 'error'

function applyAliases(file, rules) {
  const out = { ...rules }
  for (const [old, next] of Object.entries(RULE_ALIASES)) {
    if (!(old in out)) continue
    if (next in out) {
      const err = new ConfigError(`rules.${old}`, `"${old}" and "${next}" both set; "${old}" is the old name of "${next}"`, [next])
      err.message = `${file}: ${err.message}`
      throw err
    }
    out[next] = out[old]
    delete out[old]
  }
  return out
}

function parseText(file, text) {
  if (text === null) return { rules: {} }
  try {
    return parseConfig(text)
  } catch (err) {
    if (err instanceof ConfigError) {
      err.file = file
      err.message = `${file}: ${err.message}`
    }
    throw err
  }
}

export function resolveConfig(repoRoot) {
  const file = join(repoRoot, '.house-rules.json')
  return resolveConfigText(repoRoot, existsSync(file) ? readFileSync(file, 'utf8') : null)
}

export function resolveConfigText(repoRoot, text) {
  const file = join(repoRoot, '.house-rules.json')
  const present = text !== null
  const parsed = parseText(file, text)
  const rules = applyAliases(file, parsed.rules ?? {})

  const severityOf = (id) =>
    rules[id]?.severity !== undefined
      ? { value: rules[id].severity, source: 'explicit' }
      : { value: DEFAULT_SEVERITY, source: 'default' }

  const commit = severityOf('commit-message')
  const density = severityOf('comment-density')
  const stray = severityOf('artifact-structure')

  const explicitPreset = rules['commit-message']?.options?.preset
  const preset =
    explicitPreset !== undefined
      ? { value: explicitPreset, source: 'explicit' }
      : detectPreset(repoRoot)

  return {
    file: present ? file : null,
    rules: {
      'commit-message': {
        severity: commit.value,
        options: { preset: preset.value },
        sources: { severity: commit.source, preset: preset.source },
      },
      'comment-density': {
        severity: density.value,
        options: {},
        sources: { severity: density.source },
      },
      'artifact-structure': {
        severity: stray.value,
        options: {},
        sources: { severity: stray.source },
      },
    },
  }
}

export function pointer(resolved, ruleId, key) {
  const rule = resolved.rules[ruleId]
  if (key === 'severity') {
    return `rules["${ruleId}"] (active: ${rule.severity}, source: ${rule.sources.severity})`
  }
  return `rules["${ruleId}"].${key} (active: ${rule.options[key]}, source: ${rule.sources[key]})`
}
