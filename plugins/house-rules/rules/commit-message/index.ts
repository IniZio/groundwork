/**
 * commit-message rule — preset-based commit subject enforcement.
 *
 * This module is the canonical implementation. Both enforcement vehicles —
 * the groundwork PreToolUse guard and the git-level commit-msg hook — delegate
 * to lintCommitMessage() exported here. Groundwork keeps no separate logic.
 * Lint is pure: the preset is supplied by the caller from the config resolver.
 *
 * Vehicles: none (not a file-tree rule). Guard and hook import directly.
 */

import type { Rule, RuleContext, Finding } from '../../src/engine/types.js'
export { lintCommitMessage, PRESET_HANDBOOK, PRESET_CONVENTIONAL, PRESET_SUBJECT_ONLY, CONVENTIONAL_TYPES } from './lint.mjs'
export type { CommitPreset, CommitViolation, CommitLintResult, CommitLintOptions } from './lint.mjs'

const rule: Rule = {
  id: 'commit-message',
  meta: {
    description:
      'Enforces commit-message style. Default preset: handbook (imperative verb ≤50 chars, subject line only). ' +
      'Configure via .house-rules.json: {"rules":{"commit-message":["error",{"preset":"conventional"}]}}. ' +
      'Presets: handbook, conventional, subject-only; without an explicit preset it is detected from .gitmessage, commitlint config, then commit history.',
  },
  async check(_ctx: RuleContext): Promise<Finding[]> {
    return []
  },
}

export default rule
