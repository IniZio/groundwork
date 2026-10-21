# groundwork

groundwork is a Claude Code plugin that makes an agent work the way Newman works. It ships one skill, `/groundwork:newman-mode`, and installs [pstack](https://github.com/cursor/plugins/tree/main/pstack) and house-rules beside it.

```mermaid
flowchart LR
  G[groundwork] -->|depends on| P[pstack]
  G -->|depends on| H[house-rules]
  G --> S["/groundwork:newman-mode"]
  G --> B[Bash guards]
  S -->|layers on| PM["/pstack:poteto-mode"]
```

- **newman-mode** covers how to ask questions, when to act without asking, design defaults, verification, briefing subagents and the stacked-PR process. It overrides poteto-mode where they conflict.
- **pstack** provides the playbooks: poteto-mode, swarm, pause, orchestrate and the principle skills.
- **house-rules** blocks commits that break the commit-message preset and edits that add more than 5 comment lines per 100 new lines.
- **Bash guards** deny a piped command whose exit code would be hidden, and a slow or remote command (docker build, ssh, long runs) with no `timeout`.

## Install

```
claude plugin marketplace add IniZio/groundwork
claude plugin install groundwork@groundwork
```

The groundwork marketplace lists pstack straight from `cursor/plugins` main, so the install pulls it in. If you already have `pstack@cursor-plugins`, uninstall it so the `/pstack:` skills load once.

house-rules needs Claude Code v2.1.193 or later.

## Development

```
bun install
bun test
```

The `groundwork` marketplace can be a `directory` source pointing at a checkout, so every session runs the working tree. Skills and hooks reload with the reload-plugins command.
