# Enforcement Scope — Prose-Quality Guard

## What the guard keeps

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
For PreToolUse and PostToolUse hooks, `hookSpecificOutput.hookEventName` must equal the registered event. Stop/SubagentStop hooks use only the top-level `decision` + `reason` shape and emit no `hookSpecificOutput`.

**stop-gate 4-attempt bound**: the gate tracks consecutive blocks in a sidecar file `.groundwork/stop-gate.<session_id>.count` alongside the work db. Attempt 1–2: normal block message naming `gw slice complete <id>` and `gw hold set`. Attempt 3: block with "externally unresolvable" reason. Attempt 4: allow with a stderr warning and counter reset. A HOLD event (with no later HOLD_CLEAR) causes an immediate allow and counter reset — a human hold is a legitimate stop.

**new-code-gate has no consecutive-block bound**: if new-code-gate keeps blocking (e.g. a rule violation cannot be fixed in the session), stop-gate's 4-attempt release does not bound the session — new-code-gate will continue to fire after stop-gate releases.

Comment-density and document-placement enforcement is provided by the `house-rules` plugin dependency; see `plugins/house-rules/README.md`.

## Document placement

The `house-rules` `artifact-structure` rule (formerly `stray-artifacts`, still accepted as an alias) enforces where documents go from a doc-type manifest in `.house-rules.json`. `$GW recipe` prints the working-tier block, which places units under `.groundwork/work/<slug>/`. Without `types` or `forbidden` in the manifest, placement is not enforced and only the legacy synonym-directory and root-scratch checks run.

- **Edit time** (PreToolUse on Write, Edit and MultiEdit, for new files only): a path that matches a `forbidden` pattern, or a governed path that matches no type, is denied and the message names the correct location. A path that matches a type passes, because a fresh write is a draft.
- **Stop and SubagentStop**: path, frontmatter and heading checks run on new files, including files created through Bash.
- **Ignore semantics**: `forbidden` patterns and type-matched paths are enforced even when the file is git-ignored or excluded, at edit time and at Stop, including files created through Bash. The `.groundwork/` exclusion that `$GW init` writes to `.git/info/exclude` therefore does not exempt working-tier files. A governed path that matches no type is also enforced when it is ignored but lies under a typed area. A typed area is the literal prefix of a type's `generates` pattern up to the first `{`, cut at the last `/`, for example `.groundwork/work/`. An ignored governed path outside every typed area, such as build output like `dist/notes.md`, is exempt.
- **Commit messages**: commit-lint rejects motive slugs and a fixed list of process vocabulary ("gate cycle", "dogfood cleanup", "advisor APPROVE", slice ids such as T4, decision ids such as D-7) on any line of a commit message. It also rejects violations of the commit-message preset.
- **Session start**: the "Where docs go" table lists the doc types, from the manifest or, when none is configured, from groundwork's built-in registry marked as not enforced.

Layer 2 (hints injected when a skill loads) is not shipped: user-typed skills bypass PreToolUse, so a hook cannot cover them reliably.

## Deployed-path evidence

Any claim that a hook fires in a real session must be backed by a run through `scripts/proof-harness.sh`. The `--plugin-dir` flag silently drops plugins that declare `dependencies` and must not be used as evidence; see `doc/proof-harness.md` for the differential and the required install path.

## Deliberate scope cuts

**Comment-restate detection** — Not implemented. Rationale: requires a separate read of the existing file's comment corpus and a cross-file similarity pass; occasional failure mode, low signal-to-noise relative to the false-positive rate on doc comments. Reinstate if: comment restatement recurs as a measurable quality regression in agent prose output across multiple motives.

**Slop detection narrowed to AI-fingerprint openers** — The guard matches comment-line openers only (regex anchored at `//`). Rationale: mid-sentence slop detection produces false positives on legitimate technical prose; narrowing to openers catches the highest-density failure class at low false-positive cost. Reinstate broader patterns if: slop audit shows mid-sentence filler surviving the current guard at a rate that affects plan or agent output quality.

**No orchestrator write-guard hook** (Decision D-21) — There is no PreToolUse hook blocking Write/Edit calls by the orchestrator agent. Structural reason: `agents/orchestrator.md` declares `tools: [Agent, Skill, Read, Bash, AskUserQuestion]`; Write, Edit, and MultiEdit are absent from that list, so the shipped invocation path cannot produce an orchestrator write at any sample size. A hook would be redundant with the allowlist rather than defence in depth.

Corroborating measurement: a controlled eval (8 shipped-path runs, condition A) recorded 0 orchestrator-authored Write/Edit calls vs 1 of 8 in an unrestricted prose-only mode (condition B). The A-vs-B difference is not statistically significant (Fisher exact p ≈ 1.0) and is not the basis for this decision; the structural argument alone is sufficient.
