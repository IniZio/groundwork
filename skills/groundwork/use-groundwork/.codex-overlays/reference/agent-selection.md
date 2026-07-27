# Agent Selection Reference (Codex)

The roster below is planning metadata, not a list of automatically callable
agents. Use a host-provided delegation surface only when it is present;
otherwise keep the role boundary in the plan and execute locally.

| Role | Use for |
|---|---|
| `explore` | Read-only codebase discovery and dependency mapping |
| `general-purpose` | Bounded implementation, tests, and debugging |
| `designer` | UI structure, styling, and visual polish |
| `qa` | Live browser, CLI, or TUI verification |
| `advisor` | Evidence review, trade-offs, and completion assessment |
| `test-engineer` | Test strategy and integration coverage |
| `planner` | Strategic plans before multi-step implementation |

Model assignments are registry-backed guidance. They matter only when the host
supports model-selectable delegation.
