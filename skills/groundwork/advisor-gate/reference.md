# Advisor Gate Reference

## 1% Chance Escalation Rule

If there is even a 1% chance the next decision is high-impact, ambiguous, or hard to reverse — invoke `advisor`. Prefer one early checkpoint over late-stage rework.

## Decision Escalation Template

```markdown
## Advisor Request
Goal: <target outcome>
Current status: <what has been tried>
Constraints: <time/risk/perf/security requirements>
Options considered: <A/B and why unresolved>
Decision needed: <single concrete question>
```

## Completion Gate Template

```markdown
## Completion Gate Request
Task: <what was asked>
What was done: <summary of changes>
Verification run: <commands run and their output>
Requirements from spec/PRD: <list each requirement>
Each requirement met: <yes/no per item>
Anything uncertain or skipped: <list or "none">
Question: Is this complete and correct?
```

## Advisor Response Template

```markdown
## Advisor Guidance
Type: PLAN | CORRECTION | STOP | APPROVE | GAPS
Rationale: <short reason>
Actions:
1. <step one>
2. <step two>
Risks to watch:
- <risk>
```

## Invocation Record (append per escalation)

```markdown
## Advisor Invocation Record
Timestamp: <YYYY-MM-DD HH:MM:SS>
Type: DECISION | COMPLETION_GATE
Trigger: <why invoked>
Decision requested: <question>
Advisor result type: PLAN | CORRECTION | STOP | APPROVE | GAPS
Executor follow-up: <next action taken>
```

## Example: Completion Gate — APPROVE

1. Executor finishes feature, runs tests (all pass), verifies screenshots before/after.
2. Sends completion gate with all requirements listed, each marked met.
3. Advisor returns APPROVE.
4. Executor tells user: "Done."

## Example: Completion Gate — GAPS

1. Executor believes feature is done.
2. Sends completion gate; spec had 4 requirements, executor only addressed 3.
3. Advisor returns GAPS: "Requirement 4 (error state UI) not addressed."
4. Executor resumes, implements error state, re-runs completion gate.

## Example: Decision — Architecture

1. Executor uncertain between two caching strategies.
2. Escalates with constraints (latency target, memory cap).
3. Advisor returns PLAN: in-memory with interface boundary.
4. Executor implements, validates, reports outcome.

## Example: Stop Signal

1. Executor detects destructive migration risk without rollback.
2. Escalates for decision.
3. Advisor returns STOP with requirement: define rollback and data backup procedure first.
4. Executor halts execution and asks user for approval/constraints.

## Example: Completion Gate — Pushback on Waived Verification

1. Executor completes feature but skips e2e tests, noting "dev server not running."
2. Sends completion gate with "e2e tests: skipped (server not up)" under uncertain/skipped.
3. Advisor returns CORRECTION:
   - "Dev server not running is not an acceptable reason to skip e2e. Investigate how to start it."
   - Suggests: `npm run dev` or `docker compose up`, check README for setup instructions.
   - "Re-run completion gate after starting the server and running e2e."
4. Executor investigates server startup, starts the server, runs e2e tests, re-submits completion gate.

## Example: Completion Gate — Pushback on Missing Fixture

1. Executor completes feature but skips integration test, noting "test fixture not ready."
2. Advisor returns GAPS:
   - "Fixture setup is part of the task. What did you try?"
   - Suggests: look at how other fixtures in the test suite are created, check for seed scripts or factory helpers.
   - "Create or prepare the fixture, then run the integration test. Re-submit completion gate."
3. Executor examines existing test setup patterns, creates the fixture, runs tests, re-submits.

## Example: Completion Gate — Acceptable Waiver (Rare)

1. Executor completes feature. E2e test requires staging environment with valid API key.
2. Executor attempted: tried `npm run staging`, got auth error. Checked README for key setup. Documented the attempt with error output.
3. Advisor confirms: staging API key is genuinely external (user must provision it).
4. Advisor returns APPROVE with note: "E2e against staging waived — API key requires user provisioning. All other verification passed. Flag to user."
5. Executor tells user: "Done. Note: e2e against staging could not run — needs API key. See <error output>."
