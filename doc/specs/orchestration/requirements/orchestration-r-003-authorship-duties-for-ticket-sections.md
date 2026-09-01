---
id: "orchestration-r-003"
type: requirement
concept: C-ORCHESTRATION
title: "Authorship duties for ticket sections"
criticality: should
verification: manual
status: open
design: "[[design#Slice lifecycle]]"
---

## ORCHESTRATION-R-003 — Authorship duties for ticket sections {#orchestration-r-003}

When a ticket is created for a slice, the **planner** agent **shall** fill the Question and Context sections before handing off to implementation. When the implementing agent marks the slice complete, it **shall** append its findings to the Evidence section and record the outcome in the Decision and Ruled out sections. Neither agent is required to fill Revisions or Links; those sections remain available for subsequent sessions. An agent **shall** not leave Question or Context empty on a ticket it opens; a parser **should** warn (not block) when a completed slice's ticket has an empty Decision section.

- **Why** — A ticket whose Question is never written is not a ticket — it is a placeholder. The authorship split (D-34) ensures that every ticket captures both the framing of the problem (planner's responsibility) and the outcome of the work (implementer's responsibility). Without this norm, tickets accumulate as empty shells that survive the no-delete invariant but carry no knowledge value. Warnings on empty Decision sections surface incomplete handoffs without blocking session end, keeping the gate non-disruptive.
- **Fit criterion** — Review session transcripts for ticket-linked slices: the planner's tool calls write Question and Context before delegating; the implementer's completion step appends to Evidence, Decision, and Ruled out. A parser called on a ticket with an empty Decision section emits a warning line naming the ticket id but exits 0.
- **Verification**: manual — agent behaviour cannot be mechanically enforced at the hook layer; the parser warning is automated.
- **Criticality**: should
