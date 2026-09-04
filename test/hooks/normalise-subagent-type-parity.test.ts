/**
 * normalise-subagent-type-parity.test.ts
 *
 * SEAM: normalise-subagent-type parity (nesting-guard ↔ agent-model-guard)
 *
 * Both guards share normaliseSubagentType from normalise-subagent-type.ts.
 * This test spans the seam with three sections:
 *
 *   Section 1 — source parity: both guards import the shared function;
 *               neither redeclares normaliseName or registryKey locally.
 *
 *   Section 2 — normalisation table: shared function output for known inputs.
 *
 *   Section 3 — behavioural parity: both guards' real run() paths see the
 *               same bare name for plugin:-prefixed types, preventing a guard
 *               from missing a DENIED_AT_DEPTH_1 type due to stale local logic.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { run as nestingRun } from '../../src/gw/hook/nesting-guard.js'
import { run as modelRun } from '../../src/gw/hook/agent-model-guard.js'
import { normaliseSubagentType } from '../../src/gw/hook/normalise-subagent-type.js'

// Repo root — this file lives at test/hooks/normalise-subagent-type-parity.test.ts
const REPO = new URL('../..', import.meta.url).pathname

// ── helpers ───────────────────────────────────────────────────────────────────

type Decision = {
  hookSpecificOutput?: {
    permissionDecision?: string
    permissionDecisionReason?: string
  }
}

function parseDecision(stdout: string): Decision {
  return stdout.trim() ? JSON.parse(stdout) : {}
}

function decision(result: { stdout: string }): string | undefined {
  return parseDecision(result.stdout).hookSpecificOutput?.permissionDecision
}

/** Build a PreToolUse payload for an Agent dispatch from a subagent context. */
function subagentAgentCall(subagentType: string): unknown {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Agent',
    tool_input: { subagent_type: subagentType, prompt: 'x' },
    agent_type: 'general-purpose',
    agent_id: 'abc123',
  }
}

// ── Section 1: source parity ──────────────────────────────────────────────────

describe('SEAM: normalise-subagent-type parity — Section 1: source parity', () => {
  const nestingSrc = readFileSync(join(REPO, 'src/gw/hook/nesting-guard.ts'), 'utf8')
  const modelSrc = readFileSync(join(REPO, 'src/gw/hook/agent-model-guard.ts'), 'utf8')

  it('nesting-guard imports from normalise-subagent-type.js', () => {
    expect(nestingSrc).toContain("from './normalise-subagent-type.js'")
  })

  it('agent-model-guard imports from normalise-subagent-type.js', () => {
    expect(modelSrc).toContain("from './normalise-subagent-type.js'")
  })

  it('nesting-guard does not declare a local normaliseName function', () => {
    expect(nestingSrc).not.toMatch(/function\s+normaliseName\s*\(/)
  })

  it('nesting-guard does not declare a local registryKey function', () => {
    expect(nestingSrc).not.toMatch(/function\s+registryKey\s*\(/)
  })

  it('agent-model-guard does not declare a local registryKey function', () => {
    expect(modelSrc).not.toMatch(/function\s+registryKey\s*\(/)
  })

  it('agent-model-guard does not declare a local normaliseName function', () => {
    expect(modelSrc).not.toMatch(/function\s+normaliseName\s*\(/)
  })
})

// ── Section 2: normalisation table ───────────────────────────────────────────

describe('SEAM: normalise-subagent-type parity — Section 2: normalisation table', () => {
  const cases: Array<{ raw: unknown; expected: string; label: string }> = [
    { raw: 'groundwork:general-purpose',     expected: 'general-purpose',     label: 'groundwork: prefix' },
    { raw: 'plugin:foo',                     expected: 'foo',                  label: 'plugin: prefix' },
    { raw: 'a:b:c',                          expected: 'c',                    label: 'multi-segment uses lastIndexOf' },
    { raw: 'bare-name',                      expected: 'bare-name',            label: 'bare name (no prefix)' },
    { raw: 'trailing:',                      expected: '',                     label: 'trailing colon → empty' },
    { raw: ':leading',                       expected: 'leading',              label: 'leading colon' },
    { raw: '',                               expected: '',                     label: 'empty string' },
    { raw: 123,                              expected: '',                     label: 'non-string → empty' },
    { raw: 'PLUGIN:General-Purpose',         expected: 'general-purpose',      label: 'case-folded' },
    { raw: 'groundwork:junior-orchestrator', expected: 'junior-orchestrator',  label: 'junior-orchestrator' },
  ]

  for (const { raw, expected, label } of cases) {
    it(`normaliseSubagentType(${JSON.stringify(raw)}) === ${JSON.stringify(expected)} — ${label}`, () => {
      expect(normaliseSubagentType(raw)).toBe(expected)
    })
  }
})

// ── Section 3: behavioural parity through both guards' real run() paths ───────

describe('SEAM: normalise-subagent-type parity — Section 3: behavioural parity', () => {
  const ENV = { CLAUDE_PLUGIN_ROOT: REPO }

  // Key parity invariant: both guards see the same bare name regardless of prefix form.
  it('normaliseSubagentType: plugin:general-purpose and groundwork:general-purpose produce the same bare name', () => {
    expect(normaliseSubagentType('plugin:general-purpose')).toBe(
      normaliseSubagentType('groundwork:general-purpose'),
    )
  })

  it('nesting-guard DENIES plugin:general-purpose from a subagent (normalises to general-purpose → DENIED_AT_DEPTH_1)', async () => {
    const result = await nestingRun(subagentAgentCall('plugin:general-purpose'), {})
    expect(decision(result)).toBe('deny')
  })

  it('nesting-guard DENIES groundwork:general-purpose from a subagent (baseline)', async () => {
    const result = await nestingRun(subagentAgentCall('groundwork:general-purpose'), {})
    expect(decision(result)).toBe('deny')
  })

  it('nesting-guard gives the same decision for plugin:general-purpose and groundwork:general-purpose', async () => {
    const pluginResult = await nestingRun(subagentAgentCall('plugin:general-purpose'), {})
    const groundworkResult = await nestingRun(subagentAgentCall('groundwork:general-purpose'), {})
    expect(decision(pluginResult)).toBe(decision(groundworkResult))
  })

  it('nesting-guard DENIES plugin:junior-orchestrator from a subagent (normalises to junior-orchestrator → Rule 1 deny)', async () => {
    const result = await nestingRun(subagentAgentCall('plugin:junior-orchestrator'), {})
    expect(decision(result)).toBe('deny')
  })

  it('agent-model-guard does not deny plugin:general-purpose based on normalisation alone (allows or injects model)', async () => {
    const result = await modelRun(subagentAgentCall('plugin:general-purpose'), ENV)
    expect(decision(result)).not.toBe('deny')
  })
})
