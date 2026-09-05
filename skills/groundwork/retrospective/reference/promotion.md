# Retrospective — Promotion Procedure (Phase 7)

Operationalizes the apply table in Phase 3. Runs only after the KB entry exists (Phase 4) and the lesson reaches the promotion threshold. The **orchestrator** (not an executor subagent) drives every step that involves the advisor gate. In retrospective-fork mode, the fork performs the KB upsert and low-blast reference-file writes and drafts high-blast diffs in its final message; the parent orchestrator drives the advisor gate and applies high-blast changes (CLAUDE.md, new SKILL.md) only on advisor APPROVE.

---

## Step 1 — Recurrence Gate

Inspect the KB entry's frontmatter:

```
recurrence: <N>
```

- **Below threshold (`recurrence < 2`) AND not flagged high-value** → call `upsertLearning(projectDir, slug, patch)` to increment recurrence and append to the recurrence log, then STOP. Do not draft, propose, or apply anything. The lesson is real but not yet proven recurrent enough to promote.
- **At or above threshold (`recurrence >= 2`) OR user explicitly flags it high-value** → proceed to Step 2.

The threshold of 2 is the default. A user saying "this is important — promote it now" overrides the count gate regardless of `recurrence`.

---

## Step 2 — Classify Destination

Re-run the classification tree from Phase 2 on the distilled lesson. The classification determines which apply path to take. Do not skip re-classification even if you classified at first-encounter — the threshold pass is the moment to be precise.

---

## Step 3 — Apply by Blast Radius

### Path A — Reference-file bullet (`housekeep/reference/*.md`)

_Blast radius: low. Auto-apply._

1. **Dedup search:** read the target reference file and search for any existing bullet covering the same concept. If a match exists, update it rather than appending a duplicate.
2. **Write the bullet** to the reference file (Edit tool, surgical diff).
3. **Trap-pruning** (see Step 4 below) — do this in the same Edit pass if applicable.
4. Call `promoteLearning(projectDir, conceptOrSlug, '<path/to/reference/file.md>')`.
5. No advisor gate required.

### Path B — CLAUDE.md routing or coordination rule

_Blast radius: high. Propose-only. Orchestrator drives the gate._

1. **Draft a proposed diff** — a concrete, minimal change to `CLAUDE.md` that adds or amends the routing rule. Write the diff in full; do not summarize it.
2. **Present the diff to the user** with the rationale: which lesson it encodes, what the blast radius is, why the wording is precise.
3. **Invoke the advisor gate:** submit the proposed diff to `groundwork:advisor` with the evidence (lesson slug, recurrence count, the trap it prevents). Do NOT write to `CLAUDE.md` until the advisor returns APPROVE.
4. **On APPROVE:** apply the diff (Edit tool), then call `promoteLearning(projectDir, conceptOrSlug, 'CLAUDE.md')`.
5. **On CORRECTION or STOP:** revise the diff per advisor feedback and re-submit, or abandon the promotion and leave the entry at LEARNING.
6. **Trap-pruning** — include in the same diff that goes to the advisor if applicable; do not ship the rule without removing the stale artifact it supersedes.

### Path C — New cross-project `SKILL.md`

_Blast radius: high. TDD-on-process + advisor gate. Orchestrator drives the gate._

1. **RED baseline:** write `skills/groundwork/<name>/reference/evaluation.md` documenting exactly how an agent WITHOUT this skill fails — the wrong assumption, the rationalization it uses, the bad outcome.
2. **Write the skill** at `skills/groundwork/<name>/SKILL.md`, following schema and language conventions of existing skills.
3. **GREEN baseline:** append to `evaluation.md` how an agent WITH the skill now behaves. The contrast must be observable and specific.
4. **Close loopholes:** reread the skill for any sentence an agent could rationalize past. Tighten the language before submitting.
5. **Invoke the advisor gate:** submit the new SKILL.md (and evaluation.md) to `groundwork:advisor`. Do NOT merge or register the skill until the advisor returns APPROVE.
6. **On APPROVE:** call `promoteLearning(projectDir, conceptOrSlug, 'skills/groundwork/<name>/SKILL.md')`.
7. **Trap-pruning** — remove or annotate the stale artifact in the same change set the advisor reviews.

---

## Step 4 — Trap-Pruning (mandatory when a stale artifact is superseded)

When the promotion encodes a procedure that supersedes or contradicts a stale artifact — a dead task stub, a misleading state-file name, an obsolete comment, a confusing convention — remove or annotate that artifact in the same change that ships the promoted lesson.

Codified knowledge and the cleanup that enables it ship together. A promoted lesson that leaves its contradicting trap in place is incomplete.

---

## Step 5 — Record

After a successful promotion (advisor APPROVE on high-blast paths, or auto-apply on low-blast paths), confirm the KB entry reflects:

```
status: PROMOTED
promoted_to: <actual path written>
```

Call `resolveLearningPath(projectDir, slug)` to verify the file exists at the recorded path. If it does not, the promotion is incomplete — do not mark it PROMOTED.

Emit the Phase 6 output summary line with `[auto-applied]` or `[advisor APPROVED]` as appropriate.
