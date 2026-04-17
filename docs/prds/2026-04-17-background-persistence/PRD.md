---
type: master
feature_area: background-persistence
date: 2026-04-17
status: active
child_prds: []
---

# Background Task Persistence

## Overview

The groundwork plugin's `background_task` system loses data when advisor or sub-agent responses are large. The `formatTaskResult()` function extracts all assistant/tool text from the sub-session and injects it directly into the parent context via `promptAsync`. Large responses get truncated. There is no disk persistence, no compaction safety net, and no separation between notification and retrieval.

This feature adopts the architecture patterns from [kdcokenny/opencode-background-agents](https://github.com/kdcokenny/opencode-background-agents) to make background task results durable, retrievable, and safe across context compaction events.

## Architecture

### Persistence-First Model

Every background task result is written to disk as a markdown artifact **before** the parent session is notified. The notification contains only a summary and the artifact path. Full content retrieval happens on demand via `background_output`, which reads from disk rather than extracting from the sub-session.

### Compaction Injection

A `experimental.session.compacting` hook re-injects context about running and unread-completed tasks. This prevents the parent agent from "forgetting" about pending work when its context window gets compacted.

### State Recovery

Task state is recovered from dual sources: in-memory active state + filesystem scan of persisted artifacts. This allows recovery even after process restart.

### Component Map

```
groundwork.js
  BackgroundManager (existing, modified)
    + persistResult(task)           → writes markdown artifact to disk
    + readPersistedResult(taskId)    → reads artifact from disk
    + injectCompactionContext(...)   → hooks into session.compacting
    + recoverState()                → scans disk for orphaned artifacts
    - formatTaskResult()            → removed (replaced by disk read)
    - notifyParentSession()         → modified: summary-only notification

  PersistenceLayer (new)
    + write(taskId, content, metadata) → fs.writeFile
    + read(taskId)                     → fs.readFile
    + list(projectId, rootSessionId)   → fs.readdir + parse
    + remove(taskId)                   → fs.unlink

  Notification format (modified)
    Old: full text injected into parent context
    New: structured <task-notification> with summary + artifact path
```

## Data Model

### Persisted Artifact

Path: `~/.local/share/opencode/background-tasks/<projectId>/<rootSessionId>/<taskId>.md`

```markdown
---
id: <taskId>
description: <short description>
agent: <agent type>
status: completed | error | cancelled | interrupt
parent_session: <parentSessionID>
session: <sessionID>
started_at: <ISO timestamp>
completed_at: <ISO timestamp>
duration: <formatted duration>
---

<full assistant output text>
```

### Notification Payload (injected into parent)

```xml
<task-notification>
  id: <taskId>
  description: <short description>
  agent: <agent type>
  status: <completed | error | cancelled | interrupt>
  duration: <formatted duration>
  artifact: <absolute path to persisted result>
  unread: <count of unread completed tasks>
</task-notification>
```

### Compaction Context (injected during compaction)

```xml
<background-task-context>
  running:
    - id: <taskId> description: <desc> agent: <agent>
  unread-completed:
    - id: <taskId> description: <desc> artifact: <path>
</background-task-context>
```

## API / Interface

### Tool: `background_output` (modified)

- **Old behavior**: Extracts messages from sub-session via `client.session.messages`, formats as text
- **New behavior**: Reads persisted artifact from disk. Falls back to sub-session extraction only if artifact not found (e.g., task completed before persistence was added).
- Still accepts `task_id`, `block`, `timeout` parameters.
- Returns the full markdown artifact content.

### Tool: `background_list` (unchanged interface)

- Internally enhanced: if in-memory state is empty but artifacts exist on disk, recovers state from filesystem.

### Hook: `experimental.session.compacting` (new)

- Registered in plugin export.
- Callback receives session ID, queries BackgroundManager for running + unread completed tasks for that session.
- Returns `<background-task-context>` block to be injected into compacted context.

### Internal: `notifyParentSession` (modified)

- Calls `persistResult()` first (write to disk).
- Sends summary-only `<task-notification>` instead of full text.
- No longer calls `formatTaskResult()` at notification time.

## Error Handling

### Artifact write failure

- If `persistResult()` fails (disk full, permissions), log the error but still notify the parent with a fallback message noting the artifact could not be persisted.
- `background_output` falls back to sub-session extraction in this case.

### Missing artifact on read

- If `background_output` can't find the artifact file, fall back to extracting from the sub-session (current behavior).
- This handles the migration case where old tasks completed before persistence was added.

### Compaction hook failure

- If the compaction hook throws, it should not crash the compaction process. Catch and log silently.

### Orphaned artifacts

- `recoverState()` scans for artifacts with no corresponding in-memory task. These represent tasks from a previous process run. They are loaded as completed tasks with minimal metadata.

## Known Limitations

- Artifacts are not encrypted. If the background task output contains secrets, they will be stored in plaintext on disk.
- No automatic cleanup of old artifacts. The `TASK_CLEANUP_DELAY_MS` timer removes tasks from memory but not from disk. A separate cleanup mechanism (e.g., max age, max count) could be added later.
- The compaction hook depends on `experimental.session.compacting` which is an experimental API and may change.
- Migration: tasks already running when the plugin is updated will not have persisted artifacts. The fallback to sub-session extraction handles this.
- No small_model summarization. The opencode-background-agents project uses a cheap model to generate title+summary for notifications. This implementation uses the task description field instead, which is already provided at launch time. This is simpler but less informative for long-running tasks where the output diverges from the original description.

## Task Graph

### Task List

| ID | Task | Depends On | Owner / Agent | Files Touched | Est. |
|----|------|-----------|---------------|---------------|------|
| T1 | Add PersistenceLayer class | — | coder | groundwork.js | 0.5d |
| T2 | Add persistResult + modify notification flow | T1 | coder | groundwork.js | 0.5d |
| T3 | Add compaction hook | T1 | coder | groundwork.js | 0.5d |
| T4 | Add recovery + modify background_output/list | T1 | coder | groundwork.js | 0.5d |
| T5 | Write test suite | T2, T3, T4 | coder | test-persistence.mjs | 0.5d |

### Dependency Graph

```
T1 ──▶ T2
T1 ──▶ T3
T1 ──▶ T4
T2 + T3 + T4 ──▶ T5
```

### Parallelization Rules

- T2, T3, T4 all depend on T1 (PersistenceLayer) but are independent of each other — can run in parallel
- T5 depends on all implementation tasks being complete
- All tasks touch groundwork.js (T2-T4 sequentially; T5 creates new file)

## Steer Log

### 2026-04-17 — Add Task Graph section to PRD template

- **Trigger**: user request — PRDs should contain task dependency graph for parallel allocation and conflict avoidance
- **From**: No Task Graph section in PRD template
- **To**: Added Task Graph section with task list, dependency graph, and parallelization rules
- **Rationale**: Enables parallel task allocation via background_task, makes file ownership explicit to avoid merge conflicts
- **Affected sections**: Task Graph (new), this Steer Log entry
