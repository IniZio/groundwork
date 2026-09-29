import type { Preset, RuleId, Severity } from './schema.mjs'
import type { PresetSource } from './detect.mjs'

export type Source = 'explicit' | PresetSource

export interface ResolvedConfig {
  file: string | null
  rules: {
    'commit-message': {
      severity: Severity
      options: { preset: Preset }
      sources: { severity: Source; preset: Source }
    }
    'comment-density': {
      severity: Severity
      options: Record<string, never>
      sources: { severity: Source }
    }
    'artifact-structure': {
      severity: Severity
      options: ManifestOptions
      sources: { severity: Source }
    }
  }
}

export interface ManifestType {
  tier: 'product' | 'working' | 'ephemeral'
  generates: string
  description?: string
  instruction?: string
  template?: string | null
  frontmatter?: Record<string, unknown>
  headings?: string[]
}

export interface ManifestOptions {
  govern?: string[]
  types?: Record<string, ManifestType>
  forbidden?: { pattern: string; redirect: string }[]
}

export declare const DEFAULT_SEVERITY: 'error'

export declare function resolveConfig(repoRoot: string): ResolvedConfig
export declare function resolveConfigText(repoRoot: string, text: string | null): ResolvedConfig
export declare function pointer(resolved: ResolvedConfig, ruleId: RuleId, key: string): string
