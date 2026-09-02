---
id: "artifact-r-008"
type: requirement
concept: C-ARTIFACT
criticality: must
verification: automated
status: open
design: "[[design/concepts/groundwork-artifacts]]"
---

## ARTIFACT-R-008 — No-delete invariant for markdown files {#artifact-r-008}

No groundwork code path **shall** remove a markdown file that it did not itself generate. A file is considered generated if and only if it was written by groundwork in the current process and carries the footer line `_Auto-generated — do not edit by hand._`. Any sweep, cleanup, or regeneration routine that iterates a directory of `.md` files **shall** skip files that lack this footer.

- **Why** — `hooks/lib/motive-tickets.mjs` (lines 134-139) previously enumerated `tickets/` and called `rmSync` on every `.md` whose stem was absent from the current session's generated set. A durable, hand-authored ticket placed in that directory would be silently destroyed on the next regeneration under a fresh session ledger. The invariant prevents this class of data loss across all present and future sweep routines.
- **Fit criterion** — Place a hand-authored `tickets/my-ticket.md` (no auto-generated footer) alongside generated files in the same directory; trigger a MAP regeneration or ticket sweep; confirm `my-ticket.md` is still present and unmodified after the operation. A generated file carrying the footer may be deleted by the generating code path.
- **Verification**: automated — the sweep routine checks the footer before any `rmSync` call; a regression test asserts that a hand-authored file survives the sweep.
- **Criticality**: must
