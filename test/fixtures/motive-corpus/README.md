# test/fixtures/motive-corpus

Committed point-in-time snapshot of a subset of motives from `.groundwork/`.

Used by three corpus-coupled tests so they run deterministically without reading the live runtime directory:

- `test/motive-graph-parity-corpus.test.mjs`
- `test/hooks/journal-graph.test.ts`
- `test/hooks/journal-canvas.test.ts`

## Structure

```
.groundwork/
  journal/
    groundwork-development.jsonl      ← frozen events for groundwork-development
    obsidian-native-groundwork.jsonl  ← frozen events for obsidian-native-groundwork
  motives/
    groundwork-development/
      motive.md     ← charter
      tickets/      ← 6 ticket files
    obsidian-native-groundwork/
      motive.md     ← charter
      tickets/      ← 17 ticket files
```

## Covered shape classes

| Class | Where |
|---|---|
| Superseded decision (`superseded_by` forward-ref) | groundwork-development journal |
| Legacy title (title-only DECISION event) | groundwork-development journal |
| `resolved_by` (open item resolved by an accepted decision) | groundwork-development charter |
| `graduated_to` (open item graduated to a ticket) | groundwork-development charter + tickets |
| Met ACs (covered by slices) | groundwork-development charter |
| Unmet ACs (charter-only, no covering slice) | groundwork-development charter |
| Tickets (`.groundwork/motives/<slug>/tickets/*.md`) | groundwork-development tickets/ |

## Known gaps

- `slice` nodes: run ledgers are gitignored and per-session; excluded by design.
- `spec-requirement` nodes: parsed from `doc/specs/`; excluded to keep the fixture self-contained (no doc/specs/ copy).
- `revises` / `retires` edges: not yet emitted for the included motives at capture time.

## Regeneration

```bash
node test/fixtures/motive-corpus/capture.mjs
```

Run this ONLY when you intentionally update the golden corpus. Commit the result.
Set `USE_LIVE_CORPUS=1` to run tests against the live `.groundwork/` instead.
