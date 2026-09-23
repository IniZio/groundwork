# Instruction budget — v1 vs v2

Token method: `chars / 4` (proxy; stated). No tokenizer dependency added.

## Per-surface comparison

| Surface | v1 chars | v1 tokens | v2 bytes (wc -c) | v2 tokens | Ratio |
|---|---|---|---|---|---|
| SessionStart injection | 7068 | 1767 | 1205 | 301 | 0.17 |
| CLAUDE.md (orchestrator project file) | 39614 | 9904 | — (none) | — | — |
| orchestrator.md | 10706 | 2677 | 2913 | 728 | 0.27 |
| general-purpose / implementer.md | 5728 | 1432 | 1806 | 451 | 0.32 |
| advisor.md | 17875 | 4469 | 2515 | 628 | 0.14 |
| qa.md | 8969 | 2242 | 1424 | 356 | 0.16 |
| implement/SKILL.md | 4522 | 1130 | 1395 | 348 | 0.31 |
| vertical-slice/SKILL.md | 4867 | 1216 | 1523 | 380 | 0.31 |
| advisor-gate/SKILL.md | 5381 | 1345 | 1282 | 320 | 0.24 |
| pause/SKILL.md | 2822 | 705 | 861 | 215 | 0.30 |
| continue/SKILL.md | 3610 | 902 | 944 | 236 | 0.26 |
| motive/SKILL.md | 4879 | 1219 | 1432 | 358 | 0.29 |

Recompute v2 bytes (wc -c): `wc -c agents/orchestrator.md agents/advisor.md agents/qa.md agents/implementer.md skills/*/SKILL.md` (SessionStart injection size: `echo '{}' | CLAUDE_PLUGIN_ROOT=/x bun run src/hooks/session-start.ts | bun -e "const d=await Bun.stdin.json();console.log(Buffer.byteLength(d.hookSpecificOutput.additionalContext,'utf8'))"`).

## Per-spawn totals

CLAUDE.md is a project file, not plugin-delivered — excluded from plugin budget.
SessionStart fires for primary session only, not subagents.

### Per-orchestrator spawn

| Component | v1 | v2 |
|---|---|---|
| SessionStart injection | 1767 | 301 |
| orchestrator.md | 2677 | 728 |
| **Total** | **4444** | **1029** |
| **Ratio** | — | **0.23 (23%)** |

### Per-leaf spawn (SessionStart does NOT fire for subagents)

| Component | v1 | v2 |
|---|---|---|
| implementer / general-purpose.md | 1432 | 451 |
| **Total** | **1432** | **451** |
| **Ratio** | — | **0.31 (31%)** |

Both totals are under the ≤1/3 target.

## Agents not authored in v2 (upstream-covered)

| v1 agent | v1 tokens | v2 coverage |
|---|---|---|
| debugger.md (190L, ~1726 tokens) | ~1726 | `mattpocock-skills:diagnosing-bugs` (UPSTREAM verdict) |
| researcher.md (5318 chars, ~1330 tokens) | ~1330 | `mattpocock-skills:research` (PARTIAL — gap: no confidence grading) |
| junior-orchestrator.md (14339 chars, ~3585 tokens) | ~3585 | merged into orchestrator.md + implement skill |
| planner.md (14923 chars, ~3731 tokens) | ~3731 | `mattpocock-skills:to-tickets` + vertical-slice skill |
| test-engineer.md (4224 chars, ~1056 tokens) | ~1056 | `mattpocock-skills:tdd` (PARTIAL) |
| git-master.md (6208 chars, ~1552 tokens) | ~1552 | conventions tooling (implementer responsibility) |
| designer.md (5290 chars, ~1323 tokens) | ~1323 | not kept — no MUST-AUTHOR verdict in inventory |
| explore.md (6631 chars, ~1658 tokens) | ~1658 | not kept — `mattpocock-skills:research` covers exploration |

Total v1 tokens for dropped/upstreamed agents: ~17,961 tokens saved.

Reuse verdicts sourced from: `/home/newman/.local/share/groundwork/.groundwork/motives/groundwork-as-glue/tickets/T-reuse-inventory.md`
