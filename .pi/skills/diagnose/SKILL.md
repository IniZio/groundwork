---
name: diagnose
description: Disciplined 6-phase bug diagnosis loop. Build feedback loop, reproduce, hypothesise, instrument, fix with regression test, cleanup with post-mortem. Use for all bugs — bypasses PRD entirely. Ends with advisor-gate completion gate.
---

# Diagnose

## Core Principle

**A disciplined loop, not guesswork.** The feedback loop IS the skill — everything else is mechanical. Without a fast, deterministic pass/fail signal, no amount of code reading will help.

This skill **replaces** `create-prd` and `bdd-implement` for bugs. Bugs go through: `interview` (optional scoping) → `diagnose` → `advisor-gate`. No PRD needed.

## When to Use

- Any reported bug or regression
- Performance degradation
- "It worked before, now it doesn't"
- User reports unexpected behavior
- Test failures that need root cause analysis

## The 6 Phases

### Phase 1 — Build a Feedback Loop

**"This is the skill. Everything else is mechanical."**

Construct a fast, deterministic, agent-runnable pass/fail signal. Without one, stop and ask for help.

**10 ways to build a loop (priority order):**

1. **Failing test** at whatever seam reaches the bug
2. **HTTP script** — `curl` / HTTP client against dev server
3. **CLI invocation** — fixture + diff stdout vs known-good snapshot
4. **Headless browser** — Playwright/Puppeteer script
5. **Replay trace** — captured network request, payload, or event log
6. **Throwaway harness** — minimal subset of the system
7. **Fuzz/property test** — 1000 random inputs
8. **Bisection harness** — for `git bisect run`
9. **Differential** — old version vs new version comparison
10. **HITL script** — human-in-the-loop bash script (last resort)

**Iterate on the loop itself.** Make it faster, sharper, more deterministic. A 2-second deterministic loop is a debugging superpower.

**Non-deterministic bugs:** Goal is higher reproduction rate (50% is debuggable; 1% is not). Loop 100x, parallelize, add stress.

**When genuinely impossible to build a loop:** Stop and say so. Ask for: (a) environment access, (b) captured artifact (HAR, log dump, core dump, screen recording), or (c) permission to add temporary production instrumentation.

### Phase 2 — Reproduce

Run the loop. Confirm:
- Reproduces the **user-described** failure (not a different nearby one)
- Reproducible across runs
- Exact symptom captured (error message, wrong output, timing)

If the loop doesn't reproduce: refine the loop or go back to Phase 1.

### Phase 3 — Hypothesise

Generate **3-5 ranked hypotheses** before testing any. Single-hypothesis generation causes anchoring.

Each hypothesis must be **falsifiable**: "If <X> is the cause, then <changing Y> will make the bug disappear / <making Z> will make it worse."

**Show the ranked list to the user before testing.** User often has domain knowledge to re-rank instantly.

**Parallel hypothesis testing:** Launch the top 2-3 hypotheses as **parallel exploration tasks** when they probe different parts of the system:
```
# Good: parallel probes of independent hypotheses
# Both orchestrator and coder can delegate to explore
task(description="Test hypothesis A: auth middleware", prompt="Check if the auth middleware strips the X-Token header when...", subagent_type="explore")
task(description="Test hypothesis B: race condition in cache", prompt="Check if the cache invalidation runs before the response...", subagent_type="explore")
```
**Only parallelize when hypotheses are independent.** If Hypothesis B depends on Hypothesis A being wrong, test A first.

### Phase 4 — Instrument

Each probe maps to a specific prediction from a hypothesis. **Change one variable at a time.**

Tool preference (in order):
1. Debugger / REPL
2. Targeted logs at hypothesis-distinguishing boundaries
3. Never "log everything and grep"

**Tag every debug log** with unique prefix `[DEBUG-xxxx]` — cleanup is a single grep.

**Performance branch:** For performance regressions, logs are usually wrong. Establish baseline measurement first.

### Phase 5 — Fix + Regression Test

Write regression test **before the fix** — at a correct seam (exercises the real bug pattern as it occurs at the call site).

If no correct seam exists, that itself is the finding — flag for architecture improvement and note in post-mortem.

**Parallel execution:** Write the regression test AND the fix simultaneously:
```
# Write the failing test first, then apply the fix in the same task
# The test and fix touch the same files, so they must be in the same task
# But you CAN parallelize: fix implementation + feedback loop verification
```

**For orchestrator:** Delegate the fix to a `coder` agent and verification to `explore`:
```
task(description="Write regression test + apply fix", prompt="...", subagent_type="coder")
task(description="Verify feedback loop passes after fix", prompt="...", subagent_type="explore")  # runs after fix task
```

**For coder:** Implement the fix and regression test yourself. You can delegate codebase verification to `explore` via `task(subagent_type="explore", ...)`.

**Sequence:**
1. Minimise reproduction → write failing test → watch it fail
2. Apply fix → watch test pass
3. Re-run original feedback loop → confirm fix

### Phase 6 — Cleanup + Post-Mortem

**Checklist:**
- [ ] Original reproduction no longer reproduces
- [ ] Regression test passes (or absence documented with reason)
- [ ] All `[DEBUG-xxxx]` instrumentation removed
- [ ] Throwaway prototypes deleted
- [ ] Correct hypothesis stated in commit/PR message

**Post-mortem question:** What would have prevented this bug?

If answer involves architectural change (no good test seam, tangled callers, hidden coupling), note it for future architecture improvement work.

## Abbreviated Mode

For **trivial bugs** where the cause is obvious (≤1 file, obvious fix):

Skip directly to: **Phase 1 (quick loop) → Phase 2 (reproduce) → Phase 5 (regression test + fix) → Phase 6 (cleanup)**

Skip Phase 3 (hypothesise) and Phase 4 (instrument) — there's only one plausible cause and it's already identified.

## Completion Gate

After Phase 6, invoke `advisor-gate` with:
- Original bug report
- Root cause (which hypothesis was correct)
- Fix summary
- Regression test location
- Post-mortem finding

**This is non-negotiable.** Diagnose always ends with `advisor-gate`.

## What NOT to Do

- Do NOT skip building a feedback loop — guessing at code is not diagnosis
- Do NOT test hypotheses one at a time as they're generated — generate all 3-5 first, rank, then test
- Do NOT write the fix before the regression test
- Do NOT leave `[DEBUG-xxxx]` instrumentation in the code
- Do NOT invoke `create-prd` or `bdd-implement` for bugs — this skill owns the entire bug path
- Do NOT skip the `advisor-gate` completion gate
