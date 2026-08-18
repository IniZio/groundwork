# Task Scoping & Subagent Task Reference

## Codex Scope

This reference documents multi-agent hosts. Codex has no implied dispatch API:
use its available plan/delegation surfaces when present, otherwise perform the
scoped work locally. The task examples below are not Codex commands.

## Task Quick Reference

Use the builtin `task` tool to delegate work to subagents:

```
task(description="...", prompt="...", subagent_type="groundwork:explore")
```

Tasks can be in states: `running`, `completed`, `failed`.

When a task fails:
- **Check for errors** before using output.
- **Retry vs Cancel**: Retry transient failures (network timeout). Cancel persistent/fundamental failures.

## Scoping Rules for Subagent Tasks

1. **Max 3 files per task.** If >3 files, split into multiple tasks.
2. **Max ~200 LOC per task.** If a single file needs >200 lines, embed full content inline in the prompt.
3. **One responsibility per task.** "Create types.ts" is good. "Create all lib files" is bad.
4. **Embed source in prompts.** Subagents cannot reliably read large source files — embed reference material directly in the prompt text. Do NOT tell the subagent to "read file X".
5. **Verify task output immediately.** If result says `(No text output)` or wrong files were created, relaunch with corrections.

6. **Non-trivial work needs a planning artifact first.** Before fanning out `general-purpose` on a feature/SmallRisky task, the orchestrator MUST have a durable `motive_ref` from the `interview` → `planner` pipeline pointing to a motive charter at `.groundwork/motives/<slug>/motive.md`. `interview` is the human front door; `planner` is the delegated stage that emits the charter. Do not embed a memory-only plan and fan out. Trivial / small-clear / docs / obvious-bug paths stay exempt.

## Failed Task Recovery

1. **Relaunch with corrected prompt** — include lessons learned and clearer instructions.
2. **Only after relaunch fails**, do the work yourself — explain to user WHY you're doing it directly.

## Subagent Auto-Preamble

Every subagent task automatically gets `[SUBAGENT TASK RULES — MANDATORY]` prepended:
- Never call `question` or user-input tools
- Never call `task` or `delegate` — blocked in child sessions
- Make decisions autonomously
- Return final result in last message

This is the **soft prevention** layer. The **hard deny** layer in each specialist's frontmatter (`permission.question: deny`) catches any agent that ignores the preamble.

## Context Isolation

<!-- CONTEXT-ISOLATION-TEMPLATE:BEGIN -->
Subagents do NOT inherit session history. Every task prompt MUST be self-contained:

```
Task(
  subagent_type="groundwork:general-purpose",
  prompt="""
  TASK: <one clear objective — max 2 sentences>
  CONTEXT: src/lib/foo.ts:45-80 implements X; constraint: don't break Y
  MOTIVE: <slug>   # motive charter at .groundwork/motives/<slug>/motive.md
  SUCCESS CRITERIA: <observable, verifiable outcome>
  SCOPE: touch only the files listed above.
  """
)
```

Avoid: vague "as discussed", file dumps without line ranges, full session summaries.

Every `Task`/`Agent` call MUST include `model:` explicitly; omitting it silently inherits the expensive session model and drives up cost for every background task.
<!-- CONTEXT-ISOLATION-TEMPLATE:END -->
