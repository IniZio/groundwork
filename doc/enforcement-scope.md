# Enforcement Scope — v2 Prose-Quality Guard

## What v2 keeps

Four rules in one advisory hook (never blocks):

- **negation-loss** — detects removal of `not/never/no/only/except` from a surviving sentence matched by word-overlap across the old→new diff. Prose and agent files only.
- **hedge-upgrade** — detects replacement of `may/could/sometimes/might/appears to/is likely to` with `will/does/always` in matched sentences. Prose and agent files only.
- **abbreviation** — detects introduction of banned shorthands (`cfg`, `fn`, `req`) or expansion of domain acronyms (`AC`, `TBD`, `TBR`, `impl`) in content stripped of code blocks.
- **slop** — detects AI-fingerprint comment openers (e.g. `// Let's`, `// Now we`, `// Step 1`) via a single regex on the new content lines. Applies to all write-tool targets, not just prose files.

## Deployed-path contract

Each hook is registered under exactly one Claude Code event. The event, output shape, and any bounds are:

| Hook | Event | Output shape |
|---|---|---|
| piped-exit-code-guard | PreToolUse (matcher: Bash) | `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason` |
| spawn-model-guard | PreToolUse | `permissionDecision: "deny"` or `"allow"` + optional `updatedInput` |
| store-write-guard | PreToolUse | `permissionDecision: "deny"` or empty stdout (allow-by-silence) |
| prose-quality-guard | PostToolUse | `hookSpecificOutput.hookEventName: "PostToolUse"` + `additionalContext` — no `permissionDecision` (advisory only) |
| stop-gate | Stop | `decision: "block"` + `reason`; or `continue: true` — no `hookSpecificOutput` |
| new-code-gate | Stop, SubagentStop | `decision: "block"` + `reason`; or `continue: true` — no `hookSpecificOutput` |
| comment-density-guard | PreToolUse | emits `updatedInput` + `additionalContext` — NEVER `permissionDecision`; Claude Code runs its normal permission check on the rewritten input (emitting `"allow"` would bypass that prompt) |
| comment-density-gate | Stop, SubagentStop | `decision: "block"` + `reason`; or `continue: true` — no `hookSpecificOutput` |

For PreToolUse and PostToolUse hooks, `hookSpecificOutput.hookEventName` must equal the registered event. Stop/SubagentStop hooks use only the top-level `decision` + `reason` shape and emit no `hookSpecificOutput`.

**stop-gate 4-attempt bound**: the gate tracks consecutive blocks in a sidecar file `.groundwork/stop-gate.<session_id>.count` alongside the work db. Attempt 1–2: normal block message naming `gw slice complete <id>` and `gw hold set`. Attempt 3: block with "externally unresolvable" reason. Attempt 4: allow with a stderr warning and counter reset. A HOLD event (with no later HOLD_CLEAR) causes an immediate allow and counter reset — a human hold is a legitimate stop.

**new-code-gate has no consecutive-block bound**: if new-code-gate keeps blocking (e.g. a rule violation cannot be fixed in the session), stop-gate's 4-attempt release does not bound the session — new-code-gate will continue to fire after stop-gate releases.

**comment-density-gate 4-attempt bound**: the gate tracks consecutive blocks per session and agent in `os.tmpdir()/groundwork-comment-density/`. Attempts 1–3: block naming the over-limit files. Attempt 4: allow with a stderr warning. A changed set of violating files resets the counter. SubagentStop and Stop have independent counters (keyed by agent_id vs "main").

## Deployed-path evidence

Any claim that a hook fires in a real session must be backed by a run through `scripts/proof-harness.sh`. The `--plugin-dir` flag silently drops plugins that declare `dependencies` and must not be used as evidence; see `doc/proof-harness.md` for the differential and the required install path.

## Deliberate scope cuts

**Comment-restate detection** — v1 prose-negation-guard included logic to flag new comments that merely restated adjacent code. Cut in v2. Rationale: required a separate read of the existing file's comment corpus and a cross-file similarity pass; v1 lines attributable to this: ~90 of 741 combined. Failure mode caught in v1: occasional; low signal-to-noise relative to the false-positive rate on doc comments. Reinstate if: comment restatement recurs as a measurable quality regression in agent prose output across multiple motives.

**Slop detection narrowed to AI-fingerprint openers** — v1 deslop-guard matched a broader set of patterns including filler phrases mid-sentence and certain adverb openers. v2 narrows to comment-line openers only (regex anchored at `//`). Rationale: mid-sentence slop detection produced false positives on legitimate technical prose; narrowing to openers catches the highest-density failure class at low false-positive cost. Reinstate broader patterns if: slop audit shows mid-sentence filler surviving the current guard at a rate that affects plan or agent output quality.

**No orchestrator write-guard hook** (Decision D-21) — There is no PreToolUse hook blocking Write/Edit calls by the orchestrator agent. Structural reason: `agents/orchestrator.md` declares `tools: [Agent, Skill, Read, Bash, AskUserQuestion]`; Write, Edit, and MultiEdit are absent from that list, so the shipped invocation path cannot produce an orchestrator write at any sample size. A hook would be redundant with the allowlist rather than defence in depth.

Corroborating measurement: a controlled eval (8 shipped-path runs, condition A) recorded 0 orchestrator-authored Write/Edit calls vs 1 of 8 in an unrestricted prose-only mode (condition B). The A-vs-B difference is not statistically significant (Fisher exact p ≈ 1.0) and is not the basis for this decision; the structural argument alone is sufficient. Evidence: `/home/newman/.local/share/groundwork/.groundwork/motives/groundwork-as-glue/evidence/v11/REPORT.md`.
