# Upstream adoption record

Written against: mattpocock-skills 1.3.1 (commit 6fd947921b935b7e1e69293a200400f0fdd5c15f); caveman b39c90862855ad2f0813ce775b8bf07a9d6d2a50

## Flow

User runs `/to-tickets` (`mattpocock-skills:to-tickets`, user-only, disable-model-invocation).
Output format kept aligned with mattpocock spec.
Main agent then calls the Skill tool with `groundwork:vertical-slice` without asking — no confirmation prompt.

## mattpocock-skills (v1.3.1, commit 6fd947921b935b7e1e69293a200400f0fdd5c15f)

| Status | Skill | Notes |
|---|---|---|
| ACCEPTED | `mattpocock-skills:grilling` | Routed directly for interview and intent capture before decomposition |
| ACCEPTED | `mattpocock-skills:tdd` | Routed directly for test writing |
| ACCEPTED | `mattpocock-skills:code-review` | Routed directly for diff and file review |
| ACCEPTED | `mattpocock-skills:codebase-design` | Routed directly for architecture review |
| ACCEPTED | `mattpocock-skills:research` | Routed directly for library/API investigation |
| ALTERED | `mattpocock-skills:diagnosing-bugs` | Runs inside `groundwork:debugger` rather than inline; gives the protocol a dedicated read-only context and enforces a structured receipt (root_cause/evidence/repro/proposed_fix/confidence) |
| ALTERED | `mattpocock-skills:to-tickets` | User-only (disable-model-invocation); groundwork refers user to run it; output kept aligned with mattpocock spec; main agent calls the Skill tool with `groundwork:vertical-slice` without asking |
| NOT USED | `mattpocock-skills:implement` | Superseded by `groundwork:implement`, which adds gw slice ledger, stop-gate, and wave protocol |
| NOT USED | `mattpocock-skills:to-spec` | User-only; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:triage` | User-only; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:wayfinder` | User-only; groundwork's motive skill refers user to `/wayfinder` for large decompositions but does not route to it |
| NOT USED | `mattpocock-skills:handoff` | User-only; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:improve-codebase-architecture` | User-only; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:wizard` | Not adopted; no groundwork routing |
| NOT USED | `mattpocock-skills:prototype` | Not adopted; no groundwork routing |
| NOT USED | `mattpocock-skills:implement-spec` | Superseded by `groundwork:implement`; user-only; no groundwork routing |
| NOT USED | `mattpocock-skills:pr` | Not adopted; no groundwork routing |
| NOT USED | `mattpocock-skills:retro` | User-only; not adopted; no groundwork routing |
| ALTERED | `mattpocock-skills:domain-modeling` | `doc/agents/domain.md` routes through it (via `grill-with-docs`); ADR writes become `DECISION` events |
| NOT USED | `mattpocock-skills:writing-for-agents` | Not adopted; groundwork writes briefs per its own conventions |
| ALTERED | `mattpocock-skills:grill-with-docs` | User-only; `grilling` plus `domain-modeling`; `doc/agents/domain.md` points readers here, but ADR writes become `DECISION` events |
| NOT USED | `mattpocock-skills:ask-matt` | User-only; router over upstream skills and flows; not wired into groundwork routing |
| NOT USED | `mattpocock-skills:setup-matt-pocock-skills` | User-only; per-repo tracker/label/domain-doc setup; groundwork records the result in `doc/agents/` |
| NOT USED | `mattpocock-skills:grill-me` | User-only; alias for `grilling`; groundwork routes `grilling` directly |
| NOT USED | `mattpocock-skills:teach` | User-only; multi-session teaching workspace; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:to-questionnaire` | User-only; turns an open decision into a questionnaire for another person; not wired into groundwork agent routing |
| NOT USED | `mattpocock-skills:wait-what` | User-only; re-pitch a message in STE100; not wired into groundwork agent routing |

## Caveman (commit b39c90862855ad2f0813ce775b8bf07a9d6d2a50)

| Status | Mechanism | Notes |
|---|---|---|
| ACCEPTED | Authoring rules (drop articles, filler; negation guard; modality preservation) | Delivered from `rules/authoring-rules.md`; enforced by prose-quality-guard build hook |
| ACCEPTED | Terse directive style for agents and skills | Applied at caveman "full" level in `agents/*.md` and `skills/*/SKILL.md` — fragments OK, imperative mood |
| ALTERED | Ruleset delivery | Caveman injects the full SKILL.md ruleset on SessionStart; groundwork delivers from `rules/authoring-rules.md` (human-authored source) and enforces via build hook — not runtime injection |
| ALTERED | Per-turn style reinforcement | Caveman re-emits full rules every UserPromptSubmit; groundwork's `src/hooks/prompt-reminder.ts` emits a single-line style prefix merged with the delegation nudge — avoids re-injecting the full ruleset each turn |
| ACCEPTED | Never-grow rule | Compression never adds words; style only. In `rules/authoring-rules.md` rule 12 |
| ACCEPTED | Auto-clarity rule | Security warnings, irreversible-action confirmations, ambiguity stay full sentences; merged into sequencing rule 8 |
| ACCEPTED | No arrows (`→`) as prose shorthand | Upstream measured zero token saving; rule 13. Upstream now also bans arrows and invented abbreviations |
| ACCEPTED | Evidence: decisive lines only | Rule 7 amended: verbatim, decisive lines, no full log dumps unless asked; never-paraphrase kept |
| ACCEPTED/ALTERED | cavecrew-style output contracts | Agent `## Output` sections in `agents/*.md` fixed-shape receipts; groundwork adds status token and file:line |
| ALTERED | `cavecrew-investigator` | Became `groundwork:explore`; same read-only constraint; adds a structured path:line receipt contract |
| NOT USED | Intensity levels surfaced at runtime (lite/full/ultra) | Used in planning groundwork's own content; not exposed as user-selectable runtime modes |
| NOT USED | `cavecrew-builder` (as-named) | Role covered by `groundwork:implementer`; not imported by name |
| NOT USED | `cavecrew-reviewer` | Not adopted; `groundwork:advisor` handles evidence-gated review |
| NOT USED | Wenyan modes (wenyan-lite, wenyan-full) | Not adopted |
| NOT USED | caveman-commit, caveman-compress, caveman-* standalone commands | Not wired; user may invoke caveman directly if installed alongside groundwork |
