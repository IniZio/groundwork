---
id: journal-motive-r-003
type: requirement
concept: C-JOURNAL-MOTIVE
criticality: must
verification: unverified
status: open
title: "DECISION event required fields"
---

## JOURNAL-MOTIVE-R-003 — DECISION event required fields {#journal-motive-r-003}

The `journal append --type DECISION` command **shall** require `data.id`, `data.decision`, and `data.rationale` in the JSON payload; it **shall** exit 2 if any of these fields is absent or empty. The optional field `data.revises` (set to the decision's own id) **shall** suppress the id-collision warning when a DECISION with the same id already exists in the motive.

- **Why** — Missing required fields produce a stored event with null payload fields. The null is persisted in the append-only log and cannot be corrected without a supersession event; `compile` then emits an incomplete decision log entry with no outcome text. The constraint is enforced only at append time — compile does not re-validate the raw event stream.
- **Fit criterion** — Running `bun bin/journal append --motive <any-slug> --type DECISION --msg "test" --data '{}'` exits 2 and writes "DECISION event requires data.id" to stderr. Running the same command with `--data '{"id":"D-1"}'` exits 2 and writes "DECISION event requires data.decision". Running with `--data '{"id":"D-1","decision":"out"}'` exits 2 and writes "DECISION event requires data.rationale".
- **Verification**: unverified — candidate: Run each invocation from the repo root with a nonexistent motive slug; schema validation fires before any filesystem write so no state is mutated. Assert exit code 2 and the expected stderr phrase. Source: `hooks/journal.mjs` lines 616–621.
- **Criticality**: must
