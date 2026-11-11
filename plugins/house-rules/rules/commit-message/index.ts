/**
 * commit-message rule — preset-based commit subject enforcement.
 *
 * lintCommitMessage() is pure: the caller supplies the preset from the config resolver.
 * check() reports nothing because a commit message is not part of the file tree.
 */

import type { Rule, RuleContext, Finding } from '../../src/engine/types.js'
export { lintCommitMessage, PRESET_HANDBOOK, PRESET_CONVENTIONAL, PRESET_SUBJECT_ONLY, CONVENTIONAL_TYPES } from './lint.mjs'
export type { CommitPreset, CommitViolation, CommitLintResult, CommitLintOptions } from './lint.mjs'

const rule: Rule = {
  id: 'commit-message',
  meta: {
    description:
      'Enforces commit-message style in every repo, with or without .house-rules.json. Every preset is subject line only; this overrides any handbook or git-workflow guidance that asks for a body. Default preset: handbook (imperative verb ≤50 chars). ' +
      'Configure via .house-rules.json: {"rules":{"commit-message":["error",{"preset":"conventional"}]}}. ' +
      'Presets: handbook, conventional, subject-only; without an explicit preset it is detected from .gitmessage, commitlint config, then commit history.',
  },
  async check(_ctx: RuleContext): Promise<Finding[]> {
    return []
  },
}

export default rule
