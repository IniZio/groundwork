import type { RuleCases, Case, Finding } from '../../src/engine/types.js';
import type { TrackedCase } from '../../src/engine/rule-tester.js';

type InvalidTrackedCase = TrackedCase & { findings: Partial<Finding>[] };

const valid: TrackedCase[] = [
  {
    why: 'doc/ is canonical; no finding',
    tree: { 'doc/guide.md': '' },
  },
  {
    why: 'test-foo.ts nested under test/ is valid; root-scratch rule does not apply',
    tree: { 'test/test-foo.ts': '' },
  },
  {
    why: 'untracked root test-*.mjs produces no finding',
    tree: { 'test-local.mjs': '' },
    trackedOverrides: { 'test-local.mjs': false },
  },
  {
    why: 'lib/ alone produces no finding; symmetric rule requires both siblings',
    tree: { 'lib/index.ts': '' },
  },
  {
    why: 'untracked and not session-created root tmp-notes.md produces no finding',
    tree: { 'tmp-notes.md': '' },
    trackedOverrides: { 'tmp-notes.md': false },
  },
];

const invalid: InvalidTrackedCase[] = [
  {
    why: 'docs/ is non-canonical; doc/ is canonical',
    tree: { 'docs/readme.md': '' },
    findings: [
      {
        ruleId: 'stray-artifacts',
        path: 'docs/readme.md',
        message: 'use doc/ (canonical) instead of docs/',
        fingerprintBasis: 'docs/readme.md',
      },
    ],
  },
  {
    why: 'tracked root test-agent-config.mjs matches root-scratch pattern',
    tree: { 'test-agent-config.mjs': '' },
    findings: [
      {
        ruleId: 'stray-artifacts',
        path: 'test-agent-config.mjs',
        message: 'root scratch file: test-agent-config.mjs',
        fingerprintBasis: 'test-agent-config.mjs',
      },
    ],
  },
  {
    why: 'util/ and utils/ coexist; symmetric pair must consolidate',
    tree: { 'util/helpers.ts': '', 'utils/tools.ts': '' },
    findings: [
      {
        ruleId: 'stray-artifacts',
        path: 'util/helpers.ts',
        message: 'both util/ and utils/ exist under root; consolidate',
        fingerprintBasis: 'util/helpers.ts',
      },
      {
        ruleId: 'stray-artifacts',
        path: 'utils/tools.ts',
        message: 'both util/ and utils/ exist under root; consolidate',
        fingerprintBasis: 'utils/tools.ts',
      },
    ],
  },
  {
    why: 'session-created root tmp-notes.md matches scratch prefix',
    tree: { 'tmp-notes.md': '' },
    trackedOverrides: { 'tmp-notes.md': false },
    sessionCreatedOverrides: { 'tmp-notes.md': true },
    findings: [
      {
        ruleId: 'stray-artifacts',
        path: 'tmp-notes.md',
        message: 'root scratch file: tmp-notes.md',
        fingerprintBasis: 'tmp-notes.md',
      },
    ],
  },
];

export const cases: RuleCases = {
  valid: valid as Case[],
  invalid: invalid as (Case & { findings: Partial<Finding>[] })[],
};
