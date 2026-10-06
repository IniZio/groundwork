# Instruction budget

Token method: `chars / 4` (proxy; stated). No tokenizer dependency added.

## Per-surface size

| Surface | bytes (wc -c) | tokens |
|---|---|---|
| SessionStart injection | 5244 | 1311 |
| Per-turn reminder (UserPromptSubmit) | 79 | 20 |
| CLAUDE.md (orchestrator project file) | — (none) | — |
| orchestrator.md | 1366 | 342 |
| general-purpose / implementer.md | 1535 | 384 |
| advisor.md | 1504 | 376 |
| qa.md | 1533 | 383 |
| implement/SKILL.md | 3335 | 834 |
| vertical-slice/SKILL.md | 2170 | 543 |
| advisor-gate/SKILL.md | 1231 | 308 |
| pause/SKILL.md | 936 | 234 |
| continue/SKILL.md | 1064 | 266 |
| motive/SKILL.md | 1589 | 397 |

Recompute bytes (wc -c): `wc -c agents/orchestrator.md agents/advisor.md agents/qa.md agents/implementer.md skills/*/SKILL.md` (SessionStart injection size is measured on the normalised output — root path replaced with `/GROUNDWORK_ROOT`, sha replaced with `(XXXXXXX)`, header version replaced with `vX.Y.Z` — and run from an empty temp dir with no store, so the "Where docs go" table renders the no-motive fallback regardless of the repo's active motive: `ROOT=$(pwd); E=$(mktemp -d); (cd "$E" && echo '{}' | env -u CLAUDE_PROJECT_DIR CLAUDE_PLUGIN_ROOT="$ROOT" CLAUDE_PROJECT_DIR="$E" bun "$ROOT/src/hooks/session-start.ts") | ROOT="$ROOT" bun -e "const d=await Bun.stdin.json();const n=d.hookSpecificOutput.additionalContext.split(process.env.ROOT).join('/GROUNDWORK_ROOT').replace(/\\([0-9a-f]{7,40}\\)/g,'(XXXXXXX)').replace(/(?<=^# groundwork v)\\d+\\.\\d+\\.\\d+/m,'X.Y.Z');console.log(Buffer.byteLength(n,'utf8'))"; rm -r "$E"`).

## Per-spawn totals

CLAUDE.md is a project file, not plugin-delivered — excluded from plugin budget.
SessionStart fires for primary session only, not subagents.

### Per-orchestrator spawn

| Component | tokens |
|---|---|
| SessionStart injection | 1311 |
| orchestrator.md | 342 |
| Per-turn reminder (per prompt) | 20 |
| **Total (session start)** | **1673** |

### Per-leaf spawn (SessionStart does NOT fire for subagents)

| Component | tokens |
|---|---|
| implementer / general-purpose.md | 384 |
| **Total** | **384** |
