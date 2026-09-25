# house-rules

Code-quality rule engine for Claude Code. Developers guard codebase health against vibe-coded bloat by registering per-file and per-pattern rules that run as hooks.

## Install

Add the groundwork marketplace to Claude Code, then install the `house-rules` plugin:

```
/plugin marketplace add IniZio/groundwork
/plugin install house-rules@groundwork
```

Requires Claude Code v2.1.193 or later (plugin dependencies); older versions silently lose enforcement.

## Rules

| Rule | What it enforces | Guard (PreToolUse) | Gate (Stop/SubagentStop) | CLI | Autofix |
|---|---|---|---|---|---|
| comment-density | 5 net-new comment lines per 100 added lines; reword pairing encouraged | strips over-budget comments before Write/Edit/MultiEdit | blocks when session-changed file is over budget; auto-trims TypeScript | `house-rules check --base <ref>` | TypeScript: stable; other langs: shadow/preview |
| stray-artifacts | coexisting synonym dir pairs (doc+docs, test+tests, scripts+script, util+utils, lib+libs) and root scratch files (test-*.{js,mjs,ts}, *.bak, tmp*, scratch*) | DENY Write into either synonym dir when its sibling exists | blocks if session-created strays exist | `house-rules check --base <ref>` | none |

Per-rule READMEs are generated under `rules/<id>/`.

## CLI

```
house-rules check --base <ref>    # report violations introduced since <ref>; exits non-zero if any
house-rules baseline               # write .house-rules/baseline.json ratchet for current violations
house-rules housekeep              # deslop + rule-violation fixing (or: /house-rules:housekeep)
```

## Baseline

`.house-rules/baseline.json` records known violations at a point in time. `house-rules check` subtracts baseline entries so that violations at or below baseline are not errors. Run `house-rules baseline` to ratchet the baseline to current state. Use this to introduce enforcement to an existing codebase without blocking on pre-existing violations.

## Enforcement scope — comment-density

**comment-density guard** (PreToolUse Write/Edit/MultiEdit) — emits `updatedInput` + `additionalContext`; never emits `permissionDecision` (Claude Code runs its normal permission check on the rewritten input).

**comment-density gate** (Stop, SubagentStop) — emits `decision: "block"` + `reason`; or `continue: true`; auto-trims TypeScript before the block decision. 4-attempt bound: gate tracks consecutive blocks per session and agent in `os.tmpdir()/groundwork-comment-density/`. Attempts 1–3: block naming over-limit files. Attempt 4: allow with a stderr warning. A changed set of violating files resets the counter. SubagentStop and Stop have independent counters (keyed by agent_id vs "main").

**Supported languages**: TypeScript (ts, tsx), JavaScript (js, jsx), Python, Bash/Shell, YAML, Dockerfile, Go, Rust, SQL, Makefile, TOML. Files in other languages are not measured.

**No opt-out**: there is no environment variable or config knob to disable comment-density enforcement. The `CLAUDE_CODE_ENTRYPOINT=sdk-py/sdk-js` skip exists only to prevent nested-agent leakage.
