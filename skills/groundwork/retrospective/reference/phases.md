# Retrospective — Phase Detail

Companion to `SKILL.md`. Contains per-phase detail and the fork execution model rationale. The one-line phase steps in `SKILL.md` are the operative summary; this file is the reference for edge cases and subtleties.

---

## Fork Execution Model — Rationale

A fork inherits the full session history, enabling full-fidelity reflection while keeping bulk reasoning out of the orchestrator's context window. The fork also inherits the orchestrator identity — do NOT try to revoke it ("you are not the orchestrator"); that contradicts the inherited system prompt and competes with it unreliably. The carve-out EXTENDS the identity rather than contradicting it, which is why it works.

The fork is pinned to the parent model (opus) and fork mode is prompt-level, not mechanical. On a short or mechanical retro, or when opus cost is unwanted: the orchestrator reflects inline and delegates only the mechanical writes to a fresh `groundwork:general-purpose` subagent.

---

## Phase 1 — Reflection

Answer three questions before writing anything:

1. **What did I fight?** Name the specific failure: the wrong assumption, the misrouted task, the repeated command, the revert. Be concrete — not "I had trouble with the build" but "I ran `npm run build` 4× with identical flags before checking that the config flag was wrong."

2. **What was the resolution?** The working approach in one sentence.

3. **Is it reusable?** Would this lesson apply in a different project or a different session on the same project? If yes, it clears the cross-project bar and belongs in a SKILL.md. If it only applies to this codebase, it belongs in a reference file. If it belongs in the orchestrator's standing instructions only, it belongs in CLAUDE.md.

Read `.groundwork/struggle-signals.jsonl` (if it exists) for mechanical evidence. Signals are raw — repeated command hashes, fail-retry sequences, error signatures. Use them to confirm the lesson is real and recurring, not a one-off fluke.

---

## Phase 2 — Classification by Destination

```
Is the learning reusable across multiple projects?
├── YES → Cross-project SKILL.md  (see apply policy)
└── NO → Is it a codebase fact, gotcha, dependency note, or lint rule?
    ├── YES → Bullet in skills/groundwork/housekeep/reference/*.md
    │          (or for an external repo: that repo's own skill / CLAUDE.md)
    └── NO → Is it a standing orchestrator routing or coordination rule?
        ├── YES → Proposed diff to CLAUDE.md  (propose-only; never auto-apply)
        └── NO → Does not need a durable artifact — do not write one
```

**Cross-project bar:** ask "would I reference this in a fresh project with a different codebase?" If uncertain, default to the codebase-specific path. Over-promotion bloats the skill library; under-promotion costs one re-derivation at worst.

---

## Phase 3 — Apply Policy (Blast-Radius Split)

| Destination | Apply mode | Gate |
|---|---|---|
| `housekeep/reference/*.md` bullet | Auto-apply | None — low blast radius |
| CLAUDE.md routing / coordination rule | Propose-only | advisor gate before write |
| New cross-project `SKILL.md` | TDD-on-process + write | advisor gate before merge |

**Retrospective-fork mode caveat:** a fork applies ONLY the low-blast `housekeep/reference/*.md` row itself. The two high-blast rows (CLAUDE.md rule, new SKILL.md) are drafted and deferred — the parent orchestrator drives the advisor gate and performs the write/merge. A retrospective fork never writes a SKILL.md or edits CLAUDE.md. The TDD-on-process steps below are authored/drafted by the fork but only committed by the parent after APPROVE.

**TDD-on-process** (required for new SKILL.md):
1. RED — document the baseline scenario: describe exactly how an agent WITHOUT this skill fails (what it does, what rationalization it uses).
2. Write the skill.
3. GREEN — describe how an agent WITH the skill now behaves. The evaluation lives in `skills/groundwork/<name>/reference/evaluation.md`.
4. Close loopholes — reread the skill for any sentence an agent could rationalize past. Tighten the language.

Do not write a skill until you have watched (or described) an agent fail without it. A skill with no RED baseline may teach the wrong thing.

---

## Phase 4 — Durable Store: The Learnings KB

Cold store: `.groundwork/learnings/<concept-slug>.md` — one file per concept. The slug is kebab-case, descriptive, and unique by concept (not by session). Before writing, search for an existing slug covering the same concept (dedup by concept, not by keyword).

**Full file schema:**

```markdown
---
concept: <concept-slug>
kind: mistake               # mistake | improvement
status: LEARNING            # LEARNING | PROMOTED
first_learned: YYYY-MM-DD
recurrence: 1               # increment each time re-encountered
promoted_to: null           # path once promoted
---

## Distilled procedure
<the reusable, generic procedure — NOT a raw session transcript>

## Why the naive path fails
<the trap; the assumption that breaks>

## Conditions that would invalidate this
<when to retire or revalidate: dependency upgrade, API change, env change>

## Recurrence log
- YYYY-MM-DD — session <id> — <one-line description of the encounter>
```

`kind` field: set `mistake` for corrected errors and wrong approaches; set `improvement` for positive discoveries (streamlined recipes, workflow shortcuts, faster diagnosis paths). Both kinds flow through identical lifecycle rules — `kind` is metadata only.

**Lifecycle:**
- A lesson stays `LEARNING` until `recurrence >= 2` or explicitly flagged high-value. This threshold is sign-agnostic: improvements and mistakes reach the promotion gate identically.
- On threshold, a distill step drafts the durable artifact and routes it per the apply policy (advisor gate for high-blast).
- On promotion, set `status: PROMOTED` and `promoted_to: <path>`. The KB entry becomes an index — it is not deleted.

This KB mirrors the Rejection KB (`.groundwork/out-of-scope/`) but for positive, reusable knowledge.

---

## Phase 5 — Bloat Control

Before writing anything, run these checks:

1. **Dedup:** does a file already exist in `.groundwork/learnings/` for the same concept? If yes, increment `recurrence` and append to the log — do not create a duplicate.
2. **Dedup skill:** does a skill already exist in `skills/` covering this? If yes, update or annotate rather than creating a parallel skill.
3. **Falsifiability:** reference-file bullets must be falsifiable ("running `npm test` before `npm run build` causes X" is falsifiable; "always be careful with builds" is not). Reject unfalsifiable bullets.
4. **Cross-project bar:** a new SKILL.md must clear the "would I reference this across projects?" bar. If in doubt, store as a KB entry and wait for recurrence.
5. **Session-log smell:** the durable artifact must read as a principle, not a session diary entry. Strip all "during this session, I noticed…" framing before writing.

---

## Phase 6 — Output Summary

Format:

```
RETROSPECTIVE: <concept-slug> → <destination> [auto-applied | proposed | pending advisor]
```

If no trigger fired:

```
RETROSPECTIVE: no qualifying lessons this session — skipped
```

One line only. The durable artifact IS the record; do not emit a long report.
