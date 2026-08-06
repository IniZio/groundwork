---
name: diagnose
description: Disciplined 6-phase bug diagnosis loop. Build feedback loop, reproduce, hypothesise, instrument, fix with regression test, cleanup with post-mortem. Use for all bugs. Ends with advisor-gate completion gate.
---

# Diagnose

## Platform contract

The diagnosis loop is shared. Ledger commands, delegation, and completion gates
depend on the host. In Codex, use only native tools documented in the current
session; otherwise track diagnosis state in the plan or handoff artifact and
label delegation, ledger state, and advisor review as advisory.

## Core Principle

**A disciplined loop, not guesswork.** The feedback loop IS the skill — everything else is mechanical. Without a fast, deterministic pass/fail signal, no amount of code reading will help.

**Verify the claim before any fix is delegated (triage gate).** Reproduce the reported failure FIRST — run it, observe the actual symptom (Phases 1–2) — before routing a fix to a general-purpose. MUST NOT delegate a fix for a bug you have not reproduced: a fix for an unconfirmed claim is a guess, and guesses ship the wrong change. **If you cannot reproduce it**, do NOT proceed to a fix — stay in triage: sharpen the loop, gather evidence (logs, HAR, a failing input, environment access), or ask the user for the missing piece. "Can't reproduce" is a reason to investigate, not to guess-patch.

This skill **replaces** `implement` for bugs. Bugs go through: `interview` (optional scoping) → `diagnose` → `advisor-gate`.

## When to Use

- Any reported bug or regression
- Performance degradation
- "It worked before, now it doesn't"
- User reports unexpected behavior
- Test failures that need root cause analysis

## The 6 Phases

### Phase 1 — Build a Feedback Loop

**"This is the skill. Everything else is mechanical."**

**Seed tracking when supported.** Before building the loop, create a tracked diagnosis item through the host's documented ledger interface. If Codex has no such interface, record the item in the plan or handoff artifact; no Stop-gate enforcement should be assumed.

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

**Parallel hypothesis testing:** Launch independent probes in parallel only via the host's documented native delegation surface. In Codex, if no such surface is available, test them sequentially and note the fallback.
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

**For orchestrator:** Delegate the fix and verification using the host's documented agent interface. If unavailable in Codex, perform the bounded fix and verification in sequence.

**For general-purpose:** Implement the fix and regression test yourself. Use a native verification delegate only when the host documents one.

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

If the post-mortem surfaced a **reusable lesson** — a recurring gotcha, a class of root cause, or something that would have prevented this bug if it had been written down — invoke `/retrospective` to codify it durably into the Learnings KB rather than letting it evaporate in the transcript.

**Close tracking when supported.** Mark the diagnosis entry complete through the host's documented ledger interface. Otherwise record completion in the plan or handoff artifact. Any fix work should remain a separately identified impl slice.

## Abbreviated Mode

For **trivial bugs** where the cause is obvious (≤1 file, obvious fix):

Skip directly to: **Phase 1 (quick loop) → Phase 2 (reproduce) → Phase 5 (regression test + fix) → Phase 6 (cleanup)**

Skip Phase 3 (hypothesise) and Phase 4 (instrument) — there's only one plausible cause and it's already identified.

## Completion Gate

After Phase 6, return the following evidence to the **orchestrator** — the orchestrator runs the `advisor-gate`, not you:
- Original bug report
- Root cause (which hypothesis was correct)
- Fix summary
- Regression test location
- Post-mortem finding

**Do not invoke or simulate the advisor gate yourself.** Report evidence; gating is the orchestrator's job.

## What NOT to Do

- Do NOT skip building a feedback loop — guessing at code is not diagnosis
- Do NOT test hypotheses one at a time as they're generated — generate all 3-5 first, rank, then test
- Do NOT write the fix before the regression test
- Do NOT leave `[DEBUG-xxxx]` instrumentation in the code
- Do NOT invoke `implement` for bugs — this skill owns the entire bug path
- Do NOT skip the `advisor-gate` completion gate
