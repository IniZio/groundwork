# Reuse Justification (D-11)

One row per component. Upstream checked before authoring.

| Component | Upstream checked | What upstream lacks | Why authored |
|---|---|---|---|
| `detect` (convention scanner) | mattpocock/skills `codebase-design`, `writing-for-agents`; Claude Code `/init`; commitlint; editorconfig tooling | None scans a repo and produces structured `{id, evidence, proposed_write}` findings without writing anything. `/init` writes CLAUDE.md directly (no detect-confirm split, no native-file writes). commitlint enforces but does not detect conventions and propose writes. | Thin scanner needed; no equivalent exists. |
| `apply` (targeted writer) | Claude Code `/init`; mattpocock/skills `setup-pre-commit`, `git-guardrails-claude-code` | `/init` targets only CLAUDE.md. `setup-pre-commit` and `git-guardrails-claude-code` are in-progress/unshipped and do setup, not findings-driven targeted writes to native repo files. | Allowed-path guard and findings-driven write logic have no upstream equivalent. |
| `new-code-gate` (Stop hook) | mattpocock/skills hooks; Claude Code built-in hooks; eslint/biome (linters) | Linters run as separate tools, not as Claude Code Stop hooks. No upstream Stop hook checks added lines only and reads confirmed conventions from the repo's own files. | Bespoke hook; no upstream equivalent. |
| `profile` (D-4 accreting doc) | Claude Code memory/CLAUDE.md | CLAUDE.md is agent-only, not a per-repo accreting run log. No upstream produces `.groundwork/profile.md` as a run-accreting artifact. | Minimal file write; no upstream equivalent. |
| `promote` (SKILL.md writer) | mattpocock/skills SKILL.md format | mattpocock/skills provides the format spec (referenced, not copied). No upstream CLI writes a new skill into a repo's `.groundwork/skills/` directory. | Thin writer; format reused from mattpocock. |
| `unknowns` (register) | None | No upstream append-only unknowns register exists in mattpocock/skills or Claude Code. | Trivial append; no upstream equivalent. |
