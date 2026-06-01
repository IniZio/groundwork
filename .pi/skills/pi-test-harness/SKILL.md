---
name: pi-test-harness
description: Run the groundwork acceptance test harness. Documents how to test the plugin locally.
---

# Testing Groundwork

## Unit Tests

```bash
pnpm exec vitest run test/unit test/lib test/tools test/commands
```

## E2E Tests (Pi RPC Harness)

These spawn `pi --mode rpc` as a child process, send prompts, and assert on the
full transcript for correct skill routing and subagent fan-out.

```bash
# Run all e2e tests (slow — spawns real pi processes)
pnpm exec vitest run test/e2e

# Run only routing tests
pnpm exec vitest run test/e2e/routing.test.ts

# Run only fan-out tests
pnpm exec vitest run test/e2e/fanout.test.ts

# With verbose logging
pnpm exec vitest run test/e2e --reporter=verbose
```

### What the E2E harness checks

| Test file | What it verifies |
|-----------|-----------------|
| `routing.test.ts` | Correct skill routing for bugs, features, small changes |
| `fanout.test.ts` | Orchestrator delegates to parallel subagents instead of doing work itself |

### Harness internals

- `test/e2e/harness.ts` — `PiRpcClient` that drives `pi --mode rpc` via stdin/stdout
- Waits for idle state via `get_state` polling
- Captures all assistant messages, tool calls, and session stats
- Assert helpers: `assertSkillUsed`, `assertSkillNotUsed`, `assertFanOut`

### Manual Smoke Tests

1. Start Pi in a project with groundwork installed.
2. Verify bootstrap injection:
   - Start a session → check that `use-groundwork` rules appear in system prompt
3. Verify agent definitions:
   - Run `/agents` → should see orchestrator (general-purpose), advisor, coder, designer, explorer, observer
   - Should NOT see builtin Explore or Plan (disabled)
4. Verify goal tool:
   - Call `set_goal(action="set", objective="Test", acceptanceCriteria=["A","B"])`
   - Check that goal is injected into messages
5. Verify handoff:
   - Run `/handoff` → should produce a handoff prompt
