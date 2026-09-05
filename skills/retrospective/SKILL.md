---
name: retrospective
description: Capture durable lessons from session mistakes and improvements into the Learnings KB.
---

# Retrospective

## Triggers

Invoke at session end when any of these fire:

- A mistake or wrong approach was corrected two or more times this session
- A non-obvious coordination rule was discovered (e.g., which hook fires in which order)
- A user correction should become a standing rule
- A streamlined recipe or improvement emerged (e.g., "local run guarantees CI before PR")
- The user said "remember this" or "add this to the rules"
- The struggle-detector surfaced a recurring signal in `.groundwork/struggle-signals.jsonl`

**Skipping-when-triggered failure:** the next session re-learns the same lesson from scratch. The Stop-gate does not enforce invocation; the fork does. A session that ran cleanly on the first attempt does not require a retrospective.

Do not invoke when the approach worked first time, the insight is task-specific and will not recur, the practice is already documented elsewhere, or a hook should enforce the constraint instead.

## Fork-Mode Contract

Run as a **fork** (`subagent_type: "fork"`) in **retrospective-fork mode**.

The dispatch prompt must say, verbatim in spirit: "You are the orchestrator running in **retrospective-fork mode** per CLAUDE.md: execute Phases 1–6 yourself with Read/Write/Edit, do NOT delegate or spawn subagents, do NOT end your turn to wait, return your report as your FINAL message. DRAFT any high-blast promotion (CLAUDE.md rule / new SKILL.md) and hand it back — do not apply it yourself."

The fork inherits full session history for full-fidelity reflection. Do not revoke the orchestrator identity ("you are not the orchestrator") — that contradicts the inherited system prompt. Invoke the carve-out instead, which extends the identity.

**Guaranteed-safe fallback:** if the fork misbehaves or opus cost is unwanted, the orchestrator reflects inline and delegates mechanical writes to a fresh `groundwork:general-purpose` subagent.

See [`reference/phases.md`](reference/phases.md) for per-phase detail and fork rationale.

## Six Phases

1. **Reflection** — survey session events for trigger conditions; identify concrete lessons. Read `.groundwork/struggle-signals.jsonl` for mechanical evidence.
2. **Classification** — classify each lesson by destination: `housekeep/reference/*.md` bullet, CLAUDE.md rule, or new SKILL.md.
3. **Apply policy** — auto-apply low-blast lessons (reference file bullets); draft high-blast changes (CLAUDE.md, new SKILL.md) for hand-back to the parent orchestrator. Never apply high-blast changes directly from the fork.
4. **Durable store** — write or upsert the Learnings KB entry at `.groundwork/learnings/<concept-slug>.md`; see schema below.
5. **Bloat control** — dedup against existing KB entries; reject unfalsifiable bullets; strip session-diary framing.
6. **Output summary** — emit: `RETROSPECTIVE: <concept-slug> → <destination> [auto-applied | proposed | pending advisor]`. If no trigger fired: `RETROSPECTIVE: no qualifying lessons this session — skipped`.

When a KB entry's recurrence reaches 2, run the promotion procedure — see [`reference/promotion.md`](reference/promotion.md).

## Learnings KB Schema

Each entry at `.groundwork/learnings/<concept-slug>.md`:

```
concept: <slug>
kind: mistake | improvement
status: LEARNING | PROMOTED
first_learned: YYYY-MM-DD
recurrence: 1
promoted_to: null
```

Body sections: distilled procedure, why the naive path fails, conditions that would invalidate this, recurrence log. Strip session-diary framing — write the principle, not the narrative. `kind` is metadata only: mistakes and improvements flow through identical lifecycle rules.

## Completion

Retrospective is complete when:
- All trigger conditions are evaluated.
- Each qualifying lesson has a KB entry at `.groundwork/learnings/<concept-slug>.md`.
- High-blast promotions (CLAUDE.md edits, new SKILL.md) are drafted in the final report, not applied.
- The Phase 6 output summary line is emitted.
