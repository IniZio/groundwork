# Agent template

Every agent file stays at or under 1536 bytes, so its instructions are cheap to load in each spawn. [agent-shape test](https://github.com/IniZio/groundwork/blob/cc3f4e32aff23bc44798cd668375e8c9ad8e29ec/test/instructions/agent-shape.test.ts) enforces this.

The authoring checklist and the list of agents live in [agent-authoring rules](https://github.com/IniZio/groundwork/blob/1cecca5618ba2c7e58d7ff9068fd32110c9c7be0/rules/agent-authoring.md).

## Required shape

- Frontmatter with name, a one-sentence description (role and when to spawn), model (opus, sonnet or haiku), and either tools or disallowedTools.
- A role line right after the frontmatter: one line, active voice, no articles.
- A Job or Protocol section: steps only, no backstory.
- A non-empty Output section holding a fixed receipt.
- A spawn section, only for agents that may spawn: `## Sub-delegation` (short list, implementer style) or `## Allowed spawns` (longer list with negations, orchestrator style).

Optional: Tools (when restricted), Refusals (terminal one-liners for out-of-scope requests), Auto-clarity.

## Decisions

- **Output is a fixed receipt, not a prose summary.** A receipt has path:line rows for each file touched or finding, a verdict line, and totals when there is more than one item. Evidence (citations, test output, errors) is quoted verbatim. Prose summaries are rejected: callers cannot parse them and compression drops evidence.
- **Spawn targets are declared by section, not by mention.** Every `groundwork:<x>` inside a Sub-delegation or Allowed spawns section counts as a spawn or escalation target. The [spawn-parity test](https://github.com/IniZio/groundwork/blob/cc3f4e32aff23bc44798cd668375e8c9ad8e29ec/test/instructions/agent-spawn-parity.test.ts) checks each one against the allowlist for that agent's caller type. Mentions elsewhere (for example "never spawn `groundwork:x`") are references and are not checked. Scanning the whole file was rejected because it would flag every negation.
