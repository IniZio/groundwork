---
type: flows
id: C-ENFORCEMENT
---

# Enforcement Hook Flows

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant PTU as PreToolUse Hook
    participant OIG as Orchestrator Guard
    participant SG as Spec Guard

    CC->>PTU: Edit/Write tool call
    PTU->>OIG: Check caller identity and target path
    alt Orchestrator + path outside permit list
        OIG-->>CC: BLOCK — direct edit denied
    else Subagent OR permitted path
        OIG->>SG: Check RFC coverage for target path
        alt RFC coverage found
            SG-->>CC: PERMIT — constraint satisfied
        else No RFC coverage
            SG-->>CC: WARN and PERMIT — fail-open
        end
    end
```

The orchestrator impl-guard performs a hard block when it detects an orchestrator identity writing to a path outside the two permitted shapes (session memory files and handoff documents); this is a synchronous deny that never reaches the model. The spec guard and nesting guard are advisory: when coverage cannot be determined or depth signals are absent, both guards fail-open and emit a warning without blocking, preserving liveness over strictness.
