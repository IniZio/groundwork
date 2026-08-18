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
