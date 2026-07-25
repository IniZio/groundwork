# Fan-Out Patterns Reference

## Codex Scope

The examples below describe hosts with native multi-agent dispatch. In Codex,
use the same slice and wave structure as a planning aid, then execute locally
or through a host-provided delegation surface. Do not treat the example
dispatch syntax, background notifications, or user-question calls as Codex
capabilities. Keep the reminder to one or two lines after the initial load.

## Fan-Out Maximization

Fan-out targets by specialist type (mix freely in the same wave):
- **general-purpose:** 5-15 parallel tasks for implementation slices
- **explore:** 2-5 parallel tasks for codebase understanding (one per area/module)
- **designer:** 1-3 parallel tasks for UI/UX work
- **qa:** 1-2 tasks for live verification after implementation
- **advisor:** 1 task at a time for strategic decisions

Rules:
1. **Within a wave, launch ALL independent slices simultaneously.** Never wait for Slice A before launching Slice B if they don't share code.
2. **A wave with only 1 slice is a missed opportunity.** Look harder for decomposition or combine with adjacent waves.
3. **Sequential execution is only for dependencies.** If Slice B needs output from Slice A, they're in different waves. Everything else is parallel.
4. **Fan-out first, review second.** Launch everything in parallel, then review all outputs together.
5. **Send ALL parallel `task` calls in ONE message.** Never send task calls across multiple messages.

```
# GOOD: Fan out mixed specialists simultaneously
task(description="Explore auth module", prompt="...", subagent_type="explore")
task(description="Explore user model", prompt="...", subagent_type="explore")
task(description="Slice 1: auth flow", prompt="...", subagent_type="general-purpose")
task(description="Slice 2: user profile", prompt="...", subagent_type="general-purpose")
task(description="Slice 3: settings page", prompt="...", subagent_type="general-purpose")
task(description="Slice 4: dashboard styling", prompt="...", subagent_type="designer")
task(description="Slice 5: notifications logic", prompt="...", subagent_type="general-purpose")
# All launch at once — each uses the right specialist

# BAD: Sequential — never do this
task(description="Slice 1", ...) → wait → task(description="Slice 2", ...) → wait → ...
```

## Anti-pattern: The Implementing Orchestrator

```
WRONG:  Classify → read files → write code → run tests → review → advisor-gate
        (orchestrator does everything sequentially)

RIGHT:  Classify → fan out mixed specialists (explore×2, general-purpose×5-15, designer×1-3)
        → collect all outputs → review → advisor-gate
        (orchestrator delegates, reviews, orchestrates — MAXIMIZE fan-out width)

RIGHT:  UI feature → fan out (designer for styling, general-purpose×3 for logic)
        → review all outputs → advisor-gate

CODER TOOL LOOP:
WRONG:  Coder calls tool X → gets result → calls tool X again with same args → repeats (loop)
RIGHT:  Loop detector catches it → sends nudge → general-purpose takes different approach

CI BABYSITTING:
WRONG:  bash "gh pr checks" → bash "gh pr checks" → bash "gh pr checks" (polling loop)
RIGHT:  pty_spawn "gh pr checks --watch" → pty_read on completion notification
```

## Background Task Pattern

When all background tasks are dispatched and no other work remains, **end your turn** — do NOT call `question`. Background task completion notifications re-invoke you automatically.

```
# GOOD — end turn, let notifications arrive
"I've launched 5 parallel background tasks... Waiting for completion notifications."

# BAD — blocks notifications, gets stuck
question("5 tasks running, wait?", ["Wait", "Work on something else"])
```
