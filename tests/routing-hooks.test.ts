/**
 * Unit tests for hooks/keyword-router.mjs
 *
 * Tests keyword detection and routing hint injection without invoking Claude.
 * Fast, deterministic — runs in milliseconds via bun test.
 */
import { describe, test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.resolve(__dirname, '../hooks/keyword-router.mjs')

function runHook(prompt: string): { continue: boolean; hookSpecificOutput?: { hookEventName: string; additionalContext: string } } {
  const input = JSON.stringify({ prompt, role: 'user' })
  const result = spawnSync('node', [HOOK], {
    input,
    encoding: 'utf8',
    timeout: 5000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Hook exited ${result.status}: ${result.stderr}`)
  }
  return JSON.parse(result.stdout.trim())
}

function context(prompt: string): string {
  const out = runHook(prompt)
  return out.hookSpecificOutput?.additionalContext ?? ''
}

describe('keyword-router: no signal → pass-through', () => {
  test('trivial question', () => {
    const out = runHook('What is 2+2?')
    expect(out.continue).toBe(true)
    expect(out.hookSpecificOutput).toBeUndefined()
  })

  test('general explanation request', () => {
    const out = runHook('How does the plugin system work?')
    expect(out.continue).toBe(true)
    expect(out.hookSpecificOutput).toBeUndefined()
  })
})

describe('keyword-router: bug signals → debugger', () => {
  test('"bug" keyword', () => {
    expect(context('fix the login bug')).toContain('groundwork:debugger')
  })

  test('"broken" keyword', () => {
    expect(context("the payment flow is broken")).toContain('groundwork:debugger')
  })

  test('"doesn\'t work" phrase', () => {
    expect(context("the search doesn't work correctly")).toContain('groundwork:debugger')
  })

  test('"error" keyword', () => {
    expect(context('getting an error when submitting the form')).toContain('groundwork:debugger')
  })

  test('"stack trace" phrase', () => {
    expect(context('here is the stack trace from production')).toContain('groundwork:debugger')
  })

  test('"regression" keyword', () => {
    expect(context('there is a regression in the auth module')).toContain('groundwork:debugger')
  })

  test('"debug" keyword', () => {
    expect(context('debug why the cache is not invalidating')).toContain('groundwork:debugger')
  })

  test('debugger hint mentions diagnose skill FIRST', () => {
    const ctx = context('fix the login bug')
    expect(ctx).toContain('diagnose')
    expect(ctx).toContain('FIRST')
  })
})

describe('keyword-router: feature signals → planner', () => {
  test('"plan" keyword', () => {
    expect(context('plan the new notification system')).toContain('groundwork:planner')
  })

  test('"build X from scratch"', () => {
    expect(context('build a authentication system from scratch')).toContain('groundwork:planner')
  })

  test('"architect" keyword', () => {
    expect(context('architect the new microservices approach')).toContain('groundwork:planner')
  })

  test('"major feature" phrase', () => {
    expect(context('implement this major feature for the dashboard')).toContain('groundwork:planner')
  })

  test('"implement X feature" phrase', () => {
    expect(context('implement the workflow automation feature')).toContain('groundwork:planner')
  })
})

describe('keyword-router: review signals → critic', () => {
  test('"review" keyword', () => {
    expect(context('review my auth implementation')).toContain('groundwork:critic')
  })

  test('"code review" phrase', () => {
    expect(context('can you do a code review of this PR')).toContain('groundwork:critic')
  })

  test('"is this right" phrase', () => {
    expect(context('is this code correct and following best practices?')).toContain('groundwork:critic')
  })

  test('"validate the plan" phrase', () => {
    expect(context('validate the plan before we proceed')).toContain('groundwork:critic')
  })
})

describe('keyword-router: test signals → test-engineer', () => {
  test('"write tests" phrase', () => {
    expect(context('write tests for the auth module')).toContain('groundwork:test-engineer')
  })

  test('"test coverage" phrase', () => {
    expect(context('improve test coverage for payment service')).toContain('groundwork:test-engineer')
  })

  test('"TDD" keyword', () => {
    expect(context('use TDD to implement this feature')).toContain('groundwork:test-engineer')
  })

  test('"flaky test" phrase', () => {
    expect(context('the flaky test in CI is causing issues')).toContain('groundwork:test-engineer')
  })
})

describe('keyword-router: git signals → git-master', () => {
  test('"commit" keyword', () => {
    expect(context('commit these changes')).toContain('groundwork:git-master')
  })

  test('"rebase" keyword', () => {
    expect(context('rebase onto main')).toContain('groundwork:git-master')
  })

  test('"pull request" phrase', () => {
    expect(context('create a pull request for this branch')).toContain('groundwork:git-master')
  })

  test('"PR" keyword', () => {
    expect(context('open a PR with these changes')).toContain('groundwork:git-master')
  })
})

describe('keyword-router: design signals → designer', () => {
  test('"UI" keyword', () => {
    expect(context('improve the UI for the dashboard')).toContain('groundwork:designer')
  })

  test('"styling" keyword', () => {
    expect(context('fix the styling of the modal')).toContain('groundwork:designer')
  })

  test('"dark mode" phrase', () => {
    expect(context('add dark mode support')).toContain('groundwork:designer')
  })

  test('"responsive" keyword', () => {
    expect(context('make the layout responsive')).toContain('groundwork:designer')
  })
})

describe('keyword-router: advisor signals', () => {
  test('"architecture trade-off" phrase', () => {
    expect(context('explain the architecture trade-off between REST and GraphQL')).toContain('groundwork:advisor')
  })

  test('"should we use" phrase', () => {
    expect(context('should we use Redis or Memcached?')).toContain('groundwork:advisor')
  })
})

describe('keyword-router: advisor gate/completion signals → advisor', () => {
  test('"advisor gate" phrase', () => {
    expect(context('run the advisor gate before we proceed')).toContain('groundwork:advisor')
  })

  test('"completion gate" phrase', () => {
    expect(context('completion gate check for this task')).toContain('groundwork:advisor')
  })

  test('"declare done" phrase', () => {
    expect(context('declare done and move on')).toContain('groundwork:advisor')
  })

  test('"mark as complete" phrase', () => {
    expect(context('mark as complete once tests pass')).toContain('groundwork:advisor')
  })

  test('"all done" phrase', () => {
    expect(context('all done with the implementation')).toContain('groundwork:advisor')
  })

  test('"ready for review" phrase', () => {
    expect(context('ready for review whenever you are')).toContain('groundwork:advisor')
  })

  test('"run the advisor gate" phrase', () => {
    expect(context('run the advisor gate before declaring done')).toContain('groundwork:advisor')
  })

  test('"completion gate check" phrase', () => {
    expect(context('completion gate check for this task')).toContain('groundwork:advisor')
  })

  test('"task complete" phrase', () => {
    expect(context('task complete and ready to ship')).toContain('groundwork:advisor')
  })
})

describe('keyword-router: completion/verification signals → verifier', () => {
  test('"is it done?" phrase', () => {
    expect(context('is it done?')).toContain('groundwork:verifier')
  })

  test('"verify this" phrase', () => {
    expect(context('verify this works correctly')).toContain('groundwork:verifier')
  })

  test('"ship it" phrase', () => {
    expect(context('ship it to production')).toContain('groundwork:verifier')
  })

  test('"are we done" phrase', () => {
    expect(context('are we done yet?')).toContain('groundwork:verifier')
  })

  test('"can we merge" phrase', () => {
    expect(context('can we merge this PR?')).toContain('groundwork:verifier')
  })

  test('"ready to ship" phrase', () => {
    expect(context('ready to ship the feature')).toContain('groundwork:verifier')
  })

  test('"verify this works" phrase', () => {
    expect(context('verify this works correctly')).toContain('groundwork:verifier')
  })

  test('"validate this output" phrase', () => {
    expect(context('validate this output before merging')).toContain('groundwork:verifier')
  })
})

describe('keyword-router: multi-signal prompts', () => {
  test('outputs GROUNDWORK ROUTING SIGNAL header', () => {
    const ctx = context('fix the broken login')
    expect(ctx).toContain('[GROUNDWORK ROUTING SIGNAL]')
  })
})

describe('keyword-router: edge cases', () => {
  test('empty prompt → pass-through', () => {
    const out = runHook('')
    expect(out.continue).toBe(true)
    expect(out.hookSpecificOutput).toBeUndefined()
  })

  test('invalid JSON input → pass-through', () => {
    const result = spawnSync('node', [HOOK], {
      input: 'not json at all',
      encoding: 'utf8',
      timeout: 5000,
    })
    const out = JSON.parse(result.stdout.trim())
    expect(out.continue).toBe(true)
    expect(out.hookSpecificOutput).toBeUndefined()
  })

  test('always sets continue: true', () => {
    expect(runHook('fix the bug').continue).toBe(true)
    expect(runHook('plan the feature').continue).toBe(true)
    expect(runHook('random unrelated text').continue).toBe(true)
  })
})
