import { describe, test, expect, beforeAll } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const RESULTS_DIR = '/tmp/acp-test-results'

interface TestSummary {
  name: string
  session_id: string
  text: string
  skills_loaded: string[]
  tools_used: string[]
  task_subagent_types: string[]
  finish_reason: string
  duration_ms: number
  prompt: string
}

interface RoutingTestCase {
  name: string
  description: string
  prompt: string
  expectedSkillsLoaded: string[]
  forbiddenSkills: string[]
  forbiddenTools: string[]
  textAssertions: Array<{
    pattern: RegExp
    description: string
  }>
}

const TEST_CASES: RoutingTestCase[] = [
  {
    name: 'trivial',
    description: 'Trivial question — direct path, no skills required',
    prompt: 'What is 2+2? Just give me the number.',
    expectedSkillsLoaded: [],
    forbiddenSkills: ['interview', 'vertical-slice', 'implement', 'diagnose'],
    forbiddenTools: [],
    textAssertions: [],
  },
  {
    name: 'trivial-bug',
    description: 'Obvious bug (typo) — direct fix, no diagnose/interview/vertical-slice needed',
    prompt: 'Fix the typo in /tmp/todo-app/src/style.css where it says "backgroud" instead of "background"',
    expectedSkillsLoaded: [],
    forbiddenSkills: ['diagnose', 'vertical-slice', 'implement'],
    forbiddenTools: [],
    textAssertions: [],
  },
  {
    name: 'standard-bug',
    description: 'Non-obvious bug — should load diagnose skill',
    prompt: "The todo app filters don't work correctly. When I click 'Active' filter, completed items still show. Debug and fix it.",
    expectedSkillsLoaded: ['diagnose'],
    forbiddenSkills: ['vertical-slice', 'implement'],
    forbiddenTools: [],
    textAssertions: [],
  },
  {
    name: 'small-change',
    description: 'Small change — direct path, no skill loading needed',
    prompt: 'Add a button to the todo app that toggles all todos between completed and uncompleted',
    expectedSkillsLoaded: [],
    forbiddenSkills: ['diagnose', 'vertical-slice', 'implement', 'interview'],
    forbiddenTools: [],
    textAssertions: [],
  },
  {
    name: 'feature',
    description: 'Feature — requires interview skill (vertical-slice follows after interview)',
    prompt: 'Build a workflow engine for the todo app: users can create custom automation rules with triggers (e.g., "when a todo is marked complete"), conditions (e.g., "if the todo has tag #work"), and actions (e.g., "move to Done list and notify via email"). Include a visual rule builder UI, rule persistence in localStorage, and a simulation mode to test rules without affecting real data.',
    expectedSkillsLoaded: ['interview', 'vertical-slice'],
    forbiddenSkills: ['diagnose'],
    forbiddenTools: [],
    textAssertions: [],
  },
  {
    name: 'orchestrator-no-self-task',
    description: 'Orchestrator must not spawn task subagents on itself',
    prompt: 'Add a search bar to the todo app that filters todos in real-time as the user types',
    expectedSkillsLoaded: [],
    forbiddenSkills: [],
    forbiddenTools: [],
    textAssertions: [],
  },
]

describe('ACP Routing Tests', () => {
  beforeAll(() => {
    if (!existsSync(RESULTS_DIR)) {
      throw new Error('Run ./tests/acp-harness.sh test first')
    }
  })

  for (const tc of TEST_CASES) {
    describe(`${tc.name}: ${tc.description}`, () => {
      let summary: TestSummary | null = null

      beforeAll(() => {
        const filePath = path.join(RESULTS_DIR, `${tc.name}.summary.json`)
        if (existsSync(filePath)) {
          summary = JSON.parse(readFileSync(filePath, 'utf-8'))
        }
      })

      test('summary file exists', () => {
        expect(summary).not.toBeNull()
      })

      test('expected skills were loaded', () => {
        if (!summary) return
        for (const skill of tc.expectedSkillsLoaded) {
          expect(summary.skills_loaded).toContain(skill)
        }
      })

      test('forbidden skills were NOT loaded', () => {
        if (!summary) return
        for (const skill of tc.forbiddenSkills) {
          expect(summary.skills_loaded).not.toContain(skill)
        }
      })

      test('forbidden tools were NOT used', () => {
        if (!summary) return
        for (const tool of tc.forbiddenTools) {
          expect(summary.tools_used).not.toContain(tool)
        }
      })

      test('orchestrator must NOT appear as task subagent type', () => {
        if (!summary) return
        expect(summary.task_subagent_types).not.toContain('orchestrator')
      })

      test('text assertions pass', () => {
        if (!summary) return
        for (const assertion of tc.textAssertions) {
          expect(assertion.pattern.test(summary.text)).toBe(true)
        }
      })

      test('produced output (did not crash)', () => {
        if (!summary) return
        expect(summary.duration_ms).toBeGreaterThan(0)
      })

      test('feature progression: interview before vertical-slice', () => {
        if (!summary || tc.name !== 'feature') return
        const interviewIdx = summary.skills_loaded.indexOf('interview')
        const sliceIdx = summary.skills_loaded.indexOf('vertical-slice')
        expect(interviewIdx).toBeGreaterThanOrEqual(0)
        expect(sliceIdx).toBeGreaterThanOrEqual(0)
        expect(interviewIdx).toBeLessThan(sliceIdx)
      })
    })
  }

  test('all routing test cases produced results', () => {
    for (const tc of TEST_CASES) {
      const filePath = path.join(RESULTS_DIR, `${tc.name}.summary.json`)
      expect(existsSync(filePath)).toBe(true)
    }
  })
})
