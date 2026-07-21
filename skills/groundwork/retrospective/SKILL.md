---
name: retrospective
description: Use when a mistake was corrected 2+ times in a session, a routing or coordination rule was discovered, the user said "remember this", or the struggle-detector surfaced a recurring signal in `.groundwork/struggle-signals.jsonl`.
---

# Retrospective

## MUST Invoke

Before ending any session where a recurring mistake was corrected, a routing rule was discovered, or the user said "remember this" — **you MUST invoke this skill. This is not optional.** Skipping it means the next session re-learns the same lesson from scratch. The Stop-gate does not enforce it; you do.

The imperative is narrow: it fires only when the trigger conditions are met. A session that ran cleanly and finished on the first attempt does NOT require a retrospective.

## When to Use

**Invoke when any of these apply:**

- A mistake or wrong approach was corrected 2 or more times in this session
- A non-obvious coordination rule was discovered (e.g., how the orchestrator should route a new signal type, which hook fires in which order)
- A user correction was given that should become a standing rule
- A "we should always…" or "never again…" insight emerged from a failed approach
- The user explicitly asked to codify something ("remember this", "add this to the rules")
- The struggle-detector surfaced a recurring signal (repeated near-identical command, fail-then-retry, file thrashing, recurring error signature) in `.groundwork/struggle-signals.jsonl`

**Do NOT invoke when:**

- The approach worked first time — no struggle, no correction
- The insight is a one-off, task-specific solution that will never recur
- The practice is already documented elsewhere (search first)
- The constraint is mechanical and should be enforced by a validator or hook, not a prose rule

---

## Phase 1 — Reflection

Answer three questions before writing anything:

1. **What did I fight?** Name the specific failure: the wrong assumption, the misrouted task, the repeated command, the revert. Be concrete — not "I had trouble with the build" but "I ran `npm run build` 4× with identical flags before checking that the config flag was wrong."

2. **What was the resolution?** The working approach in one sentence.

3. **Is it reusable?** Would this lesson apply in a different project or a different session on the same project? If yes, it clears the cross-project bar and belongs in a SKILL.md. If it only applies to this codebase, it belongs in a reference file. If it belongs nowhere but in this orchestrator's standing instructions, it belongs in CLAUDE.md.

**Read `.groundwork/struggle-signals.jsonl`** (if it exists) for concrete mechanical evidence. The signals are raw — repeated command hashes, fail-retry sequences, error signatures. Use them to confirm the lesson is real and recurring, not a one-off fluke.

---

## Phase 2 — Classification by Destination

```
Is the learning reusable across multiple projects?
├── YES → Cross-project SKILL.md  (see apply policy below)
└── NO → Is it a codebase fact, gotcha, dependency note, or lint rule?
    ├── YES → Bullet in skills/groundwork/housekeep/reference/*.md
    │          (or for an external repo: that repo's own skill / CLAUDE.md)
    └── NO → Is it a standing orchestrator routing or coordination rule?
        ├── YES → Proposed diff to CLAUDE.md  (propose-only; never auto-apply)
        └── NO → Does not need a durable artifact — do not write one
```

**Cross-project bar:** Ask "would I reference this in a fresh project with a different codebase?" If the answer is uncertain, default to the codebase-specific path. Over-promotion bloats the skill library; under-promotion costs one re-derivation at worst.

---

## Phase 3 — Apply Policy (Blast-Radius Split)

| Destination | Apply mode | Gate |
|---|---|---|
| `housekeep/reference/*.md` bullet | Auto-apply | None — low blast radius |
| CLAUDE.md routing / coordination rule | Propose-only | advisor gate before write |
| New cross-project `SKILL.md` | TDD-on-process + write | advisor gate before merge |

**TDD-on-process** (required for new SKILL.md):
1. RED — document the baseline scenario: describe exactly how an agent WITHOUT this skill fails (what it does, what rationalization it uses).
2. Write the skill.
3. GREEN — describe how an agent WITH the skill now behaves. The evaluation lives in `skills/groundwork/<name>/reference/evaluation.md`.
4. Close loopholes — reread the skill for any sentence an agent could rationalize past. Tighten the imperative language.

Do not write a skill until you have watched (or described) an agent fail without it. A skill that has no RED baseline may teach the wrong thing.

---

## Phase 4 — Durable Store: The Learnings KB

Cold store location: `.groundwork/learnings/<concept-slug>.md`

One file per concept. The slug is kebab-case, descriptive, and unique by concept — not by session. Before writing, search for an existing slug that covers the same concept (dedup by concept, not by keyword).

**File schema:**

```markdown
---
concept: <concept-slug>
status: LEARNING            # LEARNING | PROMOTED
first_learned: YYYY-MM-DD
recurrence: 1               # increment each time re-encountered
promoted_to: null           # path to SKILL.md or CLAUDE.md rule once promoted
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

**Lifecycle:**

- A lesson stays `LEARNING` until `recurrence >= 2` OR explicitly flagged high-value.
- On threshold, a distill step drafts the durable artifact and routes it per the apply policy above (advisor gate for high-blast).
- On promotion, set `status: PROMOTED` and `promoted_to: <path>`. The KB entry becomes an index — it is not deleted.

This KB mirrors the Rejection KB (`.groundwork/out-of-scope/`) but for positive, reusable knowledge. Same concept-keyed structure, same distillation discipline, inverted sign.

---

## Phase 5 — Bloat Control

Before writing anything, run these checks:

1. **Dedup:** Does a file already exist in `.groundwork/learnings/` with the same concept? If yes, increment `recurrence` and append to the recurrence log — do not create a duplicate.
2. **Dedup skill:** Does a skill already exist in `skills/` that covers this? If yes, update or annotate rather than create a parallel skill.
3. **Falsifiability:** Reference-file bullets must be falsifiable ("running `npm test` before `npm run build` causes X" is falsifiable; "always be careful with builds" is not). Reject unfalsifiable bullets.
4. **Cross-project bar:** A new SKILL.md must clear the "would I reference this across projects?" bar. If in doubt, store as a KB entry and wait for recurrence.
5. **Session-log smell:** The durable artifact must read as a principle, not a session diary entry. Strip all "during this session, I noticed…" framing before writing.

---

## Phase 6 — Output Summary

After completing the retrospective, emit a one-line summary for the orchestrator:

```
RETROSPECTIVE: <concept-slug> → <destination> [auto-applied | proposed | pending advisor]
```

If nothing met the threshold (no trigger condition fired), emit:

```
RETROSPECTIVE: no qualifying lessons this session — skipped
```

Do not emit a long report. The durable artifact IS the record.

---

## Phase 7 — Promotion Procedure (Recurrence Gate + Advisor)

This phase operationalizes what the apply table in Phase 3 declares. It runs only after the KB entry exists (Phase 4) and the lesson reaches the promotion threshold. The **orchestrator** (not an executor subagent) drives every step that involves the advisor gate.

### Step 1 — Recurrence Gate

Before doing anything, inspect the KB entry's frontmatter:

```
recurrence: <N>
```

- **Below threshold (`recurrence < 2`) AND not flagged high-value** → call `upsertLearning(projectDir, slug, patch)` to increment recurrence and append to the recurrence log, then **STOP**. Do not draft, propose, or apply anything. The lesson is real but not yet proven recurrent enough to promote.
- **At or above threshold (`recurrence >= 2`) OR user explicitly flags it high-value** → proceed to Step 2.

The threshold of 2 is the default. A user saying "this is important — promote it now" overrides the count gate regardless of `recurrence`.

### Step 2 — Classify Destination

Re-run the classification tree from Phase 2 on the distilled lesson. The classification determines which apply path below to take. Do not skip re-classification even if you classified it at first-encounter — the threshold pass is the moment to be precise.

### Step 3 — Apply by Blast Radius

#### Path A — Reference-file bullet (`housekeep/reference/*.md`)

_Blast radius: low. Auto-apply._

1. **Dedup search**: read the target reference file and search for any existing bullet that covers the same concept. If a match exists, update the bullet rather than appending a duplicate.
2. **Write the bullet** to the reference file (Edit tool, surgical diff).
3. **Trap-pruning** (see Step 4 below) — do this in the same Edit pass if applicable.
4. Call `promoteLearning(projectDir, conceptOrSlug, '<path/to/reference/file.md>')`.
   - This sets `status: PROMOTED` and `promoted_to: <path>` in the KB entry.
5. No advisor gate required.

#### Path B — CLAUDE.md routing or coordination rule

_Blast radius: high. Propose-only. Orchestrator drives the gate._

1. **Draft a proposed diff** — a concrete, minimal change to `CLAUDE.md` that adds or amends the routing rule. Write the diff in full; do not summarize it.
2. **Present the diff to the user** with the rationale: which lesson it encodes, what the blast radius is, why the wording is precise.
3. **Invoke the advisor gate**: submit the proposed diff to `groundwork:advisor` with the evidence (lesson slug, recurrence count, the trap it prevents). Do NOT write to `CLAUDE.md` until the advisor returns `APPROVE`.
4. **On APPROVE**: apply the diff (Edit tool), then call `promoteLearning(projectDir, conceptOrSlug, 'CLAUDE.md')`.
5. **On CORRECTION or STOP**: revise the diff per the advisor feedback and re-submit, or abandon the promotion and leave the entry at `LEARNING`.
6. **Trap-pruning** (see Step 4 below) — include in the same diff that goes to the advisor if applicable; do not ship the rule without removing the stale artifact it supersedes.

#### Path C — New cross-project `SKILL.md`

_Blast radius: high. TDD-on-process + advisor gate. Orchestrator drives the gate._

1. **RED baseline**: write `skills/groundwork/<name>/reference/evaluation.md` documenting exactly how an agent WITHOUT this skill fails — the wrong assumption, the rationalization it uses, the bad outcome. This is the falsifiable failure criterion.
2. **Write the skill** at `skills/groundwork/<name>/SKILL.md`, following the schema and imperative language conventions of existing skills.
3. **GREEN baseline**: append to `evaluation.md` how an agent WITH the skill now behaves. The contrast must be observable and specific.
4. **Close loopholes**: reread the skill for any sentence an agent could rationalize past. Tighten the imperative language before submitting.
5. **Invoke the advisor gate**: submit the new SKILL.md (and evaluation.md) to `groundwork:advisor`. Do NOT merge or register the skill until the advisor returns `APPROVE`.
6. **On APPROVE**: call `promoteLearning(projectDir, conceptOrSlug, 'skills/groundwork/<name>/SKILL.md')`.
7. **Trap-pruning** (see Step 4 below) — remove or annotate the stale artifact in the same change set that the advisor reviews.

### Step 4 — Trap-Pruning (mandatory when a stale artifact is superseded)

When the promotion encodes a procedure that supersedes or contradicts a stale artifact — a dead task stub, a misleading state-file name, an obsolete comment, a confusing convention — **remove or annotate that artifact in the same change** that ships the promoted lesson.

_Canonical example_: in the nexus codebase, task-state files named `dev:daemon:running` or `sshd.pid` mislead agents into thinking a service is live when it is not. When a lesson about checking process liveness (not just file presence) is promoted, the promotion diff must also rename, annotate, or remove those misleading files — not leave them in place for the next agent to stumble over.

Rule: **codified knowledge and the cleanup that enables it ship together**. A promoted lesson that leaves its contradicting trap in place is incomplete.

### Step 5 — Record

After a successful promotion (advisor APPROVE on high-blast paths, or auto-apply on low-blast paths), confirm the KB entry reflects:

```
status: PROMOTED
promoted_to: <actual path written>
```

Call `resolveLearningPath(projectDir, slug)` to verify the file exists at the recorded path. If it does not, the promotion is incomplete — do not mark it PROMOTED.

Emit the Phase 6 output summary line with `[auto-applied]` or `[advisor APPROVED]` as appropriate.

---

## Feeders

`diagnose` Phase 6 (cleanup + post-mortem) and `arch-review` are feeders that point here — when either surfaces a recurring pattern or a structural finding worth preserving, they invoke `/retrospective`. Wiring is added in slice s7; this skill is the destination.

---

## What NOT to Do

- Do not dump session summaries into the KB. Distill the principle; discard the narrative.
- Do not auto-apply a CLAUDE.md change. Propose it; route it through the advisor gate.
- Do not create a new SKILL.md without a RED baseline scenario and advisor gate.
- Do not invoke this skill when no trigger condition fired — a false retrospective adds noise.
- Do not skip the dedup check. A second file for the same concept splits the recurrence count and defeats the promotion gate.
