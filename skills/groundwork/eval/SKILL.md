---
name: eval
description: "Run and author `claude plugin eval` suites for this plugin. Triggers on: running a plugin eval, writing eval cases, a case scoring unexpectedly low, recording a baseline score."
disable-model-invocation: false
---

## Early-access gate

Running eval (not just `--help`) requires `CLAUDE_CODE_WALNUT_SPIRE=1`. Without it the runner prints "`plugin eval` is currently in early access" and exits. The flag is client-side only.

```bash
CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval .
```

Set it permanently via `~/.claude/settings.json` `"env": {"CLAUDE_CODE_WALNUT_SPIRE": "1"}`.

---

## Named failure modes

### Ablation-unscored

`claude plugin eval` defaults to `--ablation with-without`, which adds a no-plugin baseline arm. Under that mode any grader carrying `tool_used: Skill` is classified as a with-only indicator and **excluded from the score entirely** — the result silently reads 0, indistinguishable from comprehension failure.

Trigger-rate suites with `tool_used: Skill` graders must pass `--ablation none`:

```bash
CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval . --ablation none
```

### Skill-creator-trigger-blind

skill-creator's trigger evals cannot measure an installed plugin skill. The detector matches a temporary UUID-based name; the model invokes the real `plugin:skill` name. Recall reads 0% while the skill fires correctly. Trigger-rate measurement for installed skills requires a different harness.

### Low-score-grader-mismatch

A score of 0.33 on a comprehension case does not mean the model failed to understand the spec — the grader criteria may ask for something the cited requirement does not say.

Before investigating model behaviour: read the grader criteria, read the pasted spec in `execution.prompt`, confirm the criteria match. If not, fix the criteria or paste the correct requirement. Editing a case to be easier destroys the measurement.

---

## Running the suite

For all flags and judge-model options, see `claude plugin eval --help`.

Cost discipline: each case bills real model calls. Run the full suite once to identify failures, then isolate with `--case <name>` and `--runs 1`. Bump back to `--runs 3` for the final measurement (variance is real at n=1).

```bash
# Full suite
CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval . --ablation none

# One case, one run
CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval . --case absent-pacing-disabled --runs 1
```

Results land in `evals/<suite>/results/<timestamp>/` (gitignored). Exit 2 signals a cost-ceiling abort, not a broken run.

---

## Recording a baseline

```bash
bin/journal append \
  --motive <slug> \
  --type BASELINE \
  --msg "spec-comprehension suite: <suite>/<run-date>, N cases, avg score X.XX" \
  --data '{"suite": "<suite>", "cases": N, "avg_score": X.XX, "run_date": "YYYY-MM-DD"}'
```

A score is a delta only when a prior `BASELINE` event exists for the same suite and grader set. The first run is an inaugural number — record it as such. See `bin/journal help append` for valid event types.

---

## Authoring cases

Case files live in `evals/`, runner scripts in `scripts/eval/`. For the `case.yaml` schema, the `execution.system` override pattern, and the committed suite layout, see [`reference/case-authoring.md`](reference/case-authoring.md).

---

## Completion

Suite runs without the gated message, cases score above threshold for ≥ 3 runs, any new baseline is recorded with a `BASELINE` journal event. Check: `wc -w skills/groundwork/eval/SKILL.md` ≤ 700, `scripts/check-skill-standard.mjs` exits 0.
