/**
 * pr-body rule: prose limits for PR bodies and doc pages.
 *
 * checkProse() is pure. The PreToolUse hook pr-body-guard.ts denies a failing `gh pr create|edit` or `gh api` PR write,
 * and doc-prose-advisory.ts reports on doc writes. check() reports nothing because a PR body is not
 * part of the file tree.
 */

import type { Rule, RuleContext, Finding } from '../../src/engine/types.js'
export { checkProse, formatFindings, MAX_PR_WORDS, MAX_WORDS, PR_HEADINGS } from './prose.js'
export type { Finding as ProseFinding, ProseOptions } from './prose.js'

const rule: Rule = {
  id: 'pr-body',
  meta: {
    description:
      'Keeps PR bodies and doc pages readable. On by default; opt out with {"rules":{"pr-body":"off"}} in .house-rules.json. ' +
      'Flags a sentence over 25 words, a semicolon or mid-sentence colon that joins clauses, a bare path:line or backticked path outside a link label, ' +
      'a github.com /blob/ link whose ref is not a commit sha, and, in a PR body, a sentence that reports a baseline command (make lint, cargo test, bun test, tsc and similar) as passing, because CI already shows it. A PR body must also have the Why and Scope headings and may use only the headings ' +
      'Why, What changed, Scope, Tradeoffs, Blast Radius, Verification and Review tier. Why holds 1-3 sentences and What changed holds 1-3 bullets, counting each list item once whether nested or not. A PR body holds at most 200 words of rendered prose, where fenced code, images, link URLs and <details> blocks do not count. A failing `gh pr create|edit` or `gh api` PATCH or POST to repos/<o>/<r>/pulls[/<n>] is denied, and so is a top-level PR comment (`gh pr comment`, or a `gh api` POST to repos/<o>/<r>/issues/<n>/comments), because proof and updates belong in the PR body. Each is seen through a wrapper such as timeout, xargs or bash -c. If this bun has no Bun.markdown the prose check is skipped with a notice; a doc write under doc/, docs/ or README.md gets an advisory.',
  },
  async check(_ctx: RuleContext): Promise<Finding[]> {
    return []
  },
}

export default rule
