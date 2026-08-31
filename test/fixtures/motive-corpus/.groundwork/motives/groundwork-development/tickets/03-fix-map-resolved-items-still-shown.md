# Fix: MAP.md and open-items/ drill-downs show resolved TBDs as still open

Type: fix
Status: open
Blocked by: —

## Question

`journal compile --json` correctly reports a burn-down (e.g. 24 total / 19 open / 5 resolved after
D-45/D-46/D-47 closed TBD-7, TBD-17, and TBD-21), yet MAP.md's `## Open items` section still lists
all three resolved items, and their drill-down files persist in `open-items/`. Where is the
disconnect, and what is the minimal fix?

## Context

The motive compile pipeline produces an `openItems` array with `resolved_by` populated on each
item where a matching accepted DECISION event carries `resolves: <id>` (`motive-compile.mjs:494–504`).
The summary counts are also correctly derived from this (`motive-compile.mjs:506–508`). So the JSON
output is correct.

The failure is in the downstream renderers that consume the compiled output:

1. **MAP renderer** (`hooks/lib/motive-map.mjs:646–657`): iterates `charter?.open_items ?? []`
   directly — not the compiled `openItems` array — and renders every item unconditionally. It never
   consults `resolved_by`, so resolved items remain visible in the `## Open items` section.

2. **Open-items drill-down sweep** (`hooks/lib/motive-tickets.mjs:85–132`): calls
   `_regenerate(motiveDir, { openItems, events })` where `openItems` comes from
   `charter.open_items` (`motive-map.mjs:68`). Because this array is unfiltered, drill-down files
   are written for all items including resolved ones, and the `resolved_by` field is only surfaced
   inside the drill-down (via `motive-tickets.mjs:223,233`) rather than affecting sweep scope.

   The drill-down file itself correctly renders status as "resolved" when `item.resolved_by` is set
   (`motive-tickets.mjs:220,223`), but the file still exists and MAP links to it, giving the
   impression the item is still actionable.

Additionally, D-53 extended TBD-29's scope: charter edits do not refresh MAP.md, meaning even if
the renderer is fixed, a re-generate will not fire until some other event triggers `MAP.md`
regeneration.

## Evidence

- `hooks/lib/motive-map.mjs:644–657` — `## Open items` render loop: iterates
  `charter?.open_items` without filtering on `resolved_by`.
- `hooks/lib/motive-compile.mjs:487–508` — correct compilation: `resolved_by` is populated per
  item from `resolvedByDecisions`, and `openItemsSummary` correctly counts resolved items.
- `hooks/lib/motive-compile.mjs:237` — `resolvedByDecisions` map: built from accepted DECISION
  events carrying `resolves` field.
- `hooks/lib/motive-tickets.mjs:68` — `openItems: charter?.open_items ?? []`: unfiltered charter
  items passed to drill-down sweep.
- `hooks/lib/motive-tickets.mjs:94` — `for (const item of openItems)`: no resolved_by check.
- `hooks/lib/motive-tickets.mjs:220–223` — drill-down status IS set to "resolved" for items with
  `resolved_by`, but the file still gets written and remains in `open-items/`.
- TBD-29 body in `.groundwork/motives/groundwork-development/open-items/tbd-29.md`: "burn-down
  moved in JSON only".
- D-53 (charter edits do not refresh MAP.md) extends this scope.

## Decision

**Fix the MAP `## Open items` renderer and the open-items/ drill-down sweep to skip items where `resolved_by` is non-null, so resolved TBDs disappear from the human read path once their resolving decision is accepted.**

The compiled `openItems` array already carries `resolved_by` — the renderers just need to filter
on it. The drill-down sweep should not write (or should remove) drill-down files for resolved
items, consistent with how stale ids are already removed (`motive-tickets.mjs:125–131`).

## Ruled out

- **Populate `resolved_by` into `charter.open_items` at init/edit time.** The charter is a human-
  authored source; writing derived fields back into it blurs the line between source-of-truth and
  derived artefact. The compile output is the right place for derived `resolved_by`.

- **Show resolved items in a separate `## Resolved items` section.** Considered as a softer change,
  but P-E requires MAP.md to be a clean human document. Resolved items that remain visible — even
  in a dedicated section — inflate the noise for readers tracking active work. A completed burn-down
  should be silent. The drill-down file can archive the resolution record.

- **Add a `s.status !== complete` to `openSlices` filter.** This was noted in the TBD as
  "rejected: handles APPROVE case but not active:false+pending slices" — it mixes ledger-slice
  status with open-item resolution, which are orthogonal concepts.

## Revisions

None yet.

## Links

- Graduated from: TBD-29 (MAP.md renders resolved open items as still open)
- `hooks/lib/motive-map.mjs:644–657` — open-items render loop (needs resolved_by filter)
- `hooks/lib/motive-compile.mjs:487–508` — correct openItems compilation (reference)
- `hooks/lib/motive-tickets.mjs:85–132` — open-items drill-down sweep (needs resolved_by filter)
- Related: D-53 (charter edits do not refresh MAP.md — extends scope of this ticket)
