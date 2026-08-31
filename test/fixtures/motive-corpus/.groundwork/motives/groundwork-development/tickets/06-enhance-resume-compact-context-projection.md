# Enhance: resume reconstruction dumps full compiled motive JSON into orchestrator context

Type: enhancement
Status: open
Blocked by: —

## Question

The `/groundwork:resume` skill calls `journal compile <slug> --stdout --json` to reconstruct
working state. On a mature motive this dumps the full compiled JSON — full decision prose, all
open-item bodies, ac_coverage, human narrative sections, provenance — into the orchestrator's
context window. This directly violates groundwork's own context-protection principle. What is the
right projection surface for resume, and how should `journal compile` (or its callers) be changed
to deliver it?

## Context

`skills/groundwork/resume/SKILL.md` instructs the orchestrator to run:

```
journal compile <slug> --stdout --json
```

The compiled output is the FULL motive document: every `decision_log` entry with title, decision,
and rationale prose; every `open_item` body; `ac_coverage` rows; the full `human.narrative_sections`
map; and provenance metadata. For the `codify-motive-dag` motive (2026-08-07), a single `compile`
call dumped approximately 15 KB of JSON into the orchestrator's context window.

The resume checklist (`SKILL.md` Phase 2) consumes only a compact subset of this:

- `objective` — one line
- AC met/unmet summary (ids + counts, not prose)
- `resume.next_actions` — program-counter list
- `last_pause` pointer or summary
- Open + blocked slice ids in wave order (from ledger, not journal)
- Concurrent `claimed_by` entries

The full `decision_log` prose corpus is NOT needed to reconstruct the program counter. When the
orchestrator ingests 15 KB of JSON it will not use, that burns context capacity for the rest of the
session — exactly the pattern that `ctx_batch_execute` was introduced to prevent.

The constraint on any fix: resume must still be able to surface REPLAN decisions and blocked slices
without pulling full decision prose. A REPLAN decision today lives in the journal shard; the resume
skill needs to detect its presence and identify which slices it affects, but does not need the full
rationale text to decide "there is a REPLAN — stop and alert."

## Candidate Options

These are unscoped options for later design. No preference is expressed here; the ticket records
them for the scoping conversation.

**Option A — `journal compile <slug> --resume` projection mode**
Add a `--resume` (or `--summary`) flag to `journal compile` that emits only the fields the resume
checklist consumes: `objective`, `ac_coverage` (ids + met/unmet counts only), `resume.next_actions`,
`last_pause` (summary pointer, not full body), and a `replan_detected: true/false` flag derived from
scanning the decision log for REPLAN-class events. Full decision prose and `human.narrative_sections`
are omitted from this projection.

**Option B — `--fields <list>` selector on compile**
Add a `--fields` flag allowing callers to specify a dot-path allowlist (e.g.
`--fields objective,ac_coverage.summary,resume,last_pause`). More flexible than Option A but
requires the resume skill to enumerate the allowlist explicitly, which may drift as the schema evolves.

**Option C — replace compile with ambient MAP.md + ledger status**
Have resume read the already-generated `MAP.md` (ambient, always current) for the human-readable
summary plus `ledger status` (compact, machine-readable) for slice state. This avoids calling
`compile` at all for the program-counter reconstruction. Downside: MAP.md does not surface
`resume.next_actions` or `last_pause` payloads; those would still require a targeted compile query
or a new field in MAP.md.

**Option D — targeted field extraction without a new flag**
Post-process the current `compile --json` output using `ctx_execute_file` so only the compact
fields enter the orchestrator's context — the raw JSON stays in the sandbox. This is a skill-side
change (no `journal` changes needed) but still pays the serialization cost of the full JSON on the
journal side.

## Acceptance Criteria

1. After the fix, a resume invocation on a mature motive (≥10 decision log entries, ≥5 narrative
   sections) brings fewer than 2 KB of compiled data into the orchestrator's context window for
   program-counter reconstruction.
2. The compact output is sufficient to detect a REPLAN-class event in the decision log (a
   `replan_detected` field or equivalent) without reading full decision prose.
3. The compact output includes `resume.next_actions` and `last_pause` (summary form).
4. A regression test asserts that the compact/resume projection omits `decision_log[*].rationale`
   and `human.narrative_sections` body text from its output.
5. The full `journal compile <slug> --json` command (no flags) continues to emit the complete
   document unchanged — this is an additive change only.

## Ruled out

Nothing ruled out yet — this ticket is pre-scoping.

## Revisions

None yet.

## Links

- `skills/groundwork/resume/SKILL.md` — Phase 2 CHECKLIST step that calls `compile --stdout --json`
- `hooks/journal.mjs` — `compile` command implementation
- `hooks/lib/motive-map.mjs` — MAP.md generation (ambient, used by Option C)
- Related: context-protection principle in `CLAUDE.md` ("keep raw output out of your window")
- Related: `ctx_batch_execute` / `ctx_execute_file` — current mechanisms for sandbox-only processing
- Observed: 2026-08-07 resume of `codify-motive-dag` motive dumped ~15 KB of compiled JSON
