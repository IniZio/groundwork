---
name: ultrawork
description: Engage maximum parallel fan-out mode. Use when you want to work 10x faster by dispatching all independent work simultaneously to specialist agents. Triggers on "ultrawork", "ulw", "fan out hard", "go parallel".
---

# Ultrawork Mode — Maximum Fan-Out Protocol

You are now operating in **Ultrawork Mode**. This changes your default execution behavior for the rest of this session.

## The Prime Directive

**Fire all independent agent calls simultaneously. NEVER serialize independent work.**

Sequential execution is the #1 velocity killer. If two tasks don't share state, they run in parallel. Always.

## Execution Policy

1. **Fan out FIRST.** Before writing a single line, decompose the full task into the smallest independent slices and launch all of them at once.
2. **One objective per task.** If describing a task takes more than 2 sentences — split it. "Implement auth + tests + logging" = 3 tasks.
3. **ALL parallel Task calls in ONE message.** Sending Task A in one message, then Task B in the next is sequential execution in disguise.
4. **Route to the right specialist.** Don't use `coder` for exploration. Don't use `explore` for implementation. Use the right tool.
5. **Use cheapest capable model tier per slice** (already set per agent; trust the defaults).
6. **Context-isolate every task — durably.** Each Task prompt must be self-contained (never rely on "the agent knows what we discussed"), but describe the work by **behavioral contract, not pinned line numbers**: the files the slice owns, the interfaces/signatures it must satisfy, and observable acceptance criteria. Line ranges rot the instant a sibling slice edits the file — a contract survives. The ledger's `files[]` still lists ownership for conflict detection; that is structural, not the brief.

## Agent Dispatch — Exact Syntax

```
# Wave 1: Parallel exploration (fire all at once)
Task(subagent_type="groundwork:explore", prompt="TASK: Map the auth module...\nCONTEXT: src/auth/\nSUCCESS: Return file list + key function names")
Task(subagent_type="groundwork:explore", prompt="TASK: Find all callers of validateUser...\nCONTEXT: src/\nSUCCESS: Return file:line references")

# Wave 2: Parallel implementation (fire all at once, after wave 1 results)
Task(subagent_type="groundwork:coder", prompt="TASK: Add rate limiting to POST /login\nCONTEXT: src/routes/auth.ts:45-80\nSCOPE: only this file\nSUCCESS: 429 returned after 5 failed attempts")
Task(subagent_type="groundwork:coder", prompt="TASK: Add audit log on auth failure\nCONTEXT: src/services/logger.ts:12-30\nSCOPE: only this file\nSUCCESS: WARN log emitted with userId + IP")
Task(subagent_type="groundwork:coder", prompt="TASK: Add test for rate limiter\nCONTEXT: tests/auth.test.ts\nSCOPE: only this file\nSUCCESS: test passes, covers 5-attempt threshold")
Task(subagent_type="groundwork:designer", prompt="TASK: Add error state UI for rate-limit response\nCONTEXT: src/components/LoginForm.tsx:20-60\nSCOPE: only this file\nSUCCESS: red banner shown with retry-after time")

# Wave 3: Verification (after wave 2 completes)
Task(subagent_type="groundwork:verifier", prompt="TASK: Verify auth rate limiting works end to end\nACCEPTANCE: 5 failed attempts → 429; audit log written; UI shows error\nSCOPE: run the test suite and check logs")
```

## Anti-Patterns — These Are Failures

```
# BAD: Sequential — costs 3x wall time
Task(coder, "add rate limiting") → wait → Task(coder, "add audit log") → wait → Task(coder, "add tests")

# BAD: Orchestrator implementing directly
Edit(file, "add rate limiting logic here")  ← YOU ARE THE ORCHESTRATOR, NOT THE CODER

# BAD: Mega-task
Task(coder, "implement rate limiting + audit logging + tests + UI error state")  ← 4 tasks in 1

# BAD: Vague context
Task(coder, "implement as we discussed")  ← subagent has no session history

# BAD: Under-sliced wave
Task(coder, "do step 1")  ← if you have only 1-2 tasks on a non-trivial feature, you haven't sliced hard enough
```

## Task Graph Template (for non-trivial work)

Before dispatching, declare:

```
TASK GRAPH:
Wave 0 (tracer bullet — 1 task): [prove E2E path works]
Wave 1 (exploration — parallel): [list each explore task]
Wave 2 (implementation — parallel): [list each coder/designer task]
Wave 3 (verification): verifier → critic → advisor
```

Then fire Wave 0, wait, assess, fire Wave 1+2 together if Wave 0 passed.

## Fan-Out Targets

| Agent | Tasks per wave |
|---|---|
| `explore` | 3–7 (one per area/module) |
| `coder` | 5–20 (one per semantic slice) |
| `designer` | 2–5 |
| `test-engineer` | 2–5 |
| `advisor` / `critic` | 1–2 (decision gates only) |

## Pre-Delegation Declaration (mandatory)

Before every Task call, state:
```
Agent: [which specialist]
Reason: [why this agent, not another]
Success criteria: [how I'll know it worked]
```

This surfaces bad routing before the token is spent.

## Completion Gate

When ALL waves finish:
1. `groundwork:verifier` — evidence only, no assumptions
2. `groundwork:critic` — if code changed
3. `groundwork:advisor` — APPROVE / REVISE / REJECT

No APPROVE = not done. "It should work" is not evidence.
