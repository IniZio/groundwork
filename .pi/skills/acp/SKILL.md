---
name: acp
description: Agent Communication Protocol — fan-out dispatch reference for Claude plugin orchestration
---

# Agent Communication Protocol (ACP)

Informational reference for the orchestrator. Load when you need dispatch rules, agent roster, or context isolation patterns.

## Full Agent Roster

All agents require the `groundwork:` prefix: `Task(subagent_type="groundwork:explore", ...)`.

| Agent | Role | Writes? |
|-------|------|---------|
| `explore` | Codebase exploration, file reading, "how does X work?" | READ-ONLY |
| `planner` | Feature planning, codebase research, writes `.omc/plans/*.md` | READ-ONLY |
| `coder` | Implementation, tests, builds | YES |
| `designer` | UI/UX, styling, visual polish | YES |
| `debugger` | Root-cause analysis, error diagnosis | READ-ONLY |
| `test-engineer` | Test strategy, coverage, flaky test diagnosis | YES |
| `code-reviewer` | Code quality, SOLID, logic defects | READ-ONLY |
| `security-reviewer` | OWASP, secrets, injection vulnerabilities | READ-ONLY |
| `critic` | Plan/architecture validation, quality gate | READ-ONLY |
| `verifier` | Evidence-based completion check (rejects "should work") | READ-ONLY |
| `advisor` | Strategic decisions, hard trade-offs, completion APPROVE gate | READ-ONLY |
| `oracle` | High-stakes architectural guidance within executor workflows | YES |
| `git-master` | Atomic commits, rebasing, history management | YES |
| `observer` | Screenshot/image/PDF analysis, visual comparison | READ-ONLY |

## Context Isolation (from Superpowers pattern)

**Subagents do not inherit session history.** Each dispatch is a crafted, self-contained context block. Never rely on "the agent knows what we discussed." Always include:

```
Task(
  subagent_type="groundwork:coder",
  prompt="""
  TASK: <specific, scoped description>
  
  CONTEXT:
  - File to edit: src/lib/foo.ts:45-80 (implements X)
  - Constraint: must not break Y (see src/lib/bar.ts:12)
  - Plan: .omc/plans/feature-xyz.md (step 3)
  
  SUCCESS CRITERIA:
  - <concrete observable outcome>
  
  SCOPE: touch only the files listed above.
  """
)
```

The more scoped the context block, the better the output. Avoid: full conversation summaries, vague "as discussed", or file dumps without line ranges.

## Fan-Out Dispatch

**ALL parallel Task calls in ONE message.** Never sequential across messages.

**Wave 0 — Tracer Bullet** (1-2 tasks): Prove the E2E path before full fan-out. Pick one representative slice.

**Wave N — Full Fan-Out**: Once Wave 0 succeeds, launch ALL independent tasks in parallel. Fewer than 5 tasks on a complex feature = under-sliced. Decompose harder.

```
# Example: parallel coder fan-out after planner
Task(subagent_type="groundwork:coder", prompt="...context block A...")
Task(subagent_type="groundwork:coder", prompt="...context block B...")
Task(subagent_type="groundwork:coder", prompt="...context block C...")
# All in one message — they run concurrently
```

## Standard Completion Flow

After implementation, always run in order:

1. `verifier` — fresh evidence only; rejects "should", "probably", "seems to"
2. `code-reviewer` — if any code changed
3. `advisor` — final APPROVE/REVISE/REJECT gate

## Context Window Hygiene

Every byte a tool returns enters the orchestrator's conversation memory and costs reasoning capacity for the rest of the session. Protect it.

**Exploration:**
- Prefer `ctx_batch_execute` over direct `Bash` for research — results are indexed; only matching excerpts surface on query, raw output stays out of context.
- When spawning `explore` or `general-purpose` for investigation, cap output in the prompt: "report in ≤200 words, file:line pairs only, no code blocks." Verbose agent returns inflate context permanently.
- Use targeted `grep`/`find` via Bash instead of `Read` when you don't need to edit the file immediately. `Read` loads the full file into context.

**Editing:**
- Delegate file edits to `groundwork:coder` in a worktree. The agent does the work in its own context; only the summary returns here.
- Never `Read` a file just to understand it before delegating an edit — pass file path + line range in the coder prompt; the coder will `Read` it in its own context.

**Subagent output contracts:**
- Always specify an output format in exploration prompts. Unspecified = verbose = bloat.
- For investigation tasks: "return a bullet list of findings, ≤10 items, file:line format."
- For confirmation tasks: "reply with PASS or FAIL and one sentence."

## Anti-Patterns

- **Sequential when parallel**: If two tasks don't share state, they fan out. Always.
- **Context bleed**: Never pass session history to subagents — craft a scoped context block.
- **Self-delegation**: Orchestrator never spawns another `general-purpose` or `orchestrator`.
- **Mega-tasks**: >3 files or >200 LOC = split it first.
- **Assumption-based completion**: `verifier` must run; "it should work" is not evidence.
- **Verbose exploration in main context**: Researching in the orchestrator context instead of delegating to an explore agent with a tight output contract. The raw bytes of every Read/Bash call stay in context forever.
- **Read before delegate**: Reading a file to "understand" it before handing off to a coder. Pass the path; let the coder read it in its own context.

## Error Escalation

Same subtask fails 3× in a row:
1. Stop retrying
2. Collect: all error messages, all attempted approaches, the specific blocker
3. Spawn `advisor`: "3 consecutive failures on [task]. Tried: ... Blocker: ..."
4. Wait for advisor recommendation before proceeding
