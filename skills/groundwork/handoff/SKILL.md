---
name: handoff
description: Write a handoff document and pass context to a successor Claude Code session.
disable-model-invocation: true
---

# Handoff

## Core Principle

**A clean baton pass, not a context dump.** The successor session gets a short, structured handoff document plus a pointer to this session's full transcript. Summarize the state; let the successor grep the transcript for anything deeper.

**Hard rule: never silently drop context.** The handoff document must be shown to (or be readable by) the user before the old session is abandoned. If anything important cannot be captured in the document, say so explicitly rather than letting it vanish.

## When to Use

- Context window getting full and the task is not done
- Switching machines or terminals mid-task
- Ending a work block and wanting a clean baton pass for the next session

## Step 1 — Identify this session

The SessionStart hook injects a "Session identity" block (session_id, transcript_path) into context. Use those values.

**Fallback if the block is absent:** the transcript directory is `~/.claude/projects/<cwd with "/" and "." replaced by "-">/`, and the current session is the most recently modified `.jsonl` file there — verify with `ls -t`.

## Step 2 — Write the handoff document

Write `.claude/handoffs/<session_id>.md` (create the directory if needed) with these sections:

```markdown
# Handoff from session <session_id>

## Goal
What the overall task is.

## Current state
What is done, what is in flight.

## Decisions made
Each decision with a one-line rationale.

## Key files
path:line references.

## Next steps
Ordered, concrete.

## Previous session
- session_id: <session_id>
- transcript_path: <transcript_path>

If you need detail not captured above, read or grep the transcript JSONL at the path above (each line is a JSON message; filter by role/content).
```

**Rules:**
- Never include secrets or credentials in the handoff file
- Summarize, don't dump transcript

## Step 3 — Choose handoff mode

Use `AskUserQuestion` and offer three options:

a) **Spawn now (recommended)** — spawn a headless successor session immediately; user attaches later.
b) **Fork with full history** — print `claude --resume <old_session_id> --fork-session` for the user to run; clones the entire history into a new session id (no context shedding).
c) **File only** — just write the handoff document and print the launch one-liner for the user to run in a fresh terminal: `claude --session-id $(uuidgen) "$(cat .claude/handoffs/<id>.md)"`.

## Step 4 — Spawn (mode a)

```bash
NEW_ID=$(uuidgen)
nohup claude -p --session-id "$NEW_ID" "$(cat .claude/handoffs/<old_id>.md)" \
  > .claude/handoffs/<old_id>-spawn.log 2>&1 &
echo "$NEW_ID"
```

Run via Bash with `run_in_background`. Then tell the user:

- The successor session id is `$NEW_ID`
- Attach interactively with `claude --resume $NEW_ID`
- The headless run processes the handoff prompt, so the successor has already oriented itself by the time the user attaches

## Step 5 — Verify

Confirm the successor transcript exists: `~/.claude/projects/<munged-cwd>/$NEW_ID.jsonl`.

If the spawn failed, fall back to mode (c) and show the user the one-liner.

## Active Run — Ledger Context

If `.groundwork/run.json` exists and has `active: true`, the handoff document **must** include a run summary so the successor session inherits the run state. Add a **Run state** section to the handoff document:

- Render it with `node ${CLAUDE_PLUGIN_ROOT}/hooks/ledger.mjs view` (or `status` for a compact view).
- Include: the run's brief/goal, each incomplete slice (id, kind, status), and the gate verdict if one exists.
- The successor needs this to satisfy the Stop-gate — unresolved slices block session end.

Do not paste the raw JSON; use the ledger CLI output.

## What NOT to Do

- Do NOT dump raw transcript content into the handoff document — summarize and point at the transcript path
- Do NOT include secrets, tokens, or credentials in the handoff file
- Do NOT abandon the old session before the handoff document has been shown to (or is readable by) the user
- Do NOT declare the handoff complete in mode (a) without verifying the successor transcript exists
