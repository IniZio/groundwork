---
id: enforcement-r-011
type: requirement
concept: C-ENFORCEMENT
title: Prose-modality-guard warns when modal hedges are upgraded to strong assertions
status: implemented
verification: unverified
criticality: should
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-011 — Prose-modality-guard warns when modal hedges are upgraded to strong assertions {#enforcement-r-011}

If an Edit, Write, or MultiEdit call would replace a modal hedge (`may`, `could`, `sometimes`, `might`, `appears to`, `is likely to`) with a strong assertion (`will`, `does`, `always`, `is`) in a sentence that survives the edit (≥40% vocabulary overlap), then the enforcement hook **shall** emit an advisory allow response identifying the sentence and the hedge-to-assertion substitution; the hook **shall not** deny the write; wholesale rewrites where vocabulary overlap falls below 40% **shall** pass through without advisory.

- **Why** — A modal hedge carries the author's calibrated confidence; upgrading it changes the epistemic claim without evidence. In memory notes and spec documents, "the guard may block writes" → "the guard always blocks writes" can mislead an orchestrator that reads the note as ground truth. In a spec requirement, a hedge-to-assertion upgrade silently strengthens the normative claim. The advisory-only design matches the negation guard's approach: the false-positive rate at the sentence-matching level is too high for a hard block without AST context.
- **Fit criterion** — Running the hook with an Edit whose `old_string` contains "the hook may block requests" and `new_string` contains "the hook always blocks requests" returns an allow response with `permissionDecisionReason` naming the upgrade. Running with a clean edit returns empty stdout and exit 0.
- **Verification**: unverified — the hook is tested in `test/hooks/prose-modality-guard.test.ts`.
- **Criticality**: should
