---
name: session-continue
description: When context is getting long or a fresh session is needed, present the user with a choice between same-session continuation (summary + continue) or /handoff to create a new session. Never silently drop context.
---

# Session Continue

## When to Use

Invoke when ANY of these are true:

- Context window is getting long (rough signal: >50 messages or >100k tokens)
- Agent is losing track of decisions made earlier in the session
- User says "start fresh", "new session", "continue in a new session"
- About to begin a large new phase of work (good natural breakpoint)

## Core Rule

Never silently start fresh or drop context. Always make the transition explicit and user-approved.

## Two Options (Present via `question` tool)

### Option 1: Same-Session Summary

Stay in this session. Compress the key context into a summary, prepend it as a system message, and continue.

Good for: short remaining work, user wants continuity, context is dense but manageable.

**How to execute:**
1. Write a context summary covering:
   - Current goal
   - Key decisions made
   - Current state of work (what's done, what's next)
   - Active files/paths
   - Any open questions
2. Continue the conversation with this summary visible

### Option 2: `/handoff`

Use the built-in `/handoff` command (provided by the groundwork plugin) to create a new session with the current context as an editable draft.

Good for: long remaining work, context overload, starting a new major feature, user preference.

**How to execute:**
1. Tell the user: "I'll create a handoff prompt. You can edit it before sending."
2. The user types `/handoff <brief description of what to continue>` in the TUI
3. The AI generates a handoff summary, calls `handoff_session` to open a new session
4. The new session auto-loads file references and can use `read_session` for the full transcript

## Presentation Template

Use `question` tool:

```
"Context is getting long. How would you like to continue?"

Options:
- "Summary + continue here" — compress context and keep going in this session
- "/handoff to new session" — create a new session with full context as editable draft
```

## Never Do

- Do not start a new topic and hope the user doesn't notice context was lost
- Do not invoke `/handoff` without user choosing it
- Do not drop file paths, decisions, or open questions from the summary
