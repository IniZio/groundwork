# Explore Subagent Prompt Template

Fill in `[AREA]` and send as the subagent's prompt verbatim:

```
Explore [AREA] in this codebase. Return ONLY structured findings — no prose padding.

For each issue found, return:
- file: path/to/file.ts (+ line range if relevant)
- type: shallow_module | tight_coupling | testability_gap | pass_through | naming_inconsistency
- summary: one sentence describing the friction
- deletion_test: pass | fail | n/a
- strength: strong | worth_exploring | speculative

Limit: top 5 findings per area. Be specific — file paths and function names, not vague descriptions.
```

Typical area targets (adapt to project shape):

- Core domain / business logic
- Entry points (routers, controllers, CLI commands, event handlers)
- Data layer (persistence, queries, models)
- Shared utilities / helpers
- Test structure
