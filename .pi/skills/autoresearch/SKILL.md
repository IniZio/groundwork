---
name: autoresearch
description: Stateful time-bounded improvement loop with evaluator contract and dual logging
argument-hint: "[--mission-dir <path>] [--max-runtime <duration>] [--resume <run-id>]"
---

# Autoresearch

Autoresearch is a stateful skill for bounded, evaluator-driven iterative improvement. It runs one mission at a time, iterates through non-passing results, and records each evaluation as durable artifacts. It stops only when the max-runtime ceiling or another explicit terminal condition is reached.

## Contract

- **Single-mission only**: one active mission per run
- **Mission setup**: Use `deep-interview --autoresearch` to generate `mission.md` and `evaluator.json` — autoresearch does NOT generate its own evaluator
- **Evaluator output**: structured JSON with required `pass: boolean` and optional `score: number`
- **Non-passing does NOT stop the loop**: continue iterating regardless of pass/fail
- **Stop conditions**: max-runtime ceiling (primary) or explicit user cancellation

## Artifact Layout

```
.pi/autoresearch/<mission-slug>/
  mission.md              ← what are we trying to improve or prove
  evaluator.json          ← evaluator command/script reference
  runs/<run-id>/
    evaluations/
      iteration-0001.json  ← {"pass": bool, "score"?: number, "notes"?: string}
      iteration-0002.json
    decision-log.md        ← human-readable narrative per iteration
```

Each run gets a new `<run-id>` directory. Cron-scheduled reruns append new run dirs — never overwrite.

## Workflow

1. **Verify artifacts**: Confirm `mission.md` and `evaluator.json` exist under `.pi/autoresearch/<mission-slug>/`. If not, stop and instruct the user to run `deep-interview --autoresearch` first.

2. **Record state**: Create `runs/<run-id>/` directory. Record: mission slug, iteration count (start: 0), started timestamp, max-runtime deadline.

3. **Iterate** — repeat until stop condition:
   a. Run one experiment or change cycle based on `mission.md` guidance
   b. Run the evaluator and capture its JSON output
   c. Persist `evaluations/iteration-NNNN.json` (machine-readable)
   d. Append a human-readable entry to `decision-log.md` (what was tried, what the evaluator returned, what to try next)
   e. Continue unconditionally — `pass: false` is data, not a stop signal

4. **Stop**: When max-runtime is reached or user explicitly cancels. Do not self-terminate on pass.

5. **Summarize**: Read `decision-log.md` and produce a summary: how many iterations ran, trend in `score` if present, best result seen, recommended next steps.

## Evaluator JSON Format

The evaluator must output valid JSON to stdout:

```json
{"pass": false, "score": 0.73, "notes": "routing accuracy improved but still missing security cases"}
```

Only `pass` is required. `score` and `notes` are optional but recommended for trend tracking.

## Decision Log Entry Format (per iteration)

```markdown
## Iteration 0001 — <timestamp>

**Tried**: <what change or experiment was run>
**Evaluator result**: pass=false, score=0.73
**Observation**: <what the result tells us>
**Next**: <what to try in the next iteration>
```
