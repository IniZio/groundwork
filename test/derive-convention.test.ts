import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MIN_PASS_RATE,
  MIN_SAMPLE_SIZE,
  checkSubject,
  deriveConvention,
  describeRules,
  parseTemplate,
  readRecentSubjects,
  validateRules,
} from '../hooks/lib/derive-convention.mjs'
import type { ConventionRules } from '../hooks/lib/derive-convention.mjs'
import { COMMIT_TYPES } from '../hooks/lib/commit-convention.mjs'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gitmessage')

function template(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.gitmessage`), 'utf8')
}

function subjects(name: string): string[] {
  return readFileSync(join(FIXTURES, `${name}.subjects.txt`), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
}

const GW_LIVE_REPO_HANLUN_LMS = process.env.GW_LIVE_REPO_HANLUN_LMS ?? ''
const GW_LIVE_REPO_NEXUS_MAIN = process.env.GW_LIVE_REPO_NEXUS_MAIN ?? ''

const REPOS: Record<string, string> = {
  'hanlun-lms': GW_LIVE_REPO_HANLUN_LMS,
  'nexus-main': GW_LIVE_REPO_NEXUS_MAIN,
  groundwork: join(dirname(fileURLToPath(import.meta.url)), '..'),
}

function derive(name: string) {
  return deriveConvention(REPOS[name], {
    templateText: template(name),
    subjects: subjects(name),
    templatePath: join(FIXTURES, `${name}.gitmessage`),
  })
}

describe('deriveConvention — real templates, validated against real history', () => {
  it('derives hanlun-lms scope-only rules with its full scope enumeration', () => {
    const result = derive('hanlun-lms')
    expect(result.confident).toBe(true)
    expect(result.rules?.shape).toBe('scope-only')
    expect(result.rules?.types).toBeNull()
    expect(result.rules?.scopes).toEqual([
      'web', 'student', 'teacher', 'backend', 'api',
      'admin', 'worker', 'db', 'infra', 'repo', 'deps', 'agent',
    ])
    expect(result.rules?.bodyPermitted).toBe(true)
    expect(result.rules?.bodySectionDeclared).toBe(true)
    expect(result.validation?.sampled).toBe(30)
    expect(result.validation?.passed).toBe(28)
    expect(result.validation!.passRate).toBeGreaterThanOrEqual(MIN_PASS_RATE)
  })

  it('derives groundwork type-scope rules with its pipe-separated type list', () => {
    const result = derive('groundwork')
    expect(result.confident).toBe(true)
    expect(result.rules?.shape).toBe('type-scope')
    expect(result.rules?.types).toEqual(COMMIT_TYPES)
    expect(result.rules?.scopes).toBeNull()
    expect(result.validation?.passed).toBe(30)
    expect(result.validation!.passRate).toBeGreaterThanOrEqual(MIN_PASS_RATE)
  })

  it('derives nexus-main type-scope rules with no enumeration', () => {
    const result = derive('nexus-main')
    expect(result.confident).toBe(true)
    expect(result.rules?.shape).toBe('type-scope')
    expect(result.rules?.types).toBeNull()
    expect(result.rules?.scopes).toBeNull()
    expect(result.validation?.passed).toBe(30)
    expect(result.validation!.passRate).toBeGreaterThanOrEqual(MIN_PASS_RATE)
  })
})

describe('deriveConvention — live repositories on disk', () => {
  const skipped = Object.entries(REPOS).filter(([, root]) => !root || !existsSync(join(root, '.git')))
  if (skipped.length > 0) {
    process.stderr.write(
      `\n[derive-convention] live-repo tests SKIPPED for: ${skipped.map(([n]) => n).join(', ')}` +
        ` — set GW_LIVE_REPO_HANLUN_LMS / GW_LIVE_REPO_NEXUS_MAIN to enable\n`,
    )
  }
  for (const [name, root] of Object.entries(REPOS)) {
    it.skipIf(!root || !existsSync(join(root, '.git')))(
      `derives and self-validates ${name} from its own checkout`,
      () => {
        const result = deriveConvention(root)
        expect(result.confident).toBe(true)
        expect(result.validation!.sampled).toBeGreaterThanOrEqual(MIN_SAMPLE_SIZE)
        expect(result.validation!.passRate).toBeGreaterThanOrEqual(MIN_PASS_RATE)
        expect(result.rules?.shape).toBe(derive(name).rules?.shape)
      },
    )
  }
})

describe('hanlun-lms enforcement is correct and not vacuous', () => {
  const rules = derive('hanlun-lms').rules as ConventionRules

  const accepted = [
    'web: Ignore CancelledError and offline fetch noise in GlitchTip',
    "backend: Stop an archived account reserving the other role's email",
    'repo, backend, web: Speed up the pre-commit gate',
    '[HAN-922] backend: Stop an archived account reserving the email',
    '[HAN-577 HAN-636] teacher: Render in-module navigation (#647)',
    ' infra: Include git and gh in nexus sandbox',
  ]
  for (const subject of accepted) {
    it(`accepts ${JSON.stringify(subject)}`, () => {
      expect(checkSubject(subject, rules)).toEqual({ ok: true, reason: null })
    })
  }

  const rejected: Array<[string, RegExp]> = [
    ['Fixed the login button', /does not match/],
    ['feat: add a thing', /not one of/],
    ['fix(web): add a thing', /not one of/],
    ['web:', /does not match/],
    ['', /empty subject/],
  ]
  for (const [subject, reason] of rejected) {
    it(`rejects ${JSON.stringify(subject)}`, () => {
      const verdict = checkSubject(subject, rules)
      expect(verdict.ok).toBe(false)
      expect(verdict.reason).toMatch(reason)
    })
  }

  it('bans the conventional-commit prefixes the template bans', () => {
    for (const bad of ['feat: x', 'fix: x', 'chore: x']) {
      expect(checkSubject(bad, rules).ok).toBe(false)
    }
    expect(describeRules(rules)).toContain('scope is one of: web, student')
  })
})

describe('degenerate templates fall back to universal-only', () => {
  const cases = ['empty', 'comments-only', 'prose-first-line']
  for (const name of cases) {
    it(`${name} yields confident:false with no rules`, () => {
      const result = deriveConvention(REPOS['hanlun-lms'], {
        templateText: template(name),
        subjects: subjects('hanlun-lms'),
      })
      expect(result.confident).toBe(false)
      expect(result.rules).toBeNull()
      expect(result.reason).toMatch(/recognised subject shape/)
    })
  }

  it('a missing .gitmessage yields confident:false', () => {
    const empty = mkdtempSync(join(tmpdir(), 'derive-conv-none-'))
    const result = deriveConvention(empty)
    expect(result.confident).toBe(false)
    expect(result.rules).toBeNull()
    expect(result.reason).toMatch(/no \.gitmessage template found/)
  })

  it('too little history yields confident:false even for a valid template', () => {
    const result = deriveConvention(REPOS['hanlun-lms'], {
      templateText: template('hanlun-lms'),
      subjects: subjects('hanlun-lms').slice(0, MIN_SAMPLE_SIZE - 1),
    })
    expect(result.confident).toBe(false)
    expect(result.rules).toBeNull()
    expect(result.reason).toMatch(/usable commits sampled/)
  })
})

describe('FALLBACK PROOF — self-validation catches a mis-derived rule set', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'derive-conv-perturb-'))
  const perturbedPath = join(scratch, '.gitmessage')
  writeFileSync(
    perturbedPath,
    template('hanlun-lms')
      .replace(/^#     web .*$/m, '#     alpha   - wrong')
      .replace(/^#     student .*$/m, '#     beta    - wrong')
      .replace(/^#     backend .*$/m, '#     gamma   - wrong')
      .replace(/^#     repo .*$/m, '#     delta   - wrong'),
    'utf8',
  )
  const perturbedText = readFileSync(perturbedPath, 'utf8')
  const real = subjects('hanlun-lms')

  it('POSITIVE CONTROL: the perturbed template still parses into rules', () => {
    const parsed = parseTemplate(perturbedText, perturbedPath)
    expect(parsed).not.toBeNull()
    expect(parsed!.shape).toBe('scope-only')
    expect(parsed!.scopes).toContain('alpha')
    expect(parsed!.scopes).not.toContain('web')
  })

  it('the perturbed rules score far below the threshold on real history', () => {
    const report = validateRules(parseTemplate(perturbedText, perturbedPath)!, real)
    expect(report.sampled).toBe(30)
    expect(report.passRate).toBeLessThan(MIN_PASS_RATE)
    expect(report.ok).toBe(false)
  })

  it('deriveConvention therefore discards them and falls back to universal-only', () => {
    const result = deriveConvention(REPOS['hanlun-lms'], {
      templateText: perturbedText,
      templatePath: perturbedPath,
      subjects: real,
    })
    expect(result.confident).toBe(false)
    expect(result.rules).toBeNull()
    expect(result.reason).toMatch(/match only .*% of this repository's own recent commits/)
    expect(result.validation!.passRate).toBeLessThan(MIN_PASS_RATE)
  })

  it('the unperturbed template, same history, same code path, IS trusted', () => {
    const result = deriveConvention(REPOS['hanlun-lms'], {
      templateText: template('hanlun-lms'),
      subjects: real,
    })
    expect(result.confident).toBe(true)
    expect(result.rules).not.toBeNull()
  })

  it('a wrong SHAPE also falls back: hanlun history under type(scope) rules', () => {
    const wrongShape: ConventionRules = {
      shape: 'type-scope',
      types: ['feat', 'fix', 'docs', 'chore'],
      scopes: null,
      bodyPermitted: true,
      bodySectionDeclared: false,
      templatePath: null,
    }
    const report = validateRules(wrongShape, real)
    expect(report.passRate).toBeLessThan(MIN_PASS_RATE)
    expect(report.ok).toBe(false)
  })
})

describe('BITE PROOF — the derived rules discriminate', () => {
  const rules = derive('hanlun-lms').rules as ConventionRules

  it('the same subject flips verdict when one scope is removed from the enumeration', () => {
    const subject = 'worker: Retry the nightly digest job'
    expect(checkSubject(subject, rules).ok).toBe(true)
    const narrowed: ConventionRules = { ...rules, scopes: rules.scopes!.filter((s) => s !== 'worker') }
    expect(checkSubject(subject, narrowed).ok).toBe(false)
  })

  it('validation is sensitive to the sample: all-malformed history scores zero', () => {
    const report = validateRules(rules, Array.from({ length: 30 }, (_, i) => `nonsense subject ${i}`))
    expect(report.passed).toBe(0)
    expect(report.ok).toBe(false)
  })

  it('merge and revert subjects are excluded from the denominator', () => {
    const report = validateRules(rules, [
      ...subjects('hanlun-lms'),
      'Merge branch "main" into feature',
      'Revert "web: something"',
    ])
    expect(report.sampled).toBe(30)
  })
})

describe('history that cannot be read never yields rules', () => {
  it('readRecentSubjects returns null outside a repository', () => {
    expect(readRecentSubjects('/definitely/not/a/repo')).toBeNull()
  })

  it('deriveConvention falls back when history is unreadable', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'derive-conv-nogit-'))
    writeFileSync(join(scratch, '.gitmessage'), template('hanlun-lms'), 'utf8')
    const result = deriveConvention(scratch, { subjects: undefined })
    expect(result.confident).toBe(false)
    expect(result.rules).toBeNull()
  })
})
