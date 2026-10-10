# Agent authoring

Agent files: <= 1536 bytes. Check: `wc -c agents/<name>.md`.

## Sizing checklist
- [ ] File <= 1536 bytes
- [ ] `## Output` section present and non-empty
- [ ] Evidence surfaces (citations, test lines, file:line) verbatim, not compressed
- [ ] Negations exact (never upgrade "may" to "will", never drop "not")
- [ ] No hedge-to-fact upgrades

## Role line example
Classify, delegate, review. Never implement.

## Refusals examples
3+ files -> `too-big. split: <n tasks>.`
Asked to design -> `Read-only. Spawn <agent>.`

## Auto-clarity
Security warnings or destructive ops -> plain English, then resume caveman.

## Agents authored with this template
Skills run in the caller's context; these agents were restored so each runs in its own context.

| Agent | Model | Decision | Status |
|---|---|---|---|
| groundwork:debugger | opus | D1 bug/debug route | authored |
| groundwork:explore | haiku | D2 read-only locator, modelled on cavecrew-investigator | authored |
| groundwork:junior-orchestrator | sonnet | D4 sub-orchestrator for multi-file slices | authored |
| groundwork:planner | opus | D7 | authored |
| groundwork:researcher | sonnet | D7 | authored |
| groundwork:designer | opus | D7 | authored |
| groundwork:git-master | haiku | D7 | authored |
| groundwork:human-doc-reviewer | sonnet | DECISION event 546 human-doc review | authored |
