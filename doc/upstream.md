# Upstream adoption record

Written against: mattpocock-skills 1.2.3; caveman 2fd153c67988e980fb0b2455c90832159a6a5a25

## Flow

User runs `/to-tickets` (`mattpocock-skills:to-tickets`, user-only, disable-model-invocation).
Output format kept aligned with mattpocock spec.
Main agent then loads `/vertical-slice` without asking — no confirmation prompt.

## mattpocock-skills (v1.2.3)

| Status | Skill | Notes |
|---|---|---|
| ACCEPTED | `mattpocock-skills:grilling` | Routed directly for interview and intent capture before decomposition |
| ACCEPTED | `mattpocock-skills:tdd` | Routed directly for test writing |
| ACCEPTED | `mattpocock-skills:code-review` | Routed directly for diff and file review |
| ACCEPTED | `mattpocock-skills:codebase-design` | Routed directly for architecture review |
| ACCEPTED | `mattpocock-skills:research` | Routed directly for library/API investigation |
| ALTERED | `mattpocock-skills:diagnosing-bugs` | Runs inside `groundwork:debugger` rather than inline; gives the protocol a dedicated read-only context and enforces a structured receipt (root_cause/evidence/repro/proposed_fix/confidence) |
| ALTERED | `mattpocock-skills:to-tickets` | User-only (disable-model-invocation); groundwork refers user to run it; output kept aligned with mattpocock spec; main agent loads `/vertical-slice` without asking |
| NOT USED | `mattpocock-skills:implement` | Superseded by `groundwork:implement`, which adds gw slice ledger, stop-gate, and wave protocol |
| NOT USED | `mattpocock-skills:to-spec` | User-only; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:triage` | User-only; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:wayfinder` | User-only; groundwork's motive skill refers user to `/wayfinder` for large decompositions but does not route to it |
| NOT USED | `mattpocock-skills:handoff` | User-only; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:improve-codebase-architecture` | User-only; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:wizard` | Not adopted; no groundwork routing |
| NOT USED | `mattpocock-skills:prototype` | Not adopted; no groundwork routing |
| NOT USED | `mattpocock-skills:resolving-merge-conflicts` | Not adopted; no groundwork routing |
| NOT USED | `mattpocock-skills:domain-modeling` | Not adopted; no groundwork routing |
| NOT USED | `mattpocock-skills:writing-for-agents` | Not adopted; groundwork writes briefs per its own conventions |

## Caveman (commit 2fd153c67988e980fb0b2455c90832159a6a5a25)

| Status | Mechanism | Notes |
|---|---|---|
| ACCEPTED | Authoring rules (drop articles, filler; negation guard; modality preservation) | Delivered from `rules/authoring-rules.md`; enforced by prose-quality-guard build hook |
| ACCEPTED | Terse directive style for agents and skills | Applied at caveman "full" level in `agents/*.md` and `skills/*/SKILL.md` — fragments OK, imperative mood |
| ALTERED | Ruleset delivery | Caveman injects the full SKILL.md ruleset on SessionStart; groundwork delivers from `rules/authoring-rules.md` (human-authored source) and enforces via build hook — not runtime injection |
| ALTERED | Per-turn style reinforcement | Caveman re-emits full rules every UserPromptSubmit; groundwork's `src/hooks/prompt-reminder.ts` emits a single-line style prefix merged with the delegation nudge — avoids re-injecting the full ruleset each turn |
| ALTERED | `cavecrew-investigator` | Became `groundwork:explore`; same read-only constraint; adds a structured path:line receipt contract |
| NOT USED | Intensity levels surfaced at runtime (lite/full/ultra) | Used in planning groundwork's own content; not exposed as user-selectable runtime modes |
| NOT USED | `cavecrew-builder` (as-named) | Role covered by `groundwork:implementer`; not imported by name |
| NOT USED | `cavecrew-reviewer` | Not adopted; `groundwork:advisor` handles evidence-gated review |
| NOT USED | Wenyan modes (wenyan-lite, wenyan-full) | Not adopted |
| NOT USED | caveman-commit, caveman-compress, caveman-* standalone commands | Not wired; user may invoke caveman directly if installed alongside groundwork |
