---
name: authoring-standard
description: Audit and rewrite a groundwork skill against eight named failure modes. Load before editing any SKILL.md under skills/groundwork/.
---

# Groundwork Skill Authoring Standard

Each section below names a failure mode, explains its causal chain, and states the correction. Apply them in order.

## 1. No-op test

**Failure:** a sentence the model already obeys by default → tokens buy nothing; read-load accumulates without changing behaviour.

The test is model-relative, not reader-relative. If you would behave the same without the sentence, delete the whole sentence—not just words from it. Two people disagreeing about a no-op disagree about the model's default; run the document to settle it, not a debate.

Apply this test sentence by sentence before any other edits.

## 2. Restated environment

**Failure:** a sentence copies what `bin/ledger help`, `package.json` scripts, or a hook already declares → the copy drifts on the next change, pointing agents at stale facts.

Replace with a pointer (`bin/ledger help <cmd>`) or omit entirely. Cache only what the environment cannot show: the unwritten convention, the reason behind a choice, the gotcha no config confesses.

## 3. MUST-list

**Failure:** rules stated as bare imperatives without a failure story → the model cannot pattern-match them to real situations → compliance is spotty and context-dependent.

Name the failure mode first, explain the causal chain, then state the correction. Three named failure modes with chains replace pages of imperative rules and embed more deeply.

## 4. Vague completion

**Failure:** completion defined as "when you feel confident" or "looks good" → no mechanical exit condition → the model cannot determine when to stop.

State completion as an observable state the model can check (`wc -w` ≤ 700, `scripts/check-skill-standard.mjs` exits 0), not a judgment it cannot make.

## 5. Buried trigger

**Failure:** description opens with a noun or conjunction ("A skill for…", "When you need…") → the router must read further to know what fires the skill → trigger-matching degrades.

Leading word is the operative verb ("Audit", "Diagnose", "Build"). The clause adds branch discrimination; the verb does the triggering.

## 6. Duplicated logic

**Failure:** a user-invoked wrapper restates the model-invoked primitive's rules → the two copies diverge on the next edit → agents see contradictory guidance and pick arbitrarily.

A user-invoked wrapper points at the primitive and carries only what its own invocation path needs. Logic lives once.

## 7. Sprawling body

**Failure:** branch-specific material sits in the main body → every execution path reads what only some branches need → attention thins and output variance climbs.

Inline what every branch needs. Push branch-specific material behind an explicit pointer to a `reference/` sibling file. Buried in-file reference turns attending to it into a coin-flip: a variance lever, not merely a legibility issue.

## 8. Prose harness

**Failure:** prose sentences restate what a hook already blocks or a guard already enforces → read-load with no added protection → agents weight the prose against conflicting factors and may not comply.

Reserve prose guards for steps the harness cannot cover: irreversible actions (destructive git, `rm -rf`) and adversarial caller patterns the hook topology cannot detect. Never write a prose sentence that restates a registered hook.

---

## Completion

Rewrite is complete when: `wc -w` on the skill file is ≤ 700; `scripts/check-skill-standard.mjs` exits 0; the skill's audit table at `.groundwork/motives/<slug>/audits/<skill>.md` has one row per removed or moved sentence and `scripts/check-skill-standard.mjs --audit <skill> <audit-file>` exits 0; description's leading word is an operative verb; no sentence duplicates `bin/ledger help` output.

For audit table columns and worked rows, see [`reference/audit-table.md`](reference/audit-table.md).
