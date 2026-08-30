---
name: eval
description: "\"Run and author `claude plugin eval` suites for this plugin. Triggers on: running a plugin eval, writing eval cases, eval is gated or early access, a case scoring unexpectedly low, adding a comprehension case for a spec concept, recording a baseline score in the journal.\""
disable-model-invocation: false
---

## Early-access gate

Running eval (not just `--help`) requires `CLAUDE_CODE_WALNUT_SPIRE=1`. Without
it the runner prints "`plugin eval` is currently in early access" and exits
instead of running cases. The flag is client-side only — no account flag needed.

```bash
CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval .
```

To set it permanently so you never have to prefix commands:

```json
// ~/.claude/settings.json
{
  "env": {
    "CLAUDE_CODE_WALNUT_SPIRE": "1"
  }
}
```

Verification: `claude plugin eval` (no flag) → early-access message. `CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval --help` → usage.

---

## Required case.yaml fields

The runner rejects a case file that is missing `schema_version` or `name`. Every
committed case in `evals/spec-comprehension/stop-gate/` opens with:

```yaml
schema_version: "1.0"
name: <kebab-case-identifier>
```

Use `"1.0"` (string, quoted). The `name` value ends up in the run report; make it
short and self-describing.

---

## --ablation none for Skill graders

The default ablation mode is `with-without`: the runner adds a no-plugin baseline
arm and computes a score delta. Under that mode any grader carrying `tool_used:
Skill` is classified as a "with-only indicator" — **it is excluded from the score
entirely**. From `claude plugin eval --help`:

> under with-without, graders marked with-only, incl. `tool_used: Skill`, are a
> plugin-fired indicator rather than part of the score

When a case's graders include `tool_used: Skill`, always pass `--ablation none`:

```bash
CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval . --ablation none
```

Without this flag the score silently reads 0 for every such grader, making the
result look like comprehension failure when nothing ran.

---

## execution.system is overridden by the plugin injection

When eval runs inside the groundwork repo, the SessionStart hook injects the full
orchestrator CLAUDE.md into the agent's context. That injection replaces or
competes with whatever you put in `execution.system`, so an elaborate system
prompt in the case file does not reach the agent cleanly.

Working practice used in all committed cases: keep `execution.system` to a single
scoping directive, and put the material under test directly in `execution.prompt`:

```yaml
execution:
  system: "Answer the question using ONLY the spec content provided in the user message. Do not use outside knowledge or search the codebase."
  prompt: |
    The following is the complete spec content you must use...
    --- SPEC CONTENT ---
    <paste the requirement verbatim>
    --- END SPEC CONTENT ---

    QUESTION: <specific question citing the requirement id>
```

This pattern works because the agent receives both system and prompt; a short,
decisive system directive is hard to override. A long system prompt with
multi-step orchestrator instructions competes with the injection and loses.

The `CLAUDE_CODE_ENTRYPOINT` guard in `hooks/session-reminder.mjs` applies to
SDK-embedded agents (`sdk-py`/`sdk-js`), not to eval agents, so it does not
suppress the injection here.

---

## Where results land

```
evals/<suite>/results/<timestamp>/
```

`evals/*/results/` is gitignored (`.gitignore` line 32). Results are local only
unless `--publish-report` is also passed. A non-zero exit from `claude plugin
eval` does not necessarily mean the run is broken — exit 2 signals a cost-ceiling
abort; check the run output before concluding something failed.

---

## Cost discipline

Each case run bills real model calls. With 6 cases at 3 runs each (the default),
expect 20–40 minutes and meaningful cost. Tactics:

- Run the full suite **once**. Identify which cases are failing.
- Debug one case in isolation: `--case <name>` filters by the `name` field in
  `case.yaml`. Re-run only that case after editing.
- `--runs 1` for a quick smoke test; bump back to 3 for the final measurement
  (variance is real at n=1).
- `--judge-model haiku` is the default; do not override to opus unless a grader
  produces obviously wrong verdicts — haiku is sufficient for pass/fail criteria
  on spec comprehension cases.

```bash
# Targeted re-run of one case
CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval . --case absent-pacing-disabled --runs 1
```

---

## Authoring pitfall: low score may mean the grader and spec disagree

A score of 0.33 on a comprehension case does not automatically mean the model
failed to understand the spec. It may mean the grader criteria ask for something
the cited requirement does not actually say.

Real example: case-06 graded against `PACING-R-004` and asked the model to state
the `write_token` restriction. `PACING-R-004` records only `granted_by`; the
token rule lives in `PACING-R-008`. The model answered correctly from the spec it
was given and scored 0.33 because the grader expected something not present in
the pasted content.

**Before "fixing" the model or relaxing the threshold, check the source
requirement.** If the criteria and the requirement disagree, fix the criteria (or
paste the correct requirement). Never edit a case to be easier to pass — that
destroys the measurement. The grader is a test of the spec, not just of the
model.

Workflow when a case scores low:

1. Read the grader criteria.
2. Read the pasted spec content in `execution.prompt`.
3. Check: does the criteria ask for something present in the spec content? If not,
   find the correct requirement and update the case to paste that one.
4. Only after confirming the criteria match the pasted spec: investigate model
   comprehension or prompt wording.

---

## Recording a baseline

Use the journal to anchor a score so future runs are comparable:

```bash
bin/journal append \
  --motive <slug> \
  --type BASELINE \
  --msg "spec-comprehension suite: <suite>/<run-date>, N cases, avg score X.XX" \
  --data '{"suite": "<suite>", "cases": N, "avg_score": X.XX, "run_date": "YYYY-MM-DD"}'
```

A score is a delta only when a comparable prior `BASELINE` event exists for the
same suite and grader set. The first run produces an inaugural number, not a
delta — record it as such.

`BASELINE` is a valid event type (see `bin/journal help append`). The `--data`
payload is free-form JSON for this type; include enough fields that a future
comparison is unambiguous (suite path, case count, date, model used).

---

## Reference: committed suite layout

```
evals/
  spec-comprehension/
    stop-gate/
      case-01-pacing-budget/case.yaml
      case-02-gate-release/case.yaml
      ...
      case-06-autopilot-token/case.yaml
    results/           ← gitignored
```

Each `case.yaml` contains `schema_version`, `name`, `execution` (system +
prompt), and `graders` (list with `name`, `type: llm`, `criteria`). Read any
committed case as a template; they represent the shape the runner accepts.

Run the full suite from the repo root:

```bash
CLAUDE_CODE_WALNUT_SPIRE=1 claude plugin eval . --ablation none
```
