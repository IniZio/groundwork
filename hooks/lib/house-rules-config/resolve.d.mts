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
    'stray-artifacts': {
      severity: Severity
      options: Record<string, never>
      sources: { severity: Source }
    }
  }
}

export declare const DEFAULT_SEVERITY: 'error'

export declare function resolveConfig(repoRoot: string): ResolvedConfig
export declare function resolveConfigText(repoRoot: string, text: string | null): ResolvedConfig
export declare function pointer(resolved: ResolvedConfig, ruleId: RuleId, key: string): string
