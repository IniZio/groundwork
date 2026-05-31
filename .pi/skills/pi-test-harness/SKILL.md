---
name: pi-test-harness
description: Run the groundwork acceptance test harness. Documents how to test the plugin locally.
---

# Testing Groundwork

## Unit Tests

```bash
pnpm exec vitest run
```

## Manual Smoke Tests

1. Start Pi in a project with groundwork installed.
2. Verify bootstrap injection:
   - Start a session → check that `use-groundwork` rules appear in context
3. Verify agent definitions:
   - Run `/agents` → should see orchestrator (general-purpose), advisor, coder, designer, explorer, observer
   - Should NOT see builtin Explore or Plan (disabled)
4. Verify goal tool:
   - Call `set_goal(action="set", objective="Test", acceptanceCriteria=["A","B"])`
   - Check that goal is injected into messages
5. Verify handoff:
   - Run `/handoff` → should produce a handoff prompt

## Acceptance Tests (Subagent-Based)

```bash
pnpm exec vitest run test/acceptance
```

These spawn subagents with specific prompts and assert on their transcripts for correct skill routing.
