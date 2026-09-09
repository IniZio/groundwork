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

// A repo that ships a .gitmessage states its own subject grammar there, so groundwork
// imposes none — it contributes only its universal rules, the body rule among them.
const TEMPLATE_REPO_CASES: Case[] = [
  { id: 'host-convention-accepted', message: 'web: Ignore CancelledError and offline fetch noise in GlitchTip', verdict: 'accept' },
  { id: 'host-scope-infra-accepted', message: 'infra: Track Containerfile for sandbox docker builds', verdict: 'accept' },
  { id: 'groundwork-shaped-subject-accepted', message: 'feat(web): something', verdict: 'accept' },
  { id: 'bare-type-accepted', message: 'fix: correct token expiry check', verdict: 'accept' },
  { id: 'unlisted-scope-accepted', message: 'nosuchscope: do a thing', verdict: 'accept' },
  { id: 'long-subject-accepted', message: 'web: ' + 'x'.repeat(120), verdict: 'accept' },
  { id: 'body-rejected', message: 'web: add a thing\n\nThis body explains the change', verdict: 'reject' },
  { id: 'process-vocab-gate-cycle-rejected', message: 'web: fix the second gate cycle thing', verdict: 'reject' },
  { id: 'process-vocab-slice-id-rejected', message: 'web: implement T39 completion', verdict: 'reject' },
  { id: 'process-vocab-decision-id-rejected', message: 'db: address D-7 feedback', verdict: 'reject' },
]

const DEGENERATE_CASES: Case[] = [
  { id: 'nonconforming-subject-accepted', message: 'Just some words with no shape at all', verdict: 'accept' },
  { id: 'host-shaped-subject-accepted', message: 'anything: at all goes here', verdict: 'accept' },
  { id: 'groundwork-shaped-subject-accepted', message: 'feat(web): also fine here', verdict: 'accept' },
  { id: 'body-rejected', message: 'anything: at all\n\nwith a body', verdict: 'reject' },
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

// With no template to concatenate, groundwork's own convention applies in full. History is
// no longer consulted, so a body-writing past cannot license a body here.
const NO_TEMPLATE_BODIES_CASES: Case[] = [
  { id: 'conforming-subject-with-body-rejected', message: 'feat: add feature\n\nThis is a body line', verdict: 'reject' },
  { id: 'malformed-subject-still-rejected', message: 'web: Ignore CancelledError noise', verdict: 'reject' },
  { id: 'unknown-type-still-rejected', message: 'notatype: this should always be rejected', verdict: 'reject' },
  { id: 'over-length-still-rejected', message: 'feat: ' + 'x'.repeat(73), verdict: 'reject' },
  { id: 'scoped-subject-with-body-rejected', message: 'fix(auth): correct token expiry\n\nThe old check compared seconds to milliseconds.', verdict: 'reject' },
  { id: 'bullet-body-rejected', message: 'chore: tidy imports\n\n- one\n- two', verdict: 'reject' },
  { id: 'subject-only-still-accepted', message: 'docs: describe the retry policy', verdict: 'accept' },
  { id: 'process-vocab-in-body-still-rejected', message: 'feat: add feature\n\nThis closes the second gate cycle.', verdict: 'reject' },
  { id: 'process-vocab-in-subject-still-rejected', message: 'feat: implement T39 completion', verdict: 'reject' },
]

// A history that refutes the convention no longer disarms it: with no .gitmessage the repo
// has stated no convention of its own, so groundwork's stands.
const NO_TEMPLATE_NONCONFORMING_CASES: Case[] = [
  { id: 'own-style-subject-rejected', message: 'web: Ignore CancelledError noise', verdict: 'reject' },
  { id: 'shapeless-subject-rejected', message: 'Just some words with no shape at all', verdict: 'reject' },
  { id: 'over-length-rejected', message: 'feat: ' + 'x'.repeat(73), verdict: 'reject' },
  { id: 'body-rejected', message: 'infra: add feature\n\nThis is a body line', verdict: 'reject' },
  { id: 'process-vocab-still-rejected', message: 'web: resolve gate cycle regression', verdict: 'reject' },
  { id: 'slice-id-still-rejected', message: 'web: implement T39 completion', verdict: 'reject' },
]

// Thin history is no longer a special case: nothing is measured, so nothing changes.
const NO_TEMPLATE_THIN_CASES: Case[] = [
  { id: 'thin-history-host-style-rejected', message: 'web: Ignore CancelledError noise', verdict: 'reject' },
  { id: 'thin-history-shapeless-rejected', message: 'Just some words with no shape', verdict: 'reject' },
  { id: 'thin-history-conforming-accepted', message: 'docs: describe the retry policy', verdict: 'accept' },
  { id: 'thin-history-process-vocab-rejected', message: 'web: resolve gate cycle regression', verdict: 'reject' },
]

const TEMPLATE_SILENT_BODYLESS_CASES: Case[] = [
  { id: 'bodied-commit-rejected', message: 'feat: add feature\n\nThis body explains the change', verdict: 'reject' },
  { id: 'subject-only-accepted', message: 'feat: add feature', verdict: 'accept' },
  { id: 'process-vocab-still-rejected', message: 'feat: fix the second gate cycle thing', verdict: 'reject' },
]

const TEMPLATE_SILENT_BODIES_CASES: Case[] = [
  { id: 'bodied-commit-rejected', message: 'feat: add feature\n\nThis body explains the change', verdict: 'reject' },
  { id: 'subject-only-accepted', message: 'feat: add feature', verdict: 'accept' },
  { id: 'process-vocab-still-rejected', message: 'feat: fix the second gate cycle thing', verdict: 'reject' },
]

let derivableRepo: string
let degenerateRepo: string
let noTemplateConformingRepo: string
let noTemplateNonConformingRepo: string
let noTemplateThinRepo: string
let noTemplateBodiesRepo: string
let templateSilentBodylessRepo: string
let templateSilentBodiesRepo: string

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
  templateSilentBodylessRepo = makeHostRepo({
    gitmessage: 'type-scope-silent-body.gitmessage',
    seedSubject: 'chore: initial import',
    subjectList: conformingHistory(30),
  })
  templateSilentBodiesRepo = makeHostRepo({
    gitmessage: 'type-scope-silent-body.gitmessage',
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
    templateSilentBodylessRepo,
    templateSilentBodiesRepo,
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

describe('host repo with its own .gitmessage (hanlun-lms fixture)', () => {
  for (const c of TEMPLATE_REPO_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(derivableRepo, c), 30_000)
  }
})

describe('host repo with a prose-first .gitmessage (universal rules only)', () => {
  for (const c of DEGENERATE_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(degenerateRepo, c), 30_000)
  }
})

describe('no .gitmessage, history conforms → groundwork convention enforced', () => {
  for (const c of NO_TEMPLATE_CONFORMING_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(noTemplateConformingRepo, c), 30_000)
  }
})

describe('no .gitmessage, commits carry bodies → convention still applies in full', () => {
  for (const c of NO_TEMPLATE_BODIES_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(noTemplateBodiesRepo, c), 30_000)
  }
})

describe('no .gitmessage, history does not conform → convention still applies', () => {
  for (const c of NO_TEMPLATE_NONCONFORMING_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(noTemplateNonConformingRepo, c), 30_000)
  }
})

describe('no .gitmessage, thin history → convention still applies', () => {
  for (const c of NO_TEMPLATE_THIN_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(noTemplateThinRepo, c), 30_000)
  }
})

describe('.gitmessage silent on body + subject-only history: body enforced', () => {
  for (const c of TEMPLATE_SILENT_BODYLESS_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(templateSilentBodylessRepo, c), 30_000)
  }
})

describe('.gitmessage silent on body + body-writing history: body still enforced', () => {
  for (const c of TEMPLATE_SILENT_BODIES_CASES) {
    it(`[${c.id}] ${c.verdict}`, () => assertParity(templateSilentBodiesRepo, c), 30_000)
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
