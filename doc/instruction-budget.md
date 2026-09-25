# Instruction budget

Token method: `chars / 4` (proxy; stated). No tokenizer dependency added.

## Per-surface size

| Surface | bytes (wc -c) | tokens |
|---|---|---|
| SessionStart injection | 3387 | 778 |
| Per-turn reminder (UserPromptSubmit) | 79 | 20 |
| CLAUDE.md (orchestrator project file) | — (none) | — |
| orchestrator.md | 1145 | 286 |
| general-purpose / implementer.md | 1463 | 366 |
| advisor.md | 1504 | 376 |
| qa.md | 1251 | 313 |
| implement/SKILL.md | 2327 | 582 |
| vertical-slice/SKILL.md | 2170 | 543 |
| advisor-gate/SKILL.md | 1231 | 308 |
| pause/SKILL.md | 843 | 211 |
| continue/SKILL.md | 980 | 245 |
| motive/SKILL.md | 1428 | 357 |

Recompute bytes (wc -c): `wc -c agents/orchestrator.md agents/advisor.md agents/qa.md agents/implementer.md skills/*/SKILL.md` (SessionStart injection size is measured on the normalised output — root path replaced with `/GROUNDWORK_ROOT`, sha replaced with `(XXXXXXX)` — to stay environment-independent: `ROOT=$(pwd) && echo '{}' | CLAUDE_PLUGIN_ROOT="$ROOT" bun src/hooks/session-start.ts | bun -e "const d=await Bun.stdin.json();const c=d.hookSpecificOutput.additionalContext;const n=c.replace(new RegExp('$ROOT'.replace(/[.*+?^\${}()|[\]\\\\\\\\]/g,'\\\\\\\\$&'),'g'),'/GROUNDWORK_ROOT').replace(/\\([0-9a-f]{7,40}\\)/g,'(XXXXXXX)');console.log(Buffer.byteLength(n,'utf8'))"`).

## Per-spawn totals

CLAUDE.md is a project file, not plugin-delivered — excluded from plugin budget.
SessionStart fires for primary session only, not subagents.

### Per-orchestrator spawn

| Component | tokens |
|---|---|
| SessionStart injection | 764 |
| orchestrator.md | 252 |
| Per-turn reminder (per prompt) | 20 |
| **Total (session start)** | **1036** |

### Per-leaf spawn (SessionStart does NOT fire for subagents)

| Component | tokens |
|---|---|
| implementer / general-purpose.md | 376 |
| **Total** | **376** |
