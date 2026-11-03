/**
 * pr-body rule: prose limits for PR bodies and doc pages.
 *
 * checkProse() is pure. The PreToolUse hook pr-body-guard.ts denies a failing `gh pr create|edit`,
 * and doc-prose-advisory.ts reports on doc writes. check() reports nothing because a PR body is not
 * part of the file tree.
 */

import type { Rule, RuleContext, Finding } from '../../src/engine/types.js'
export { checkProse, formatFindings, MAX_WORDS, PR_HEADINGS } from './prose.js'
export type { Finding as ProseFinding, ProseOptions } from './prose.js'

const rule: Rule = {
  id: 'pr-body',
  meta: {
    description:
      'Keeps PR bodies and doc pages readable. Off by default; enable with {"rules":{"pr-body":"error"}} in .house-rules.json. ' +
      'Flags a sentence over 25 words, a semicolon or mid-sentence colon that joins clauses, a bare path:line or backticked path outside a link label, ' +
      'and a github.com /blob/ link whose ref is not a commit sha. A PR body must also have the Why and Scope headings and may use only the headings ' +
      'Why, What changed, Scope, Tradeoffs, Blast Radius, Verification and Review tier. A failing `gh pr create|edit` is denied; a doc write under doc/, docs/ or README.md gets an advisory.',
  },
  async check(_ctx: RuleContext): Promise<Finding[]> {
    return []
  },
}

export default rule
