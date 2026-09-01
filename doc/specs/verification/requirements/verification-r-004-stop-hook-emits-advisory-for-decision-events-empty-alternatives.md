---
id: "verification-r-004"
type: requirement
concept: C-VERIFICATION
title: "Stop hook emits non-blocking advisory for DECISION events with empty alternatives or unmarked id collisions"
criticality: should
verification: manual
status: open
---

## VERIFICATION-R-004 — Stop hook emits non-blocking advisory for DECISION events with empty alternatives or unmarked id collisions {#verification-r-004}

If the Stop hook fires and any journal DECISION event for the current motive has an empty or absent `data.alternatives` array, or has a `data.id` that collides with another DECISION event's id without being explicitly marked as a supersession, then the Stop hook **shall** append a non-blocking advisory message naming the ids of those DECISION events.

- **Why** — Decisions recorded without alternatives leave no evidence that options were considered; id collisions without explicit supersession marks make the decision log ambiguous and hard to audit. Both are quality gaps detectable at session-end without blocking completion.
- **Fit criterion** — With a DECISION event carrying an empty `data.alternatives` array, the Stop hook output contains an advisory naming the decision id and the session is permitted to end. With a collision on `data.id` that carries no supersession marker, the Stop hook output contains an advisory naming the colliding ids and the session is still permitted to end. When all DECISION events have non-empty alternatives and no unmarked collisions, no advisory is emitted.
- **Verification**: manual — 
  1. Create a DECISION event with `data.alternatives: []` (empty). Invoke the Stop hook. Confirm an advisory is emitted naming the decision id and the session is not blocked.
  2. Create two DECISION events with the same `data.id`, neither marked as superseding the other. Invoke the Stop hook. Confirm an advisory is emitted naming the collision and the session is not blocked.
  3. Add a non-empty `data.alternatives` to the first event and a supersession marker to the second. Re-invoke the Stop hook. Confirm no advisory is emitted.
- **Criticality**: should
