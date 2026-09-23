# Agent template

Use this for every agent in `agents/`. Budget: ≤1536 bytes (1.5 KB). Tested by `test/instructions/agent-shape.test.ts`.

## Frontmatter (required)

```yaml
---
name: <agent-name>
description: <one-sentence role. Describe what it does and when to spawn it.>
model: opus | sonnet | haiku
tools: [Tool1, Tool2, …]         # or disallowedTools: [Write, Edit, …]
---
```

## Role line (required, ≤1 line)

Immediately after frontmatter. Active voice. No articles.

```
Classify, delegate, review. Never implement.
```

## Sections

### Job / Protocol (required)

What the agent does, in bullet or numbered steps. No backstory.

### Output (required — must be non-empty)

Fixed receipt shape. Prose summaries are not receipts.

```
<file:line-range> — <change ≤10 words>
status: <DONE|FAILED|APPROVE|…>
total: <N> items, <M> complete
```

Rules:
- path:line rows for every file touched or finding
- a verdict/status line
- totals when N > 1
- evidence (citations, test output, file:line, errors) verbatim — never compressed

### Sub-delegation / Allowed spawns (required for agents that may spawn)

List every `groundwork:<x>` the agent is permitted to spawn or escalate to. Use **one of these two section names**:
- `## Sub-delegation` — for implementer-style agents with a short list
- `## Allowed spawns` — for orchestrators with a longer + negation list

Convention enforced by `test/instructions/agent-spawn-parity.test.ts`:
Every `groundwork:<x>` that appears in a `## Sub-delegation` **or** `## Allowed spawns` section body is treated as a **spawn/escalate target**. The test checks that `x` is permitted by `DEPTH_ALLOWLIST` for that agent's caller type. Mentions of `groundwork:<x>` outside these sections (e.g. "never spawn", prose description) are **references only** and are not checked.

### Tools (if restricted)

List tools allowed or disallowed. Omit if unrestricted.

### Refusals (if applicable)

Terminal one-liners for out-of-scope requests.

```
3+ files → `too-big. split: <n tasks>.`
Asked to design → `Read-only. Spawn <agent>.`
```

### Auto-clarity

Security warnings or destructive ops → plain English, then resume caveman.

## Sizing checklist

- [ ] File ≤ 1536 bytes (`wc -c agents/<name>.md`)
- [ ] `## Output` section present and non-empty
- [ ] Evidence surfaces (citations, test lines, file:line) are verbatim — not compressed
- [ ] Negations exact (never upgrade "may" to "will", never drop "not")
- [ ] No hedge-to-fact upgrades

## Agents to be authored with this template

Skills run in the caller's context; these agents are being restored so each runs in its own context.

| Agent | Model | Decision |
|---|---|---|
| `groundwork:debugger` | opus | D1 — restored from v1; bug/debug route |
| `groundwork:explore` | haiku | D2 — read-only locator, modelled on cavecrew-investigator |
| `groundwork:junior-orchestrator` | sonnet | D4 — sub-orchestrator for multi-file slices |
| `groundwork:planner` | opus | D7 |
| `groundwork:researcher` | sonnet | D7 |
| `groundwork:designer` | sonnet | D7 |
| `groundwork:git-master` | haiku | D7 |
