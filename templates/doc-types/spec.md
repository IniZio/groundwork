---
folds_into: {{folds_into}}
reason: {{reason}}
change_kinds: []
repro_test: ""
---

# {{title}}

Agent view. The human view lives at doc/{slug}/spec.md.

change_kinds lists every kind that applies: bugfix, refactor, cli-flag, config-key, data-format, migration, dependency. The H2 gate auto-passes only bugfix (with repro_test naming the failing test) and refactor. Any other kind, an unknown kind, an empty list, or a TBD acceptance criterion holds the run for a human.

## Purpose

State what this spec covers and why it exists.

## Requirements

List each requirement as a testable statement.

## Acceptance criteria

- [ ] State one observable condition. Name the evidence that proves it (test name, command output, or artifact).

## Execution notes

Optional. Record files, commands, and ledger ids that the work needs.
