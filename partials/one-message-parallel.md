Fire all independent agent calls in ONE message — separate messages execute sequentially, not in parallel. Task A in one message followed by Task B in the next is sequential execution in disguise.

Two tasks are independent only when BOTH hold: (1) neither consumes the other's output, AND (2) they share no undefined type, schema, or file that the other must produce first. Add a `blocked_by` edge only when you can name the specific artifact consumed.

```
# GOOD — all three calls in one message → parallel
task(subagent_type="groundwork:explore",         prompt="…")
task(subagent_type="groundwork:general-purpose", prompt="…")
task(subagent_type="groundwork:test-engineer",   prompt="…")

# BAD — Task A then Task B in separate messages → sequential
task(subagent_type="groundwork:general-purpose", prompt="Task A …")
# ← turn boundary; Task B waits for A to finish
task(subagent_type="groundwork:general-purpose", prompt="Task B …")
```
