---
type: flows
id: C-ORCHESTRATION
---

```mermaid
sequenceDiagram
    participant User
    participant Orchestrator
    participant Classify/Route
    participant Subagent as Subagent (general-purpose)
    participant Advisor

    User->>Orchestrator: Send request
    Orchestrator->>Classify/Route: Classify issue type
    Classify/Route-->>Orchestrator: Classification (feature/bug/trivial/…)
    Orchestrator->>Subagent: Delegate with self-contained brief
    Subagent-->>Orchestrator: Return evidence and result
    Orchestrator->>Orchestrator: Review result
    Orchestrator->>Advisor: Invoke advisor gate
    Advisor-->>Orchestrator: APPROVE or CORRECTION
    alt APPROVE
        Orchestrator->>User: Session can end
    else CORRECTION
        Orchestrator->>Orchestrator: Register new slice, retry
        Orchestrator->>Subagent: Delegate corrective work
    end
```

Delegation is mandatory because the orchestrator must stay free of implementation detail; mixing classification with execution collapses the feedback loop that lets the advisor review work objectively. The advisor gate enforces that session end is blocked until an independent reviewer has confirmed the evidence — test output, file paths, and observable behaviour — meets the acceptance criteria, preventing self-certified completion from shipping defects.
