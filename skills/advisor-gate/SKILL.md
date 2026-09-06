---
name: advisor-gate
description: Enforce the completion gate for the orchestrator, producing APPROVE/GAPS/CORRECTION/STOP/REPLAN verdicts before any task is declared done (orchestrator-only; subagents do not invoke this).
disable-model-invocation: false
---

# Advisor Gate

Gate completion review and hard-decision escalation for the orchestrator. Subagents do not invoke this skill, self-issue verdicts, or bypass the gate.

## Decision escalation

Escalate to advisor when any hold: architecture trade-off with high downstream cost; three materially different attempts on the same failure; ambiguous requirements with multiple plausible interpretations; security, data-loss, or destructive-operation risk. Do not escalate for routine edits, refactors, or mechanical changes.

## Completion gate

Before declaring done, invoke `advisor` with:

```
Task: <what was asked>
What was done: <summary of changes>
Verification run: <commands and output>
Requirements from spec/PRD: <list each requirement>
Each requirement met: <yes/no per item>
Per-AC verification: cite the test for each AC, or mark uncovered
Plan soundness: gap-types (missing|partial|contradicts|unrequested) if any
Uncertain or skipped: <list or "none">
Question: Is this complete and correct?
```

Verdict vocabulary:
- **APPROVE** — declare done; record `gw ledger gate --motive <slug> advisor APPROVE --token <write_token>`
- **GAPS** — unmet requirements; resume
- **CORRECTION** — approach is flawed; apply the fix
- **STOP** — surface blocker to user; gate stays closed
- **REPLAN** — re-enter feature-interview or vertical-slice; non-terminal

Do not skip the gate even if confident. Findings below CORRECTION are registered as ledger slices before recording APPROVE.

**Criterion: no-acceptance-layer** — see the `no-acceptance-layer` criterion in the advisor's Verification Protocol (Step 2, `agents-src/advisor.md`). WAIVER events in `.groundwork/journal/*.jsonl` (fallback `.groundwork/waivers/*.json`), matched by `dependency`, suppress SC-B1 for that dependency and SC-B2 only for the identity provider; SC-A4 has no waiver path; five fields required: `dependency`, `failing_criterion`, `scope`, `expiry_condition`, `contract_test`. A missing acceptance layer without a valid waiver is a CORRECTION, not a GAPS note. Trivial no-ledger tasks are exempt.

**Criterion: comment-density** — see the `comment-density` criterion in the advisor's Verification Protocol (Step 2, `agents-src/advisor.md`). APPROVE is blocked while any flagged file has no registered cleanup slice; run `bin/gw-hook comment-density report --json | bin/gw-hook comment-density remediate-plan --motive <slug>` and dispatch one haiku cleanup slice per flagged file in one wave.

## Risk-tiered gate

| Tier | Condition | Flow |
|---|---|---|
| Trivial | ≤2 files, ≤1 behavior, <1h, small verification surface | `advisor` |
| Small | Localized, clear, low blast radius | `advisor` |
| Feature | ≥3 files or ≥2 behaviors or shared code or large verification surface | `[qa if interactive UI] → advisor` |

## Evidence rules

Run the gate suite unfiltered, in the primary working directory, with environment controlled:

```
env -u CLAUDE_PROJECT_DIR -u CLAUDE_PLUGIN_ROOT CLAUDE_CODE_SESSION_ID=gate npx vitest run
```

A filtered run, a piped exit code, or a detached worktree invalidates the verdict.

## Gate failure modes

**Failure: advisor approves on fabricated evidence** — a verdict cites a line or test that does not exist → the gate closes on false evidence → the regression ships. Verify each load-bearing claim against source before recording the gate in the ledger. Full incident: `reference/failure-modes.md`.

**Failure: gate recorded without orchestrator write token** — a subagent writes `gate.advisor=APPROVE` without the ledger write token → stop-gate cannot verify provenance → session ends on a bypassed gate. The orchestrator records the gate itself and never trusts a gate it did not write.

**Failure: gate run in detached worktree** — a gate agent creates a worktree for attribution, producing phantom suite failures from missing runtime state → verdict contradicts a prior green run → unnecessary diagnose cycle. Brief gate agents against creating worktrees; re-run in the primary directory before acting on a contradicting verdict.

**Failure: filtered run hides cross-file breakage** — a per-slice filtered run reports green while the full suite is red → shared-enforcement changes pass per-slice but fail at session end. Always run unfiltered after any shared-enforcement change.

**Failure: implementer self-report overstates evidence** — correct artifacts paired with fabricated counts or test results → orchestrator gates on inflated numbers → regressions go undetected. Verify counts and test results directly; do not accept self-reported totals without evidence.

Remaining failure modes (incident + correction in `reference/failure-modes.md`):
per-slice-green-suite-red · pre-existing-failure-claims-need-diff-proof · two-distinct-suite-failure-modes · review-must-attribute-diff-vs-pre-existing · visual-evidence-stale-on-regen · enumerated-search-surfaces-inherit-blind-spots · trace-whole-enforcement-path-before-calling-spec-false

## Completion

Gate is closed when `gw ledger status --motive <slug>` shows `gate.advisor: APPROVE`.
