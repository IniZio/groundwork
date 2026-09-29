export type Preset = 'handbook' | 'conventional' | 'subject-only'
export type PresetSource = 'gitmessage' | 'commitlint' | 'history' | 'default'
export interface DetectedPreset {
  value: Preset
  source: PresetSource
}

export declare const PRESET_HANDBOOK: 'handbook'
export declare const PRESET_CONVENTIONAL: 'conventional'
export declare const PRESET_SUBJECT_ONLY: 'subject-only'
export declare const CONVENTIONAL_SUBJECT_RE: RegExp

export declare function hasGitMessage(repoRoot: unknown): boolean
export declare function hasCommitlintConfig(repoRoot: string): boolean
export declare function readLastSubjects(repoRoot: string, n?: number): string[]
export declare function detectPreset(repoRoot: string | null | undefined): DetectedPreset
