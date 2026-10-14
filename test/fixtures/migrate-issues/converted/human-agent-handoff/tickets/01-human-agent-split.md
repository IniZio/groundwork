---
title: "Human/agent split in doc-type templates, authoring rules, and PR body"
status: todo
assignee: agent
priority: none
tags: []
parent: "[[human-agent-handoff]]"
blocked_by: []
source: ""
created: 2026-10-07
---

**What to build:** When an agent writes a spec, ticket, motive, design or PR body, the reader-facing part follows the human writing standard, and agent-only detail lives in a separate agent view. The routing rule decides placement: if changing an item could flip a reviewer's yes/no, it goes in the human view; if it only changes how work gets done, it goes in the agent view (DECISION event 545 for homes).

Human writing standard:
- Lead with the point; no "This document describes".
- Never state the baseline CI already enforces (lint, typecheck, tests passed).
- File mentions are GitHub permalinks pinned to a commit, never code-blocked paths.
- Flows, architectures and state machines are diagrams.
- Each decision carries its rejected alternative.
- Plain controlled English; ASD-STE100 for anything a reader could misparse.
- No agent bookkeeping (file lists, commands, AC tables, ledger ids).



- [ ] Authoring rules state the routing rule and the human writing standard once, in the rules source; mirrors regenerated.
- [ ] Spec, ticket, motive and design doc types each define a human view (committed docs) and an agent view (`.groundwork/`), and the doc registry places each where DECISION 545 says.
- [ ] A PR body template holds: what changed, each AC linked to its evidence, residual risk. It contains no baseline-check claims.
- [ ] A test writes each doc type through the deployed path and asserts the human view holds no agent-only section and the agent view holds the AC.
