---
id: journal-motive-r-005
type: requirement
concept: C-JOURNAL-MOTIVE
criticality: should
verification: manual
status: open
title: "append/compile title vs decision seam"
---

## JOURNAL-MOTIVE-R-005 — append/compile title vs decision seam {#journal-motive-r-005}

**When** a DECISION event is appended with both `data.title` and `data.decision`, the compiled view's entry **shall** set its `title` field to `data.title` and its `decision` field to `data.decision`; the decision outcome text is therefore stored in `decision`, not in `title`. **When** `data.title` is omitted, the compiled entry's `title` field **shall** be set to `data.decision`, making the outcome text the primary display heading in the compiled view.

The practical consequence: to make the decision statement appear as the compiled entry's heading, omit `data.title` and let `title = data.decision`. Supplying a separate `data.title` moves the outcome text to the `decision` field, which rendered views may display less prominently.

- **Why** — A caller who supplies a human-readable `data.title` expecting the decision statement (`data.decision`) to appear as the heading in the compiled Markdown view is surprised to find only the title string there. The decision outcome text is present in the JSON (`decision` field) but the compiled Markdown uses `title` as the primary display string. This seam is not documented in `journal append --help`; it is only visible by reading `motive-compile.mjs` lines 193–228 (`title: d.title ?? d.decision ?? null`).
- **Fit criterion** — Compile a motive containing: (A) a DECISION event with `data.title="My Title"` and `data.decision="The outcome"`, and (B) a DECISION event with only `data.decision="The outcome"`. In the compiled JSON at `.groundwork/compiled/<slug>.json`, entry A has `title == "My Title"` and `decision == "The outcome"`. Entry B has `title == "The outcome"` and `decision == "The outcome"`.
- **Verification**: manual — Using a throwaway project dir, create two DECISION events as described. Run `bun bin/journal compile <slug> --stdout --json` and inspect the `decision_log` array in the output. Source: `hooks/lib/motive-compile.mjs` lines 193–228.
- **Criticality**: should
