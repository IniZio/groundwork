---
id: SPEC-TOOLING-R-005
type: requirement
concept: C-SPEC-TOOLING
title: Parent Field Presence
summary: Every concept node must carry an explicit parent field; absence is treated as an implicit second root.
status: draft
verification: manual
criticality: must
---

## SPEC-TOOLING-R-005 — Parent Field Presence {#spec-tooling-r-005}

`spec lint` **shall** emit a `parent-field-present` violation and exit 1 for any concept node (other than the designated root) whose frontmatter omits the `parent` field entirely.

- **Why** — A missing `parent` field is indistinguishable from `parent: null` to tooling that does not distinguish "absent" from "null". The lint rule makes the implicit explicit: a concept without a parent is a second root and must declare that intent or fix the omission. Before this invariant existed, five self-declared roots all passed `spec lint` cleanly.
- **Fit criterion** — Given a corpus copy containing a non-root concept node whose frontmatter has no `parent` key, `./bin/spec lint` exits 1 and stdout contains `parent-field-present`.
- **Verification**: manual — copy the spec tree to a temp dir, remove the `parent:` line from one non-root concept, run `./bin/spec lint`, confirm exit 1 and the violation keyword.
- **Criticality**: must
