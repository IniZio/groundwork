import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConfigError, parseConfig } from './schema.mjs'
import { detectPreset } from './detect.mjs'

export const DEFAULT_SEVERITY = 'error'
export const DEFAULT_MAX_PER_100 = 5

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
  const rules = parsed.rules ?? {}

  const severityOf = (id) =>
    rules[id]?.severity !== undefined
      ? { value: rules[id].severity, source: 'explicit' }
      : { value: DEFAULT_SEVERITY, source: 'default' }

  const commit = severityOf('commit-message')
  const density = severityOf('comment-density')
  const stray = severityOf('stray-artifacts')

  const explicitPreset = rules['commit-message']?.options?.preset
  const preset =
    explicitPreset !== undefined
      ? { value: explicitPreset, source: 'explicit' }
      : detectPreset(repoRoot)

  const explicitMax = rules['comment-density']?.options?.max_per_100
  const max =
    explicitMax !== undefined
      ? { value: explicitMax, source: 'explicit' }
      : { value: DEFAULT_MAX_PER_100, source: 'default' }

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
        options: { max_per_100: max.value },
        sources: { severity: density.source, max_per_100: max.source },
      },
      'stray-artifacts': {
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
