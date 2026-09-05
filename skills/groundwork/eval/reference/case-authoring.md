# Eval Case Authoring Reference

## Required case.yaml fields

The runner rejects a case file missing `schema_version` or `name`. Every committed case opens with:

```yaml
schema_version: "1.0"
name: <kebab-case-identifier>
```

Use `"1.0"` (string, quoted). The `name` value ends up in the run report; make it short and self-describing.

---

## execution.system is overridden by the plugin injection

When eval runs inside the groundwork repo, the SessionStart hook injects the full orchestrator CLAUDE.md into the agent's context. That injection competes with whatever is in `execution.system`, so an elaborate system prompt does not reach the agent cleanly.

Working practice for all committed cases: keep `execution.system` to a single scoping directive and put the material under test directly in `execution.prompt`:

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

A short, decisive system directive survives the injection; a long multi-step system prompt loses to it.

The `CLAUDE_CODE_ENTRYPOINT` guard in `hooks/session-reminder.mjs` applies only to SDK-embedded agents (`sdk-py`/`sdk-js`), not to eval agents, so it does not suppress the injection here.

---

## Committed suite layout

```
evals/
  spec-comprehension/
    stop-gate/
      case-01-pacing-budget/case.yaml
      case-02-gate-release/case.yaml
      case-03-complete-unblocked/case.yaml
      case-04-absent-pacing/case.yaml
      case-05-seal-residual/case.yaml
      case-06-autopilot-token/case.yaml
    results/           ← gitignored
```

Each `case.yaml` contains `schema_version`, `name`, `execution` (system + prompt), and `graders` (list with `name`, `type: llm`, `criteria`). Read any committed case as a template for the shape the runner accepts.
