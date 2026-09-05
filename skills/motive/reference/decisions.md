# DECISION event — fields and worked examples

## Required fields

`id`, `decision`, `rationale` — exit 2 if any are absent.

## Optional fields

`alternatives` (array; defaults to `[]`), `revises`, `supersedes`, `resolves`, `status`, `blast`, `research`.

## Refine a decision in place (same id)

```
journal append --motive <slug> --type DECISION --msg "Refined: use X with caching" \
  --data '{"id":"D-1","decision":"Use X with caching","rationale":"Updated after benchmarks","revises":"D-1"}'
```

Setting `data.revises` to the entry's own id marks this as an intentional same-id refinement. The two events are merged into one compiled entry (earliest `ts` retained) and no collision warning is emitted. A `revises` value naming a different id does not suppress the collision flag.

## Supersede a decision (different id)

```
journal append --motive <slug> --type DECISION --msg "Accepted: use Z instead" \
  --data '{"id":"D-2","decision":"Use Z","rationale":"Z is now supported","supersedes":"D-1","resolves":"TBD-3"}'
```

This marks D-1 `superseded` (with `superseded_by: D-2`) and resolves open item `TBD-3` if present in the charter. Both D-1 and D-2 appear as separate rows in the compiled output. A `rejected` decision does NOT resolve its `resolves` target.

## Other event types

All via `journal append --motive <slug> --type <T> --msg "…" [--data '{}']`.

| Type | When |
|---|---|
| `MILESTONE` | A major deliverable or phase boundary is reached |
| `TASK_COMPLETE` | A concrete task within the initiative is done |
| `GATE` | An advisor or external review has been passed |
| `VERIFICATION` | A claim has been independently verified |
| `HANDOFF` | Work is being handed to another agent or session |
| `FAILURE` | A significant failure or regression occurred |
| `SPEC_CHANGE` | A committed spec or doc was changed |
| `WAIVER` | A constraint was explicitly waived with justification |
