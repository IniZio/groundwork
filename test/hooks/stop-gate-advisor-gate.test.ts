/**
 * AC-4 mechanical test: src/gw/hook/stop-gate.ts blocks session completion unless
 * gate.advisor === 'APPROVE' is recorded in the active run ledger.
 *
 * Criterion (verbatim from motive charter AC-4):
 *   "The session stop hook blocks completion until gate.advisor === 'APPROVE'
 *   is recorded in the active run ledger; the check is mechanical and does not
 *   rely on agent memory or self-report. Enforced by src/gw/hook/stop-gate.ts reading
 *   ledger.gate via advisorVerdict() (line 317) and blocking unless the result
 *   equals 'APPROVE' (line 616)."
 *
 * LINE REFERENCE AUDIT (performed against source before writing this test):
 *   - advisorVerdict() function definition: line 317 — ACCURATE
 *   - advisorApproved = advisorVerdict(ledger.gate) === 'APPROVE': line 616 — ACCURATE
 *
 * DESIGN:
 *   Each test case writes its own ledger fixture into a temp projectDir and
 *   invokes the hook as a subprocess. Fixtures use "trivial" in brief to
 *   satisfy trivialEscape (line 668) and bypass the plan-ref pre-gate. All
 *   slices are complete so the ONLY blocking factor is the advisor gate state.
 *
 * ASSERTIONS target the user-visible blocking output (JSON printed to stdout)
 * AND the exit code. The hook calls process.exit(0) on BOTH paths; the
 * mechanical distinction is the `decision: "block"` field in the payload.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = new URL('../../', import.meta.url).pathname
const STOP_GATE = join(ROOT, 'bin', 'gw-hook')

// ─── Temp project dir (isolated from live session ledger) ───────────────────

let projectDir: string

beforeAll(() => {
  projectDir = join(tmpdir(), `stop-gate-advisor-${randomBytes(4).toString('hex')}`)
  mkdirSync(join(projectDir, '.groundwork', 'runs'), { recursive: true })
})

afterAll(() => {
  rmSync(projectDir, { recursive: true, force: true })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uniqueSessionId(): string {
  return `test-${randomBytes(6).toString('hex')}`
}

/**
 * Write a minimal active ledger to .groundwork/runs/<sessionId>.json.
 *
 * Design choices that isolate the advisor gate as the sole blocking variable:
 *   - brief contains "trivial" → trivialEscape triggers, plan-ref pre-gate skipped
 *   - single plan slice (kind: 'plan') is complete → incomplete.length === 0
 *   - reinforcements: 0, progressSig: '' → reinforcement cap never trips
 */
function writeLedger(sessionId: string, gate: unknown): void {
  const ledger = {
    id: sessionId,
    session_id: sessionId,
    active: true,
    brief: 'trivial test run for advisor gate',
    reinforcements: 0,
    progressSig: '',
    slices: [
      {
        id: 'S1',
        kind: 'plan',
        status: 'complete',
        desc: 'plan slice',
        blocked_by: [],
        acceptance: [],
      },
    ],
    gate,
  }
  writeFileSync(
    join(projectDir, '.groundwork', 'runs', `${sessionId}.json`),
    JSON.stringify(ledger, null, 2),
  )
}

type HookOutput = {
  decision?: string
  reason?: string
  continue?: boolean
  hookSpecificOutput?: { hookEventName?: string; additionalContext?: string }
}

/**
 * Invoke the stop-gate hook as a subprocess with a Stop-event stdin payload.
 * Returns parsed JSON output and exit code.
 *
 * The hook always exits with code 0 (process.exit(0) on both allow and block
 * paths). The `decision: "block"` field in the JSON payload is the mechanical
 * signal the Claude Code harness uses to refuse session termination.
 */
function runGate(sessionId: string): { out: HookOutput; exitCode: number } {
  const r = spawnSync(STOP_GATE, ['hook', 'stop-gate'], {
    input: JSON.stringify({ session_id: sessionId }),
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      CLAUDE_PROJECT_DIR: projectDir,
    },
    encoding: 'utf8',
  })
  const out: HookOutput = r.stdout?.trim() ? (JSON.parse(r.stdout) as HookOutput) : {}
  return { out, exitCode: r.status ?? -1 }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('stop-gate — advisor gate blocks completion until APPROVE', () => {
  // ── BLOCK cases ────────────────────────────────────────────────────────────

  it('BLOCKS when gate.advisor is absent (empty gate object)', () => {
    const sid = uniqueSessionId()
    writeLedger(sid, {}) // no advisor field
    const { out, exitCode } = runGate(sid)

    // Exit code is 0 on both paths; the blocking signal lives in the payload.
    expect(exitCode).toBe(0)
    expect(out.decision).toBe('block')
    // User-visible reason must name the gate and tell what's required.
    expect(out.reason).toContain('⛔ GROUNDWORK STOP-GATE')
    expect(out.reason).toContain('Completion gate — advisor:')
    expect(out.reason).toContain('must be APPROVE')
    // The harness reads hookSpecificOutput.additionalContext for the block message.
    expect(out.hookSpecificOutput?.additionalContext).toContain('⛔ GROUNDWORK STOP-GATE')
  })

  it('BLOCKS when gate.advisor is the string "CORRECTION"', () => {
    const sid = uniqueSessionId()
    writeLedger(sid, { advisor: 'CORRECTION' })
    const { out, exitCode } = runGate(sid)

    expect(exitCode).toBe(0)
    expect(out.decision).toBe('block')
    expect(out.reason).toContain('⛔ GROUNDWORK STOP-GATE')
    // The displayed verdict should be the actual value, not a generic placeholder.
    expect(out.reason).toContain('Completion gate — advisor: CORRECTION')
  })

  it('BLOCKS when gate.advisor is the string "REPLAN"', () => {
    const sid = uniqueSessionId()
    writeLedger(sid, { advisor: 'REPLAN' })
    const { out } = runGate(sid)

    expect(out.decision).toBe('block')
    expect(out.reason).toContain('Completion gate — advisor: REPLAN')
  })

  it('BLOCKS when gate.advisor is the string "GAPS"', () => {
    const sid = uniqueSessionId()
    writeLedger(sid, { advisor: 'GAPS' })
    const { out } = runGate(sid)

    expect(out.decision).toBe('block')
    expect(out.reason).toContain('Completion gate — advisor: GAPS')
  })

  // ── RELEASE cases ──────────────────────────────────────────────────────────

  it('RELEASES when gate.advisor is the bare string "APPROVE"', () => {
    const sid = uniqueSessionId()
    writeLedger(sid, { advisor: 'APPROVE' })
    const { out, exitCode } = runGate(sid)

    expect(exitCode).toBe(0)
    // Allow path: continue:true, no block decision.
    expect(out.continue).toBe(true)
    expect(out.decision).toBeUndefined()
  })

  it('RELEASES when gate.advisor is the object form { verdict: "APPROVE" }', () => {
    const sid = uniqueSessionId()
    writeLedger(sid, {
      advisor: {
        verdict: 'APPROVE',
        rubric: 'all slices verified',
        citation: 'test citation',
      },
    })
    const { out, exitCode } = runGate(sid)

    expect(exitCode).toBe(0)
    expect(out.continue).toBe(true)
    expect(out.decision).toBeUndefined()
  })

  it('RELEASES when gate.advisor object verdict is lowercase "approve" (toUpperCase normalisation)', () => {
    // advisorVerdict() applies .toUpperCase() on the string form and String().toUpperCase()
    // on the object verdict, so case-insensitive values also release the gate.
    const sid = uniqueSessionId()
    writeLedger(sid, { advisor: { verdict: 'approve' } })
    const { out } = runGate(sid)

    expect(out.continue).toBe(true)
    expect(out.decision).toBeUndefined()
  })
})
