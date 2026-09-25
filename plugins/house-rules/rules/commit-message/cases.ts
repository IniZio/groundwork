import type { RuleCases } from '../../src/engine/types.js';

/**
 * Illustrative cases for the commit-message rule.
 * This rule is not a file-tree rule (vehicles: []); enforcement happens via the
 * PreToolUse guard and the git commit-msg hook, both of which call lintCommitMessage().
 * Cases here document what the linter accepts and rejects.
 */

export const cases: RuleCases = {
  valid: [
    {
      why: 'handbook preset: imperative verb ≤50 chars',
      code: 'Add user login validation',
    },
    {
      why: 'handbook preset: fix verb with short subject',
      code: 'Fix null-pointer in token refresh',
    },
    {
      why: 'conventional preset: type(scope): description',
      code: 'fix(auth): correct token expiry check',
    },
    {
      why: 'conventional preset: type without scope',
      code: 'feat: add login flow',
    },
  ],
  invalid: [
    {
      why: 'handbook preset: conventional-style type prefix not an imperative verb',
      code: 'feat(auth): add login',
      findings: [{ ruleId: 'commit-message', message: 'subject must start with an imperative verb' }],
    },
    {
      why: 'handbook preset: subject exceeds 50 characters',
      code: 'Add a very long subject line that clearly exceeds fifty characters',
      findings: [{ ruleId: 'commit-message', message: 'subject exceeds 50 characters' }],
    },
    {
      why: 'conventional preset: no type prefix',
      code: 'Add user login',
      findings: [{ ruleId: 'commit-message', message: 'subject must match conventional format' }],
    },
    {
      why: 'conventional preset: unrecognised commit type',
      code: 'typo(auth): fix spelling',
      findings: [{ ruleId: 'commit-message', message: 'not one of the allowed types' }],
    },
  ],
};
