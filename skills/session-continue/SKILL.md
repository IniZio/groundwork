---
name: session-continue
description: When context is getting long or a fresh session is needed, summarize explicitly or write a continuation artifact. Never silently drop context.
---

# Session Continue

## When to Use

Invoke when ANY of these are true:

- Context window is getting long (rough signal: >50 messages or >100k tokens)
- Agent is losing track of decisions made earlier in the session
- User says "start fresh", "new session", "continue in a new session"
- About to begin a large new phase of work (good natural breakpoint)

## Core Rule

Never silently start fresh or drop context. Keep the current session when practical; otherwise write a file-only handoff and tell the user where it is.

## Two Options

### Option 1: Summary and continue

Stay in this session. Compress the key context into a summary, prepend it as a system message, and continue.

Good for: short remaining work, user wants continuity, context is dense but manageable.

**How to execute:**
1. Write a context summary covering:
   - Current goal
   - Key decisions made
   - Current state of work (what's done, what's next)
   - Active files/paths
   - Any open questions
2. Continue the conversation with the summary visible to the user

### Option 2: File-only handoff

Use the `handoff` skill to write a concise Markdown continuation artifact.

Good for: long remaining work, context overload, starting a new major feature, user preference.

**How to execute:**
1. Tell the user that a continuation artifact will be created.
2. Include the goal, current state, decisions, files, next steps, and active run state.
3. Give the user the exact file path; do not claim that a new session was opened.

## Presentation Template

Use a concise user-facing question or message when a choice is needed:

```
"Context is getting long. How would you like to continue?"

Options:
- "Summary + continue here" — compress context and keep going in this session
- "Write a handoff file" — save a continuation artifact for a later session
```

## Never Do

- Do not start a new topic and hope the user doesn't notice context was lost
- Do not write a handoff file unless the user chooses it or a fresh-session transition is necessary
- Do not drop file paths, decisions, or open questions from the summary
