import type { RuleCases } from '../../src/engine/types.js';

/**
 * Illustrative cases for the pr-body rule.
 * This rule is not a file-tree rule; enforcement happens in the PreToolUse guard and the doc advisory, both of which call checkProse().
 * Cases here document what the checker accepts and rejects.
 */

export const cases: RuleCases = {
  valid: [
    {
      why: 'short sentences with one fact each',
      code: '## Why\n\nThe client printed no output. Users saw only progress lines.\n\n## Scope\n\nThe run log is unchanged.',
    },
    {
      why: 'a colon that ends a line before a list',
      code: '## Why\n\nTwo things changed:\n\n- The log is followed.\n- The frame is new.\n\n## Scope\n\nNo protocol change.',
    },
    {
      why: 'a path inside a link label that points at a commit sha',
      code: '## Why\n\nSee [`client.rs`](https://github.com/o/r/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/client.rs#L1) for the loop.\n\n## Scope\n\nOne file.',
    },
  ],
  invalid: [
    {
      why: 'a semicolon joins two clauses',
      code: '## Why\n\nThe log is followed; the frame is new.\n\n## Scope\n\nOne file.',
      findings: [{ ruleId: 'pr-body', message: 'a semicolon joins clauses; split it into two sentences' }],
    },
    {
      why: 'a colon joins clauses mid-sentence',
      code: '## Why\n\nOne test changed: the registry counts 26 kinds.\n\n## Scope\n\nOne file.',
      findings: [{ ruleId: 'pr-body', message: 'a colon joins clauses mid-sentence; split it into two sentences' }],
    },
    {
      why: 'a blob link pinned to a branch name',
      code: '## Why\n\nSee [the loop](https://github.com/o/r/blob/main/client.rs).\n\n## Scope\n\nOne file.',
      findings: [{ ruleId: 'pr-body', message: 'blob link ref "main" is not a commit sha (7-40 hex digits)' }],
    },
    {
      why: 'a PR body without the required Scope heading',
      code: '## Why\n\nThe client printed no output.',
      findings: [{ ruleId: 'pr-body', message: 'PR body has no "## Scope" heading' }],
    },
  ],
};
