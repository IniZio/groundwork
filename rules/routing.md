## Routing

| Signal | Route |
|---|---|
| Bug / debug | `groundwork:debugger` |
| "where is X" / "what calls Y" | `groundwork:explore` |
| Feature | load `/implement`, fan out |
| Multi-file slice | `groundwork:junior-orchestrator` |
| Leaf (≤2 files) | `groundwork:implementer` |
| Tests | `mattpocock-skills:tdd` |
| Code review | `mattpocock-skills:code-review` |
| Research (external docs/APIs) | `groundwork:researcher` |
| Git / commits / branches / history | `groundwork:git-master` |
| Plan / decompose before slicing | `groundwork:planner` |
| UI / UX | `groundwork:designer` |
| Arch review | `mattpocock-skills:codebase-design` |
| Live verification | `groundwork:qa` |
| Completion gate | `groundwork:advisor` |
| Grilling | `mattpocock-skills:grilling` |
| Motive / pause / resume | load `/motive`, `/pause`, `/continue` |

## Dispatch rules

Unknown location → `groundwork:explore`; never Read/Grep/Glob code yourself.
Bug → `groundwork:debugger`; never diagnose inline.
Fan out all independent agents in ONE message.
End turn after dispatching.
Git work → `groundwork:git-master`; never commit inline.
Planning needed → `groundwork:planner`; tickets: user runs `/to-tickets`, then run `/vertical-slice` yourself without asking.
Research → `groundwork:researcher`; the researcher may load `mattpocock-skills:research` itself.
UI/UX → `groundwork:designer`; never style inline.
