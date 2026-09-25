/**
 * commit-message rule — preset-based commit subject enforcement.
 *
 * This module is the canonical implementation. Both enforcement vehicles —
 * the groundwork PreToolUse guard and the git-level commit-msg hook — delegate
 * to lintCommitMessage() exported here. Groundwork keeps no separate logic.
 *
 * Vehicles: none (not a file-tree rule). Guard and hook import directly.
 */

import type { Rule, RuleContext, Finding } from '../../src/engine/types.js'
export { lintCommitMessage, readConfigPreset, PRESET_HANDBOOK, PRESET_CONVENTIONAL, CONVENTIONAL_TYPES } from './lint.mjs'
export type { CommitPreset, CommitViolation, CommitLintResult, CommitLintOptions } from './lint.mjs'

const rule: Rule = {
  id: 'commit-message',
  meta: {
    description:
      'Enforces commit-message style. Default preset: handbook (imperative verb ≤50 chars). ' +
      'Configure via .house-rules.json: { "commit-message": { "preset": "conventional" } }.',
  },
  vehicles: [],
  async check(_ctx: RuleContext): Promise<Finding[]> {
    return []
  },
}

export default rule
