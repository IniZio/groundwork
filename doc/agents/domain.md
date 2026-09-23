# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **Decision log** — run `bun src/cli/main.ts compile` and read the `decisions (N)` section for decisions that touch the area you're about to work in.

If any of these don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## Decisions are DECISION events, not ADRs

This repo has no ADR directory. Never create `doc/adr/`, `docs/adr/`, or any `NNNN-*.md` ADR file. Where a skill says "write an ADR", record a `DECISION` event instead:

```
bun src/cli/main.ts event append --type DECISION --msg "<decision>" --data '{"rationale":"...","alternatives":["... (rejected: ...)"]}' --token T
```

- `--msg` is the decision statement. It is what `gw compile` shows under `decisions (N)`.
- Put the rationale and rejected alternatives in `--data`. Those are the ADR's "why" and "considered options".
- The token comes from `bun src/cli/main.ts token`. Only the main session may run it; the `store-write-guard` hook denies subagents. A subagent that resolves a decision must hand the text back to the main session to record.
- After appending, run `bun src/cli/main.ts compile` and confirm the decision appears. A successful append alone does not prove the decision is visible.

Decisions live in `.groundwork/work.db`, which is gitignored, so they are durable only on this machine.

## File structure

```
/
├── CONTEXT.md                ← glossary (committed)
├── doc/                      ← only committed doc root; never create docs/
├── .groundwork/work.db       ← DECISION events (gitignored)
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag decision conflicts

If your output contradicts a recorded DECISION, surface it explicitly rather than silently overriding:

> _Contradicts DECISION "event-sourced orders" — but worth reopening because…_
