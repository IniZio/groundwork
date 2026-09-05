---
name: diagnose
description: "Debug a reported failure using the six-phase protocol: loop → reproduce → hypothesise → instrument → fix → post-mortem."
---

# Diagnose

## Failure modes

**Theory-first.** Reading code to build a hypothesis before a red-capable command exists — this produces anchored, unverifiable guesses. No command, no Phase 2.

**Proxy-bug.** Confirming a nearby failure instead of the user's exact symptom. The loop output must contain the user's exact error message or wrong value; a different failure proves nothing.

**In-repo perturbation.** Using `git stash` or any in-repo restore to produce the two-run red→green proof — this silently reverts sibling work. Use a scratch copy outside the repo (`cp <file> /tmp/backup`), restore from it, and verify byte-identity before reporting.

## The 6 Phases

### Phase 1 — Build a feedback loop

Construct a fast, deterministic, agent-runnable command that drives the actual bug code path and asserts the user's exact symptom. Run it at least once and record the invocation and output.

Loop construction options (priority order): failing test → HTTP script → CLI invocation with snapshot diff → headless browser → replay trace → throwaway harness → fuzz run → bisection harness → differential → HITL script. See [`reference/loop-construction.md`](reference/loop-construction.md) for detail on each.

Non-deterministic bugs: target a high reproduction rate (≥50% per run) by looping 100× or adding stress; a 1% rate is not debuggable.

When no loop is possible: state why and name what the human observer must look for; remaining phases are observation-based.

**Completion:** one command, already run, that is red-capable (asserts the exact symptom), deterministic, fast, and agent-runnable.

### Phase 2 — Reproduce + minimise

Run the loop. Confirm it names the user-described failure — exact error message or wrong output — and reproduces across runs. Remove every input, config, or dependency not needed to trigger it.

**Completion:** loop is red on this exact bug; surface is as small as possible.

### Phase 3 — Hypothesise

Write 3–5 ranked hypotheses before testing any. Each hypothesis names a specific module or line and is falsifiable: "if X is the cause, changing Y makes the bug disappear." Single-hypothesis generation causes anchoring.

Test highest-ranked first; if the loop stays red, eliminate and move to the next.

**Completion:** one named, falsifiable hypothesis remains.

### Phase 4 — Instrument

Map one probe to one prediction from the current hypothesis. Change one variable at a time. Prefer debugger or REPL; fall back to targeted logs tagged `[DEBUG-xxxx]` for easy cleanup sweep; never log everything and grep.

**Completion:** loop output contains evidence that confirms or eliminates the hypothesis.

### Phase 5 — Fix + regression test

Write the failing test before the fix, at a seam that exercises the real bug pattern at the call site. If no correct seam exists, that is the finding — flag for architecture improvement in the post-mortem.

**Two-run invariant:** the test file is byte-identical between the red run and the green run (`git diff --exit-code <testfile>` shows no output); the only diff between runs is production source reached through the product's own import path — not a formula re-implemented in the test; the red failure message names the diverging production values.

Perturbation procedure: `cp <file> /tmp/backup`; restore from that copy; verify byte-identity (`cmp` produces empty output) before reporting.

Apply the fix. Re-run the original loop to confirm it goes green.

**Completion:** loop green; regression test green; `git diff --exit-code <testfile>` empty.

### Phase 6 — Cleanup + post-mortem

Remove all `[DEBUG-xxxx]` instrumentation and scratch files. Confirm the original reproduction no longer triggers.

Post-mortem (1–3 sentences): what masked the bug, why existing tests missed it, one preventive measure. If architectural change is needed, note it as a future impl slice.

**Completion:** working tree clean; post-mortem written.

## Completion gate

Return to the orchestrator: root cause, fix summary, regression test path, and post-mortem. The orchestrator runs the advisor gate; do not invoke or simulate it.
