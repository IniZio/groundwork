# TDD-on-Process Evaluation: retrospective SKILL.md

This file is the baseline evaluation for the `retrospective` skill. It documents the RED scenario (what an agent does without the skill) and the GREEN expectation (what it does with the skill present). It is the reference artifact required by the TDD-on-process apply policy before the skill can be promoted or considered complete.

---

## RED Scenario (baseline — skill absent)

**Setup:** An orchestrator agent runs a two-hour feature session. During the session it makes the same mistake twice: it dispatches a `general-purpose` agent for a task that should be routed to `test-engineer` (it forgets that test strategy belongs to the specialist). The user corrects it both times. The session ends. The agent closes out with a final summary message and stops.

**What the agent does without the skill:**

- Notices neither correction as a pattern.
- Writes no KB entry, no reference bullet, no proposed CLAUDE.md diff.
- The next session starts with no memory of the routing mistake.
- The same misroute happens again in session 3.

**Observable failure:** After two explicit corrections in a single session, the agent ends without any durable artifact. `.groundwork/learnings/` is empty. No CLAUDE.md diff was proposed. The routing table in CLAUDE.md is unchanged.

**Why the agent rationalizes skipping it (without the skill):** "The session is complete. The user's task is done. I should not create extra work by adding process documentation that wasn't requested."

---

## GREEN Expectation (with retrospective skill present)

**Same setup.** The agent was corrected twice on the same routing mistake.

**What the agent does with the skill:**

1. Recognizes the trigger: a mistake corrected 2+ times in one session.
2. Invokes `/retrospective` before ending.
3. Works through Phase 1 — names the mistake concretely: "I dispatched `general-purpose` for test strategy twice; both times the user redirected to `test-engineer`."
4. Classifies via Phase 2: this is an orchestrator routing rule → destination is a proposed CLAUDE.md diff.
5. Applies Phase 3 blast-radius policy: propose-only → does NOT auto-apply.
6. Drafts the exact CLAUDE.md diff (one row in the routing table: `"write tests", "coverage", "TDD"` → `test-engineer`) and presents it to the user for review.
7. Creates `.groundwork/learnings/test-engineer-routing.md` with `status: LEARNING`, `recurrence: 2`, and a recurrence log with both session encounters.
8. Emits: `RETROSPECTIVE: test-engineer-routing → CLAUDE.md diff [proposed]`

**Observable pass:** `.groundwork/learnings/test-engineer-routing.md` exists with `recurrence: 2`. A concrete CLAUDE.md diff was proposed (not auto-applied). No duplicate entry was created.

---

## Loophole Inventory

These are rationalizations an agent might use to skip the skill even with it present. Each should be closed by rereading the skill body:

| Rationalization | Closed by |
|---|---|
| "The user didn't ask for a retrospective." | MUST invoke imperative in the skill header — trigger is the condition, not the user's request |
| "This is project-specific, not cross-project." | Classification phase routes it to a reference bullet or CLAUDE.md diff — not everything needs a SKILL.md |
| "I'll do it next session." | There is no next session — each session starts fresh without this KB |
| "The correction was minor." | Trigger is recurrence count (≥ 2), not severity |
| "I already summarized the session." | A session summary is not a KB entry; the skill requires distillation to a principle |
