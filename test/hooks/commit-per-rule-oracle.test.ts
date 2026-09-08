// T43: the oracle validates each rule independently against FULL commit messages.
// Case 1 is the load-bearing pair — dropping the body rule must not drop subject
// enforcement — and is proven to bite in both directions at the bottom of this file.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  RULE_GROUPS,
  checkMessage,
  readRecentMessages,
  validateRulesPerGroup,
} from '../../hooks/lib/derive-convention.mjs'
import type { RuleGroup } from '../../hooks/lib/derive-convention.mjs'
import {
  GROUNDWORK_RULES,
  clearHostRulesCache,
  lintMessage,
  resolveHostRules,
} from '../../hooks/lib/commit-convention.mjs'
import {
  FIXTURES,
  conformingHistory,
  conformingHistoryWithBodies,
  nonConformingHistory,
  makeHostRepo,
} from './host-convention-harness.js'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

const SUBJECT_RULES: RuleGroup[] = ['subjectShape', 'subjectCap']

function opts(repoRoot: string) {
  return { repoRoot, motiveSlugs: [] as string[] }
}

function hanlunSubjectsWithBodies(): string[] {
  return readFileSync(join(FIXTURES, 'hanlun-lms.subjects.txt'), 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s, i) => `${s}\n\n- bullet body line ${i}\n- second bullet`)
}

let bodiesRepo: string
let bodylessRepo: string
let refutingRepo: string
let derivableRepo: string
let templateSilentBodylessRepo: string
let templateSilentBodiesRepo: string

beforeAll(() => {
  bodiesRepo = makeHostRepo({
    gitmessage: null, seedSubject: 'chore: initial import',
    subjectList: conformingHistoryWithBodies(30), installHook: false,
  })
  bodylessRepo = makeHostRepo({
    gitmessage: null, seedSubject: 'chore: initial import',
    subjectList: conformingHistory(30), installHook: false,
  })
  refutingRepo = makeHostRepo({
    gitmessage: null, seedSubject: 'repo: initial import',
    subjectList: nonConformingHistory(30), installHook: false,
  })
  derivableRepo = makeHostRepo({
    gitmessage: 'hanlun-lms.gitmessage', seedSubject: 'web: initial import',
    subjectList: hanlunSubjectsWithBodies(), installHook: false,
  })
  templateSilentBodylessRepo = makeHostRepo({
    gitmessage: 'type-scope-silent-body.gitmessage', seedSubject: 'chore: initial import',
    subjectList: conformingHistory(30), installHook: false,
  })
  templateSilentBodiesRepo = makeHostRepo({
    gitmessage: 'type-scope-silent-body.gitmessage', seedSubject: 'chore: initial import',
    subjectList: conformingHistoryWithBodies(30), installHook: false,
  })
}, 300_000)

afterAll(() => {
  for (const r of [bodiesRepo, bodylessRepo, refutingRepo, derivableRepo, templateSilentBodylessRepo, templateSilentBodiesRepo]) {
    if (r) rmSync(r, { recursive: true, force: true })
  }
})

beforeEach(() => clearHostRulesCache())

describe('readRecentMessages sees the whole message, not just the subject', () => {
  it('returns bodies that readRecentSubjects could never observe', () => {
    const messages = readRecentMessages(bodiesRepo, 12)
    expect(messages).not.toBeNull()
    expect(messages!.length).toBe(12)
    expect(messages!.every((m) => m.includes('\n\nThis body paragraph explains'))).toBe(true)
  })

  it('returns null outside a repository', () => {
    const outside = mkdtempSync(join(tmpdir(), 'gw-not-a-repo-'))
    try {
      expect(readRecentMessages(outside, 5)).toBeNull()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('validateRulesPerGroup scores every rule separately', () => {
  it('bodies-present history: subject groups pass, body group fails', () => {
    const report = validateRulesPerGroup(GROUNDWORK_RULES, conformingHistoryWithBodies(30))
    expect(report.sampled).toBe(30)
    expect(report.groups.subjectShape.ok, 'subject shape').toBe(true)
    expect(report.groups.subjectCap.ok, 'subject cap').toBe(true)
    expect(report.groups.body.ok, 'body').toBe(false)
    expect(report.groups.body.passRate).toBe(0)
  })

  it('bodyless conforming history: every group passes', () => {
    const report = validateRulesPerGroup(GROUNDWORK_RULES, conformingHistory(30))
    for (const g of RULE_GROUPS) expect(report.groups[g].ok, g).toBe(true)
  })

  it('non-conforming history: the subject shape group fails', () => {
    expect(validateRulesPerGroup(GROUNDWORK_RULES, nonConformingHistory(30)).groups.subjectShape.ok)
      .toBe(false)
  })

  it('over-length subjects fail only the cap group', () => {
    const long = Array.from({ length: 30 }, (_, i) => `feat: ${'x'.repeat(80)}${i}`)
    const report = validateRulesPerGroup(GROUNDWORK_RULES, long)
    expect(report.groups.subjectShape.ok, 'shape').toBe(true)
    expect(report.groups.subjectCap.ok, 'cap').toBe(false)
    expect(report.groups.body.ok, 'body').toBe(true)
  })

  it('below the minimum sample nothing is enforceable', () => {
    const report = validateRulesPerGroup(GROUNDWORK_RULES, conformingHistory(4))
    expect(report.enoughHistory).toBe(false)
    for (const g of RULE_GROUPS) expect(report.groups[g].ok, g).toBe(false)
  })
})

describe('CASE 1 — subjects conform, bodies present', () => {
  it('resolves to subject rules only', () => {
    const host = resolveHostRules(bodiesRepo)
    expect(host.rules?.enforce).toEqual(SUBJECT_RULES)
    expect(host.reason).toContain('body policy')
  })

  it('ACCEPTS a conforming subject that carries a body', () => {
    expect(lintMessage('feat: add feature\n\nThis is a body line', opts(bodiesRepo)).violations).toEqual([])
  })

  it('REJECTS a malformed subject in the same repository', () => {
    const v = lintMessage('web: Ignore CancelledError noise', opts(bodiesRepo)).violations
    expect(v.length).toBeGreaterThan(0)
    expect(v[0]!.line).toBe(1)
  })

  it('REJECTS an over-length subject in the same repository', () => {
    const v = lintMessage(`feat: ${'x'.repeat(73)}`, opts(bodiesRepo)).violations
    expect(v.some((x) => /limit is 72/.test(x.reason))).toBe(true)
  })
})

describe('CASE 2 — subjects conform, no bodies: full enforcement', () => {
  it('enforces every rule group', () => {
    expect(resolveHostRules(bodylessRepo).rules?.enforce).toEqual(RULE_GROUPS)
  })

  it('rejects a body', () => {
    const v = lintMessage('feat: add feature\n\nThis is a body line', opts(bodylessRepo)).violations
    expect(v.some((x) => /body has 1 non-blank lines/.test(x.reason))).toBe(true)
  })
})

describe('CASE 3 — subjects do not conform: universal-only', () => {
  it('yields no rules at all', () => {
    const host = resolveHostRules(refutingRepo)
    expect(host.applies).toBe(true)
    expect(host.rules).toBeNull()
    expect(lintMessage('web: anything\n\nwith a body', opts(refutingRepo)).violations).toEqual([])
  })
})

describe('CASE 4 — template declares body section: body rule excluded regardless of history', () => {
  it('derives rules with body excluded from enforce and a permitted body', () => {
    const host = resolveHostRules(derivableRepo)
    expect(host.applies).toBe(true)
    expect(host.rules?.bodyPermitted).toBe(true)
    expect(host.rules?.enforce).toContain('subjectShape')
    expect(host.rules?.enforce).not.toContain('body')
    expect(host.rules?.shape).toBe('scope-only')
  })

  it('a bullet-laden body cannot produce a body violation', () => {
    const host = resolveHostRules(derivableRepo)
    expect(checkMessage('web: something\n\n- a bullet body', host.rules!).violations
      .filter((v) => v.group === 'body')).toEqual([])
    expect(lintMessage('web: something\n\n- a bullet body', opts(derivableRepo)).violations).toEqual([])
  })

  it('its subject rules still discriminate', () => {
    expect(lintMessage('feat(web): something', opts(derivableRepo)).violations.length).toBeGreaterThan(0)
  })
})

describe('CASE 5 — groundwork own repo: unmeasured, everything enforced', () => {
  it('applies its hardcoded convention with no enforce restriction', () => {
    const host = resolveHostRules(REPO_ROOT)
    expect(host.applies).toBe(false)
    expect(host.rules).toBeNull()
    expect(host.reason).toContain("groundwork's own repository")
  })

  it('still rejects a body and an over-length subject', () => {
    expect(lintMessage('feat: add feature\n\nbody', opts(REPO_ROOT)).violations.length).toBeGreaterThan(0)
    expect(lintMessage(`feat: ${'x'.repeat(73)}`, opts(REPO_ROOT)).violations.length).toBeGreaterThan(0)
  })
})

describe('CASE 6 — template silent on body + subject-only history: body enforced', () => {
  it('enforce includes the body group', () => {
    const host = resolveHostRules(templateSilentBodylessRepo)
    expect(host.applies).toBe(true)
    expect(host.rules?.enforce).toContain('body')
    expect(host.rules?.bodyPermitted).toBe(false)
  })

  it('rejects a bodied commit', () => {
    const v = lintMessage('feat: add something\n\nA body line', opts(templateSilentBodylessRepo)).violations
    expect(v.some((x) => /body has 1 non-blank lines/.test(x.reason))).toBe(true)
  })

  it('accepts a subject-only commit', () => {
    expect(lintMessage('feat: add something', opts(templateSilentBodylessRepo)).violations).toEqual([])
  })
})

describe('CASE 7 — template silent on body + body-writing history: body not enforced', () => {
  it('enforce excludes the body group', () => {
    const host = resolveHostRules(templateSilentBodiesRepo)
    expect(host.applies).toBe(true)
    expect(host.rules?.enforce).not.toContain('body')
    expect(host.rules?.bodyPermitted).toBe(true)
  })

  it('accepts a bodied commit', () => {
    const v = lintMessage('feat: add something\n\nA body line', opts(templateSilentBodiesRepo)).violations
    expect(v.filter((x) => x.reason.includes('body'))).toEqual([])
  })
})

describe('BITE PROOF — template body enforcement distinguishes the two states', () => {
  const MSG_WITH_BODY = 'feat: add something\n\nA body explanation here'
  const rulesNoBody = { ...GROUNDWORK_RULES, bodyPermitted: true, enforce: ['subjectShape', 'subjectCap'] as RuleGroup[] }
  const rulesWithBody = { ...GROUNDWORK_RULES, bodyPermitted: false, enforce: RULE_GROUPS }

  it('rules with body enforced reject the bodied commit', () => {
    expect(checkMessage(MSG_WITH_BODY, rulesWithBody).violations.some((v) => v.group === 'body')).toBe(true)
  })

  it('rules without body enforced accept the bodied commit', () => {
    expect(checkMessage(MSG_WITH_BODY, rulesNoBody).violations.filter((v) => v.group === 'body')).toEqual([])
  })
})

describe('BITE PROOF — case 1 fails in BOTH directions under perturbation', () => {
  const MALFORMED = 'web: Ignore CancelledError noise'
  const CONFORMING_WITH_BODY = 'feat: add feature\n\nThis is a body line'
  const subjectOnly = { ...GROUNDWORK_RULES, enforce: SUBJECT_RULES }

  // Perturbation A — the over-correction into "enforce nothing": drop subject enforcement
  // along with the body rule. Case 1's REJECTION assertion breaks.
  it('an enforce set missing subjectShape stops rejecting the malformed subject', () => {
    const capOnly: RuleGroup[] = ['subjectCap']
    expect(checkMessage(MALFORMED, { ...GROUNDWORK_RULES, enforce: capOnly }).violations).toEqual([])
    expect(checkMessage(MALFORMED, subjectOnly).violations.length).toBeGreaterThan(0)
  })

  // Perturbation B — keep the body rule despite the measurement. Case 1's ACCEPTANCE
  // assertion breaks.
  it('an enforce set that keeps body stops accepting the conforming subject with a body', () => {
    expect(checkMessage(CONFORMING_WITH_BODY, { ...GROUNDWORK_RULES, enforce: RULE_GROUPS }).violations.length)
      .toBeGreaterThan(0)
    expect(checkMessage(CONFORMING_WITH_BODY, subjectOnly).violations).toEqual([])
  })

  // Perturbation C — the defect this slice closes: scoring subjects instead of full
  // messages makes the body group falsely pass on a bodies-writing repository.
  it('scoring subjects only makes the body group falsely pass', () => {
    const messages = conformingHistoryWithBodies(30)
    const subjects = messages.map((m) => m.split('\n')[0]!)
    expect(validateRulesPerGroup(GROUNDWORK_RULES, subjects).groups.body.ok).toBe(true)
    expect(validateRulesPerGroup(GROUNDWORK_RULES, messages).groups.body.ok).toBe(false)
  })
})

describe('cost guards still hold', () => {
  it('the guard short-circuits on a non-commit Bash command', () => {
    const out = execFileSync(join(REPO_ROOT, 'bin', 'gw-hook'), ['hook', 'commit-message-guard'], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status --short' } }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'per-rule-test' },
      timeout: 20_000,
    })
    expect(out.trim()).toBe('')
  })

  it('resolveHostRules caches per repo root', () => {
    expect(resolveHostRules(bodiesRepo)).toBe(resolveHostRules(bodiesRepo))
  })
})
