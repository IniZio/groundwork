import type { RuleCases, Case, Finding } from '../../src/engine/types.js';
import type { TrackedCase } from '../../src/engine/rule-tester.js';

type InvalidTrackedCase = TrackedCase & { findings: Partial<Finding>[] };

const MANIFEST_CFG = JSON.stringify({ rules: { 'artifact-structure': ['error', {
  govern: ['notes/**'],
  types: { research: { tier: 'working', description: 'Research notes', generates: '.groundwork/work/{slug}/research/{name:kebab}.md' } },
}] } });

const valid: TrackedCase[] = [
  {
    why: 'no types configured: notes/x.md is not flagged (legacy behaviour)',
    tree: { 'notes/x.md': '' },
  },
  {
    why: 'manifest: conforming path is clean',
    tree: { '.house-rules.json': MANIFEST_CFG, '.groundwork/work/a/research/x.md': '' },
  },
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
    why: 'docs/ alone produces no finding; synonym rule requires sibling canonical dir',
    tree: { 'docs/readme.md': '' },
  },
  {
    why: 'node_modules synonym dirs (doc/docs) never produce a finding even with a tracked file inside',
    tree: { 'node_modules/pkg/doc/a.ts': '', 'node_modules/pkg/docs/b.ts': '' },
    trackedOverrides: { 'node_modules/pkg/docs/b.ts': false },
  },
  {
    why: 'tests/ alone produces no finding; synonym rule requires sibling canonical dir',
    tree: { 'tests/helper.ts': '' },
  },
  {
    why: 'untracked and not session-created root tmp-notes.md produces no finding',
    tree: { 'tmp-notes.md': '' },
    trackedOverrides: { 'tmp-notes.md': false },
  },
];

const invalid: InvalidTrackedCase[] = [
  {
    why: 'manifest: new governed md outside every doc type is flagged with nearest type',
    tree: { '.house-rules.json': MANIFEST_CFG, 'notes/research-notes.md': '' },
    findings: [
      {
        ruleId: 'artifact-structure',
        path: 'notes/research-notes.md',
        message: 'artifact-structure: notes/research-notes.md is outside every doc type path. Nearest types:\n- research: Research notes -> .groundwork/work/<slug>/research/research-notes.md',
      },
    ],
  },
  {
    why: 'docs/ and doc/ coexist; both dirs have tracked files, both flagged',
    tree: { 'doc/guide.md': '', 'docs/readme.md': '' },
    findings: [
      { ruleId: 'artifact-structure', path: 'doc/guide.md', message: 'doc/ and docs/ coexist under root; merge doc/ into docs/', fingerprintBasis: 'doc/guide.md' },
      { ruleId: 'artifact-structure', path: 'docs/readme.md', message: 'docs/ and doc/ coexist under root; merge docs/ into doc/', fingerprintBasis: 'docs/readme.md' },
    ],
  },
  {
    why: 'tests/ and test/ coexist; both dirs have tracked files, both flagged',
    tree: { 'test/unit.ts': '', 'tests/helper.ts': '' },
    findings: [
      { ruleId: 'artifact-structure', path: 'test/unit.ts', message: 'test/ and tests/ coexist under root; merge test/ into tests/', fingerprintBasis: 'test/unit.ts' },
      { ruleId: 'artifact-structure', path: 'tests/helper.ts', message: 'tests/ and test/ coexist under root; merge tests/ into test/', fingerprintBasis: 'tests/helper.ts' },
    ],
  },
  {
    why: 'tracked root test-agent-config.mjs matches root-scratch pattern',
    tree: { 'test-agent-config.mjs': '' },
    findings: [
      {
        ruleId: 'artifact-structure',
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
        ruleId: 'artifact-structure',
        path: 'util/helpers.ts',
        message: 'both util/ and utils/ exist under root; consolidate',
        fingerprintBasis: 'util/helpers.ts',
      },
      {
        ruleId: 'artifact-structure',
        path: 'utils/tools.ts',
        message: 'both util/ and utils/ exist under root; consolidate',
        fingerprintBasis: 'utils/tools.ts',
      },
    ],
  },
  {
    why: 'doc/ file in-scope while untracked docs/ sibling exists; reverse direction',
    tree: { 'docs/readme.md': '', 'doc/guide.md': '' },
    trackedOverrides: { 'docs/readme.md': false },
    findings: [
      { ruleId: 'artifact-structure', path: 'doc/guide.md', message: 'doc/ and docs/ coexist under root; merge doc/ into docs/', fingerprintBasis: 'doc/guide.md' },
    ],
  },
  {
    why: 'test/ file in-scope while untracked tests/ sibling exists; reverse direction',
    tree: { 'tests/helper.ts': '', 'test/unit.ts': '' },
    trackedOverrides: { 'tests/helper.ts': false },
    findings: [
      { ruleId: 'artifact-structure', path: 'test/unit.ts', message: 'test/ and tests/ coexist under root; merge test/ into tests/', fingerprintBasis: 'test/unit.ts' },
    ],
  },
  {
    why: 'session-created root tmp-notes.md matches scratch prefix',
    tree: { 'tmp-notes.md': '' },
    trackedOverrides: { 'tmp-notes.md': false },
    sessionCreatedOverrides: { 'tmp-notes.md': true },
    findings: [
      {
        ruleId: 'artifact-structure',
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
