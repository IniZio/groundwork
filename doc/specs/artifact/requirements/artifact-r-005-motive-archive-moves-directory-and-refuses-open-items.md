---
id: "artifact-r-005"
type: requirement
concept: C-ARTIFACT
criticality: must
verification: manual
status: open
design: "[[design/concepts/groundwork-artifacts]]"
---

## ARTIFACT-R-005 — Motive archive moves directory and refuses open items without --force {#artifact-r-005}

When `journal motive archive <slug>` is invoked, `hooks/journal.mjs` **shall** move `.groundwork/motives/<slug>/` to `.groundwork/archive/motives/<slug>/`, append a `MILESTONE` event recording the archive destination path, and exit non-zero without moving the directory if the charter contains open TBD or TBR items unless `--force` is supplied.

- **Why** — Archiving a motive with unresolved open items silently buries declared-incomplete work; the guard surfaces the oversight at archive time, and `--force` provides an explicit escape hatch for intentionally deferred items, preventing accidental loss of the open-items signal.
- **Fit criterion** — `journal motive archive slug` with open TBD items in the charter exits non-zero and leaves `.groundwork/motives/slug/` in place; `journal motive archive slug --force` moves the directory to `.groundwork/archive/motives/slug/` and a MILESTONE event appears in the journal with `data.archived_to` naming the relative archive path.
- **Verification**: manual — Manual demonstration — run `journal motive archive` against a charter with an open TBD; confirm non-zero exit and directory intact. Then re-run with `--force`; confirm directory moved and MILESTONE event present in journal.
- **Criticality**: must
