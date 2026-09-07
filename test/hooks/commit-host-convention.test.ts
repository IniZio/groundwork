// T39: host-convention enforcement must be identical across the PreToolUse guard and
// the commit-msg hook installed into host repositories. Every case asserts the two
// surfaces AGREE as well as what the shared verdict is; an asymmetry fails the test.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { rmSync } from 'node:fs'
import {
  makeHostRepo,
  guardVerdict,
  installedHookVerdict,
  conformingHistory,
  conformingHistoryWithBodies,
  nonConformingHistory,
  REPO_ROOT,
  type Verdict,
} from './host-convention-harness.js'

interface Case {
  id: string
  message: string
  verdict: Verdict
}

const DERIVABLE_CASES: Case[] = [
  { id: 'host-convention-accepted', message: 'web: Ignore CancelledError and offline fetch noise in GlitchTip', verdict: 'accept' },
  { id: 'host-scope-infra-accepted', message: 'infra: Track Containerfile for sandbox docker builds', verdict: 'accept' },
  { id: 'groundwork-convention-rejected', message: 'feat(web): something', verdict: 'reject' },
  { id: 'groundwork-bare-type-rejected', message: 'fix: correct token expiry check', verdict: 'reject' },
  { id: 'groundwork-chore-rejected', message: 'chore: update dependencies', verdict: 'reject' },
  { id: 'process-vocab-gate-cycle-rejected', message: 'web: fix the second gate cycle thing', verdict: 'reject' },
  { id: 'process-vocab-slice-id-rejected', message: 'web: implement T39 completion', verdict: 'reject' },
  { id: 'process-vocab-decision-id-rejected', message: 'db: address D-7 feedback', verdict: 'reject' },
  { id: 'unknown-scope-rejected', message: 'nosuchscope: do a thing', verdict: 'reject' },
  { id: 'long-subject-accepted', message: 'web: ' + 'x'.repeat(120), verdict: 'accept' },
]

const DEGENERATE_CASES: Case[] = [
  { id: 'nonconforming-subject-accepted', message: 'Just some words with no shape at all', verdict: 'accept' },
  { id: 'host-shaped-subject-accepted', message: 'anything: at all goes here', verdict: 'accept' },
  { id: 'groundwork-shaped-subject-accepted', message: 'feat(web): also fine here', verdict: 'accept' },
  { id: 'process-vocab-gate-cycle-rejected', message: 'Resolve the second gate cycle regression', verdict: 'reject' },
  { id: 'process-vocab-slice-id-rejected', message: 'Finish T39 wiring', verdict: 'reject' },
]

// A no-.gitmessage repo whose history CONFORMS, bodies included, has earned every rule.
const NO_TEMPLATE_CONFORMING_CASES: Case[] = [
  { id: 'groundwork-convention-accepted', message: 'feat: add initial implementation', verdict: 'accept' },
  { id: 'scoped-groundwork-accepted', message: 'fix(auth): correct token expiry check', verdict: 'accept' },
  { id: 'host-style-subject-rejected', message: 'web: Ignore CancelledError noise', verdict: 'reject' },
  { id: 'over-length-rejected', message: 'feat: ' + 'x'.repeat(73), verdict: 'reject' },
  { id: 'body-rejected', message: 'feat: add feature\n\nThis is a body line', verdict: 'reject' },
  { id: 'process-vocab-rejected', message: 'fix: resolve gate cycle regression', verdict: 'reject' },
]

// T43: subjects conform but every commit carries a body, so only the body rule is dropped.
// The first two cases are the load-bearing pair — dropping it must not drop subject rules.
const NO_TEMPLATE_BODIES_CASES: Case[] = [
  { id: 'conforming-subject-with-body-accepted', message: 'feat: add feature\n\nThis is a body line', verdict: 'accept' },
  { id: 'malformed-subject-still-rejected', message: 'web: Ignore CancelledError noise', verdict: 'reject' },
  { id: 'unknown-type-still-rejected', message: 'notatype: this should always be rejected', verdict: 'reject' },
  { id: 'over-length-still-rejected', message: 'feat: ' + 'x'.repeat(73), verdict: 'reject' },
  { id: 'scoped-subject-with-body-accepted', message: 'fix(auth): correct token expiry\n\nThe old check compared seconds to milliseconds.', verdict: 'accept' },
  { id: 'bullet-body-accepted', message: 'chore: tidy imports\n\n- one\n- two', verdict: 'accept' },
  { id: 'subject-only-still-accepted', message: 'docs: describe the retry policy', verdict: 'accept' },
  { id: 'process-vocab-in-body-still-rejected', message: 'feat: add feature\n\nThis closes the second gate cycle.', verdict: 'reject' },
  { id: 'process-vocab-in-subject-still-rejected', message: 'feat: implement T39 completion', verdict: 'reject' },
]

// Same shape of repo, but its history refutes groundwork's convention. Enforcing it here
// would deny every commit the project has ever written, so only universal rules apply.
const NO_TEMPLATE_NONCONFORMING_CASES: Case[] = [
  { id: 'own-style-subject-accepted', message: 'web: Ignore CancelledError noise', verdict: 'accept' },
  { id: 'shapeless-subject-accepted', message: 'Just some words with no shape at all', verdict: 'accept' },
  { id: 'over-length-accepted', message: 'feat: ' + 'x'.repeat(73), verdict: 'accept' },
  { id: 'body-accepted', message: 'infra: add feature\n\nThis is a body line', verdict: 'accept' },
  { id: 'process-vocab-still-rejected', message: 'web: resolve gate cycle regression', verdict: 'reject' },
  { id: 'slice-id-still-rejected', message: 'web: implement T39 completion', verdict: 'reject' },
]

// Too little history to measure anything: the guard has no evidence, so it narrows.
const NO_TEMPLATE_THIN_CASES: Case[] = [
  { id: 'thin-history-host-style-accepted', message: 'web: Ignore CancelledError noise', verdict: 'accept' },
  { id: 'thin-history-shapeless-accepted', message: 'Just some words with no shape', verdict: 'accept' },
  { id: 'thin-history-process-vocab-rejected', message: 'web: resolve gate cycle regression', verdict: 'reject' },
]

let derivableRepo: string
let degenerateRepo: string
let noTemplateConformingRepo: string
let noTemplateNonConformingRepo: string
let noTemplateThinRepo: string
let noTemplateBodiesRepo: string

beforeAll(() => {
  derivableRepo = makeHostRepo({
    gitmessage: 'hanlun-lms.gitmessage',
    subjects: 'hanlun-lms.subjects.txt',
  })
  degenerateRepo = makeHostRepo({
    gitmessage: 'prose-first-line.gitmessage',
    subjects: 'hanlun-lms.subjects.txt',
  })
  noTemplateConformingRepo = makeHostRepo({
    gitmessage: null,
    seedSubject: 'chore: initial import',
    subjectList: conformingHistory(30),
  })
  noTemplateNonConformingRepo = makeHostRepo({
    gitmessage: null,
    seedSubject: 'repo: initial import',
    subjectList: nonConformingHistory(30),
  })
  noTemplateThinRepo = makeHostRepo({
    gitmessage: null,
    seedSubject: 'chore: initial import',
    subjectList: conformingHistory(2),
  })
  noTemplateBodiesRepo = makeHostRepo({
    gitmessage: null,
    seedSubject: 'chore: initial import',
    subjectList: conformingHistoryWithBodies(30),
  })
}, 240_000)

afterAll(() => {
  for (const r of [
    derivableRepo,
    degenerateRepo,
    noTemplateConformingRepo,
    noTemplateNonConformingRepo,
    noTemplateThinRepo,
    noTemplateBodiesRepo,
  ]) {
    if (r) rmSync(r, { recursive: true, force: true })
  }
})

function assertParity(repo: string, c: Case) {
  const hook = installedHookVerdict(repo, c.message)
  const guard = guardVerdict(repo, c.message)
  expect(guard, `guard vs installed commit-msg hook [${c.id}]`).toBe(hook)
  expect(hook, `installed commit-msg hook [${c.id}]`).toBe(c.verdict)
  expect(guard, `guard [${c.id}]`).toBe(c.verdict)
}

describe('host repo with a derivable convention (hanlun-lms fixture)', () => {
  for (const c of DERIVABLE_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(derivableRepo, c), 30_000)
  }
})

describe('host repo whose template is not derivable (universal rules only)', () => {
  for (const c of DEGENERATE_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(degenerateRepo, c), 30_000)
  }
})

describe('no .gitmessage, history conforms → groundwork convention enforced', () => {
  for (const c of NO_TEMPLATE_CONFORMING_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(noTemplateConformingRepo, c), 30_000)
  }
})

describe('no .gitmessage, subjects conform but commits carry bodies → subject rules only', () => {
  for (const c of NO_TEMPLATE_BODIES_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(noTemplateBodiesRepo, c), 30_000)
  }
})

describe('no .gitmessage, history does not conform → universal rules only', () => {
  for (const c of NO_TEMPLATE_NONCONFORMING_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(noTemplateNonConformingRepo, c), 30_000)
  }
})

describe('no .gitmessage, history below the minimum sample → universal rules only', () => {
  for (const c of NO_TEMPLATE_THIN_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(noTemplateThinRepo, c), 30_000)
  }
})

describe("groundwork's own repo keeps its hardcoded convention", () => {
  const CASES: Case[] = [
    { id: 'own-scope-only-rejected', message: 'web: Ignore CancelledError noise', verdict: 'reject' },
    { id: 'own-hooks-scope-rejected', message: 'hooks: wire host convention', verdict: 'reject' },
    { id: 'own-conventional-accepted', message: 'feat(hooks): wire host convention enforcement', verdict: 'accept' },
    { id: 'own-over-length-rejected', message: 'feat: ' + 'x'.repeat(73), verdict: 'reject' },
  ]

  for (const c of CASES) {
    it(`[${c.id}] ${c.verdict}`, () => {
      expect(guardVerdict(REPO_ROOT, c.message), `guard in groundwork [${c.id}]`).toBe(c.verdict)
    }, 30_000)
  }
})
