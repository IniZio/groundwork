# Spec Index

_Generated: 2026-09-15T15:02:24.779Z_

## Concepts

| Concept | Summary | Status | Views |
| --- | --- | --- | --- |
| C-AGENTS-SKILLS | Agent roster, skill registries, model assignments, and delegation topology enforced by groundwork hooks. | draft | — |
| C-ARTIFACT | The three groundwork artifact types—run ledger, session journal, and spec tree—are file-backed records that persist across sessions. | draft | — |
| C-ENFORCEMENT | Enforcement hooks mechanically bind CLAUDE.md prose rules as PreToolUse gates, blocking orchestrators and subagents from violating delegation constraints. | draft | — |
| C-GW-CLI | Sixteen gw ledger subcommands that read and mutate the legacy JSON run store; init is absent and requires bin/ledger directly. | draft | — |
| C-JOURNAL-MOTIVE | Journal CLI surface, motive on-disk layout, DECISION authoring contract, ticket durability, and MAP.md as the ambient human read path. | draft | — |
| C-MOTIVE-DAG | Typed node/edge DAG as canonical primary store for motive state, built by deterministic fold over an event-sourced journal mutation log. | draft | — |
| C-ORCHESTRATION | The orchestrator classifies and delegates all implementation to specialist subagents and never writes code or edits files itself. | active | — |
| C-SPEC-TOOLING | Invariants, CLI contracts, and coverage model for the spec tooling that enforces corpus integrity. | draft | — |
| C-TOKEN-ECONOMY | Groundwork defines prose-compression rules, per-surface intensity levels, and forbidden zones so that agent output stays terse without fabricating evidence or erasing meaning. | draft | — |
| C-TRACEABILITY | Links spec requirements to ledger slices and verification evidence; SpineAdapter isolates the data store. | draft | — |
| C-VERIFICATION | Non-trivial tasks require advisor validation — confirming real-world completeness — before the session ends. | draft | — |

## Agents and Skills

### [agents-skills-r-001 — Skill three-tree authority model](../agents-skills/requirements/agents-skills-r-001-skill-three-tree-authority-model.md#agents-skills-r-001)

The groundwork skill repository **shall** maintain three distinct skill trees with explicit authority relationships: `skills/groundwork/` is the hand-edited AUTHORITY source; `skills/` is a GENERATED mirror produced exclusively by `pnpm run generate:agents` and **shall not** be hand-edited; `.pi/skills/` is an INDEPENDENT Pi-overlay tree that is hand-edited and validated against declared authority sources by `pnpm run check:pi`.

### [agents-skills-r-002 — Agent source/generated tree separation](../agents-skills/requirements/agents-skills-r-002-agent-source-generated-tree-separation.md#agents-skills-r-002)

The groundwork agent repository **shall** maintain `agents-src/` as the hand-edited source for agent definitions and `agents/` as the generated output produced exclusively by `pnpm run generate:agents`; the `agents/` tree **shall not** be hand-edited.

### [agents-skills-r-003 — Model assignment via model-registry.json](../agents-skills/requirements/agents-skills-r-003-model-assignment-via-registry.md#agents-skills-r-003)

### [agents-skills-r-004 — Delegation topology enforcement](../agents-skills/requirements/agents-skills-r-004-delegation-topology-enforcement.md#agents-skills-r-004)

### [agents-skills-r-005 — Enforcement boundary — mechanical vs discipline-only](../agents-skills/requirements/agents-skills-r-005-enforcement-boundary.md#agents-skills-r-005)

Documentation of groundwork delegation rules **shall** accurately distinguish between rules that are mechanically enforced by hooks and rules that rely solely on agent discipline: (a) the prohibition on a `junior-orchestrator` relaying its task 1:1 to a single child without decomposition is **not** mechanically enforced — `nesting-guard` cannot observe whether substantive orchestration work occurred before the spawn, and has no access to caller turn-history, spawn count, or `parent_agent_id`/`nesting_depth`; (b) spawn depth beyond the declared maximum is **not** mechanically enforceable — a `PreToolUse` hook has no access to nesting depth or parent agent identity at dispatch time; (c) only the flat type-allowlist topology rules (see [[requirements/agents-skills-r-004-delegation-topology-enforcement|R-004]]) are mechanically enforced. No requirement **shall** assert a mechanical guarantee for a discipline-only rule.

### [agents-skills-r-006 — Generated agent tree consistency](../agents-skills/requirements/agents-skills-r-006-generated-agent-tree-consistency.md#agents-skills-r-006)

The `pnpm run check:agents` script **shall** exit 0 on every working tree where `agents/` is in sync with `agents-src/` and `model-registry.json`, and **shall** exit non-zero and report specific stale, missing, or extraneous files when any drift is detected. The `pnpm run check` aggregate **shall** include `check:agents` as a required gate.

### [agents-skills-r-007 — Pi skills drift detection](../agents-skills/requirements/agents-skills-r-007-pi-skills-drift-detection.md#agents-skills-r-007)

### [agents-skills-r-008 — Built-in agent shadow prevention](../agents-skills/requirements/agents-skills-r-008-built-in-agent-shadow-prevention.md#agents-skills-r-008)

## Artifact Model

### [artifact-r-001 — Ledger records slice completion](../artifact/requirements/artifact-r-001-ledger-records-slice-completion.md#artifact-r-001)

When a vertical slice is marked complete via the ledger CLI, `hooks/ledger.mjs` **shall** persist the slice id, completion timestamp, and session id to `.groundwork/runs/<session_id>.json`.

### [artifact-r-003 — Stop hook incomplete-slice guard](../artifact/requirements/artifact-r-003-stop-hook-incomplete-slice-guard.md#artifact-r-003)

If the Stop hook fires and the active run ledger contains any slice not marked complete, then the Stop hook **shall** block session end and emit a message citing the id of each incomplete slice.

### [artifact-r-004 — Journal DECISION events require structured data fields](../artifact/requirements/artifact-r-004-journal-decision-events-require-structured-data-fields.md#artifact-r-004)

When `journal append --type DECISION` is invoked, `hooks/journal.mjs` **shall** require `data.id`, `data.decision`, and `data.rationale` to be present in the `--data` JSON payload, default `data.alternatives` to `[]` when absent, and exit with code 2 naming the missing key when any required field is absent.

### [artifact-r-005 — Motive archive moves directory and refuses open items without --force](../artifact/requirements/artifact-r-005-motive-archive-moves-directory-and-refuses-open-items.md#artifact-r-005)

When `journal motive archive <slug>` is invoked, `hooks/journal.mjs` **shall** move `.groundwork/motives/<slug>/` to `.groundwork/archive/motives/<slug>/`, append a `MILESTONE` event recording the archive destination path, and exit non-zero without moving the directory if the charter contains open TBD or TBR items unless `--force` is supplied.

### [artifact-r-007 — Ticket is the durable work object](../artifact/requirements/artifact-r-007-ticket-is-the-durable-work-object.md#artifact-r-007)

A groundwork ticket **shall** be a markdown document with the following required top-level sections in this order: Question, Context, Evidence, Decision, Ruled out, Revisions, Links. Each section **shall** be rendered as an H2 heading with an empty body when the ticket is first created, leaving the body for the author to fill. The run-ledger `Slice` schema **shall** accept an optional `ticket` field (string) naming the ticket id that this slice delivers against.

### [artifact-r-008 — No-delete invariant for markdown files](../artifact/requirements/artifact-r-008-no-delete-invariant-for-markdown-files.md#artifact-r-008)

No groundwork code path **shall** remove a markdown file that it did not itself generate. A file is considered generated if and only if it was written by groundwork in the current process and carries the footer line `_Auto-generated — do not edit by hand._`. Any sweep, cleanup, or regeneration routine that iterates a directory of `.md` files **shall** skip files that lack this footer.

### [artifact-r-009 — Ticket location resolution](../artifact/requirements/artifact-r-009-ticket-location-resolution.md#artifact-r-009)

When resolving the directory in which to create or read ticket files for a motive, groundwork **shall** use the following resolution order: (1) if the motive charter contains a `tickets_dir` field, use that path; (2) otherwise default to `.groundwork/motives/<slug>/tickets/`. The resolved directory **shall** be created if absent. An empty or missing ticket corpus **shall** not cause any error in `ledger`, `journal`, or MAP.md regeneration.

### [artifact-r-010 — Slice decisions field links slices to journal decision events](../artifact/requirements/artifact-r-010-slice-decisions-field-links-slices-to-journal-decision-events.md#artifact-r-010)

A run-ledger `Slice` may carry a `decisions` field containing a single decision id (string) or an ordered list of decision ids (string[]). When the compile step produces a decision log, it **shall** enumerate every decision id cited by any slice and, for each id, list the ids of all slices that cite it.

### [artifact-r-011 — DECISION `revises` field merges same-id events; `unmarked_collision` flags unintended duplicates](../artifact/requirements/artifact-r-011-decision-revises-field-merges-same-id-events.md#artifact-r-011)

When `journal compile` processes a motive's DECISION events, `hooks/lib/motive-compile.mjs` **shall** merge all events sharing the same `data.id` into a single compiled entry retaining the earliest `ts`; if at least one contributing event carries a `data.revises` field equal to the entry's own `data.id` the merged entry **shall** not receive `unmarked_collision`; if no contributing event carries `data.revises` equal to the entry's own `data.id` the merged entry **shall** carry `unmarked_collision: true`. A `data.revises` field naming the entry's own id on an individual DECISION event marks the author's intent that this append is an intentional same-id refinement and **shall** suppress the motive-scoped stderr collision warning emitted by `journal append`. A `data.supersedes` field is a distinct operation targeting a different `data.id`: both the superseding and the superseded entries **shall** appear as separate rows in the compiled output; the superseded entry's `status` **shall** be set to `'superseded'` and its `superseded_by` **shall** be set to the superseding id.

### [artifact-r-012 — Ticket filename follows NN-type-slug convention; type is a closed enum](../artifact/requirements/artifact-r-012-ticket-filename-follows-nn-type-slug-convention.md#artifact-r-012)

When a ticket file is created, its filename **shall** follow the pattern `<NN>-<type>-<slug>.md`, where `<NN>` is a zero-padded two-digit ordinal unique within the motive's ticket corpus, `<type>` is one of the eight valid values (`research`, `choose`, `model`, `build`, `grill`, `spec`, `fix`, `chore`), and `<slug>` is a kebab-case description. The `Type:` metadata field in the ticket document **shall** match the filename type segment. The `type` field is a closed enum; any value outside the eight valid values **shall** be rejected.

## Enforcement Hooks

### [checkpoint-r-001 — `gate.phases` records per-phase verification state keyed by phase name](../enforcement/requirements/checkpoint-r-001-gate-phases-per-phase-verification-state.md#checkpoint-r-001)

A run ledger **shall** carry `gate.phases` as a map from phase name to a phase-checkpoint object. Each entry **shall** include: `deliverable` (string reference), `tier` (`BLOCKS` or `AUTO_ADVANCES`), `verdict` (`APPROVE` or `REJECT`), `verified_by` (identity string), and `verified_at` (ISO-8601 timestamp). The top-level `checkpoint_hold` field **shall** name the phase currently blocking session end, or be absent when no phase is blocking.

### [checkpoint-r-002 — `gw ledger checkpoint` records phase verdict and is token-gated; token-less invocations rejected](../enforcement/requirements/checkpoint-r-002-checkpoint-command-token-gated.md#checkpoint-r-002)

When `ledger checkpoint --phase <phase> --verdict APPROVE|REJECT --verified-by <name> --token <write_token>` is invoked, the ledger CLI **shall** write the phase entry into `gate.phases`, re-seal the ledger, and exit 0. When `--token` is absent or the token does not match, the CLI **shall** exit 1 with a message naming the missing authority. The command **shall** behave identically in `hooks/ledger.mjs` and `src/gw/cli/commands/ledger.ts`.

### [checkpoint-r-003 — HMAC seal folds `gate.phases` and `checkpoint_hold`; tampered verdicts invalidate the seal](../enforcement/requirements/checkpoint-r-003-hmac-seal-covers-gate-phases.md#checkpoint-r-003)

The canonical HMAC state string computed by `hooks/lib/gate-seal.mjs` **shall** include `gate.phases` and `checkpoint_hold` alongside the existing fields (`gate.advisor`, `awaiting_human`, `pacing.milestone_signoff`). A phase verdict written directly to the ledger file without the write token **shall** produce a seal mismatch at the next seal-check, causing the stop-gate to block fail-closed.

### [checkpoint-r-004 — Stop-gate blocks session end when `checkpoint_hold` names a BLOCKS-tier phase without APPROVE](../enforcement/requirements/checkpoint-r-004-stop-gate-blocks-on-blocking-tier-phase.md#checkpoint-r-004)

When the Stop hook fires and the active ledger carries `checkpoint_hold`, the Stop hook **shall** re-derive the phase tier at gate-read time from the phase key: a key matching `/^wave-\d+$/` yields `AUTO_ADVANCES`; every other key yields `BLOCKS`. The stop-gate **shall not** read the stored `tier` field from `gate.phases` to make this determination — the stored field is an audit artifact only. When the derived tier is `BLOCKS` and no `verdict: "APPROVE"` is present in the phase entry, the Stop hook **shall** exit 1 and emit a message naming the outstanding phase and its declared deliverable. This closes the bypass where an orchestrator holding the write token could record `tier: "AUTO_ADVANCES"` for a non-wave-N phase to release a gate without a matching APPROVE verdict.

### [checkpoint-r-005 — Stop-gate blocks fail-closed when seal is invalid or seal key is missing](../enforcement/requirements/checkpoint-r-005-stop-gate-fail-closed-invalid-seal.md#checkpoint-r-005)

When `checkpoint_hold` is set and the HMAC seal does not verify (tampered ledger or missing key), the Stop hook **shall** block session end (exit 1) regardless of the phase verdicts in `gate.phases`. The stop-gate **shall** never release based on unverified state.

### [checkpoint-r-006 — `AUTO_ADVANCES`-tier phase transition permits session end and emits a directive naming incomplete slices](../enforcement/requirements/checkpoint-r-006-auto-advances-tier-releases-with-directive.md#checkpoint-r-006)

When `checkpoint_hold` names a phase whose key matches `/^wave-\d+$/` (the stop-gate derives `AUTO_ADVANCES` from the key, not from the stored `tier` field — see CHECKPOINT-R-004), the Stop hook **shall** allow the session to end (exit 0) and **shall** emit a directive (not an advisory) naming: the recorded deliverable reference and the exact ids of all incomplete slices in the ledger. The phase is automatically advanced without requiring a human to issue `ledger checkpoint`.

### [checkpoint-r-007 — `gw ledger autopilot` returns a usage error naming `ledger checkpoint` as its replacement](../enforcement/requirements/checkpoint-r-007-autopilot-retired-usage-error.md#checkpoint-r-007)

When `ledger autopilot` is invoked with any arguments, both CLI implementations **shall** exit 2 with a message stating that `autopilot` is retired and naming `ledger checkpoint` as the replacement command. The exit code **shall** be 2 (usage error), not 1 (operational failure) and not the unknown-subcommand error path.

### [checkpoint-r-008 — Absent `gate.phases` disables checkpoint enforcement; all commands and stop-gate pass through without error](../enforcement/requirements/checkpoint-r-008-absent-gate-phases-no-enforcement.md#checkpoint-r-008)

When a run ledger carries no `gate.phases` field and no `checkpoint_hold`, every `ledger` subcommand and the Stop hook **shall** pass through without checkpoint-related errors or blocks. No checkpoint enforcement is applied to pre-existing ledgers that were created before this feature was introduced.

### [checkpoint-r-009 — `pacing.milestone_signoff` is migrated on read into `gate.phases.completion` by `ledger checkpoint`](../enforcement/requirements/checkpoint-r-009-milestone-signoff-migrate-on-read.md#checkpoint-r-009)

When `ledger checkpoint` is invoked on a ledger that carries `pacing.milestone_signoff` but no `gate.phases.completion`, the command **shall** copy the milestone sign-off into `gate.phases.completion` (with `tier: "BLOCKS"`, `deliverable: "milestone"`, and the sign-off's `verdict`, `verified_by`, and `verified_at`) before writing the requested checkpoint. In-flight ledgers sealed before `gate.phases` existed **shall** still verify against their existing seal without re-sealing.

### [checkpoint-r-010 — `checkpoint` present in `MUTATING_LEDGER_CMD_RE` and `autopilot` absent; subagents cannot set phase verdicts via Bash](../enforcement/requirements/checkpoint-r-010-ledger-bash-guard-checkpoint-present-autopilot-absent.md#checkpoint-r-010)

The `MUTATING_LEDGER_CMD_RE` pattern in `src/gw/hook/ledger-bash-guard.ts` **shall** include `checkpoint` and **shall** not include `autopilot`. A subagent Bash invocation of `ledger checkpoint ...` **shall** be blocked by the ledger-bash-guard hook. A subagent Bash invocation of `ledger autopilot ...` **shall** pass through the guard (because `autopilot` now only emits a usage error and cannot mutate the ledger).

### [enforcement-r-001 — Impl-guard warns on orchestrator direct edits outside permitted paths (advisory)](../enforcement/requirements/enforcement-r-001-impl-guard-blocks-orchestrator-direct-edits.md#enforcement-r-001)

If an Edit or Write call is received from the orchestrator identity on a path that is not a permitted memory file, then the enforcement hook **shall** emit an advisory warning via `additionalContext` and allow the edit to proceed (exit 0, no `permissionDecision`). The orchestrator delegation obligation remains a MUST; the hook enforces it through a visible reminder, not a hard block.

### [enforcement-r-002 — Nesting-guard enforces agent spawn topology via type allowlist](../enforcement/requirements/enforcement-r-002-nesting-guard-spawn-topology.md#enforcement-r-002)

If an Agent, Task, or TaskCreate call is received from a caller identified as a subagent (via non-empty `agent_type`, `agent_id`, or an `agent-`-prefixed `transcript_path`) and the target `subagent_type` is `junior-orchestrator`, then the enforcement hook **shall** deny it; if the caller is identified as a `junior-orchestrator` subagent and the target is not in the set `{general-purpose, explore, advisor, designer, test-engineer, qa}`, then the enforcement hook **shall** deny it; if any other subagent targets `general-purpose`, `orchestrator`, or `debugger`, then the enforcement hook **shall** deny it.

### [enforcement-r-003 — Agent-model-guard injects registry-mapped model tier when model is absent](../enforcement/requirements/enforcement-r-003-agent-model-guard-model-injection.md#enforcement-r-003)

When an Agent, Task, or TaskCreate call carries no explicit `model` field (or an empty one), the enforcement hook **shall** inject the `model` tier recorded for the target `subagent_type` in `model-registry.json`; when the target maps to no registry entry or the registry cannot be loaded, the hook **shall** inject the default tier (`sonnet`) to prevent inheritance of the expensive session model; when an explicit non-empty `model` is already present, the hook **shall** pass through without modification.

### [enforcement-r-004 — Ledger-guard blocks direct tool access to run-ledger and seal-key files](../enforcement/requirements/enforcement-r-004-ledger-guard-direct-file-access.md#enforcement-r-004)

If a Read, Edit, or MultiEdit call targets a path matching the run-ledger pattern (`.groundwork/run.json` or `.groundwork/runs/<id>.json`) or the seal-key pattern (`.groundwork/runs/<id>.seal.key`), then the enforcement hook **shall** deny it for all callers; if a Write call targets the run-ledger path and the caller is identified as a subagent, then the enforcement hook **shall** deny it; Write calls to the run-ledger from the primary orchestrator (not identified as a subagent) **shall** pass through to support the one-shot `ledger init` workflow.

### [enforcement-r-005 — Ledger-bash-guard blocks subagent bash manipulation of ledger and seal key](../enforcement/requirements/enforcement-r-005-ledger-bash-guard-bash-manipulation.md#enforcement-r-005)

If a Bash command from a subagent contains filesystem mutation patterns targeting the run-ledger or seal-key path (shell redirect, `tee`, `sed -i`, `mv`, `cp`, `rm`, `chmod`, or `jq` redirect), then the enforcement hook **shall** deny it; if a Bash command from a subagent contains seal-key exfiltration patterns (`cat`, `head`, `tail`, `xxd`, or `od` on a `.seal.key` path), then the enforcement hook **shall** deny it; if a Bash command from a subagent invokes a mutating ledger CLI subcommand (`init`, `set`, `complete`, `gate`, `abandon`, `autopilot`, `rm`, `scope-token`) without a `sct_`-prefixed scoped token, then the enforcement hook **shall** deny it; read-only CLI subcommands (`status`, `view`, `show`, `help`) **shall** pass through.

### [enforcement-r-006 — Piped-exit-code-guard blocks reading $? after piping through a filter](../enforcement/requirements/enforcement-r-006-piped-exit-code-guard-pipe-status.md#enforcement-r-006)

If a Bash command reads `$?` after piping the output of a preceding command through a filter (`head`, `tail`, `grep`, `sort`, `uniq`, `wc`, `cut`, `awk`, or `sed`), then the enforcement hook **shall** deny the command and advise the caller to use `${PIPESTATUS[0]}` or to restructure the command to avoid the pipe.

### [enforcement-r-007 — Stop-gate blocks session end when run is incomplete or gate is unsealed](../enforcement/requirements/enforcement-r-007-stop-gate-session-end-enforcement.md#enforcement-r-007)

If the Stop event fires and an active run ledger (`active:true`) exists with incomplete slices or with `gate.advisor` not equal to `APPROVE`, then the enforcement hook **shall** block session end and emit the outstanding slice list, the current gate state, and completion instructions; if all slices are complete and `gate.advisor` equals `APPROVE`, then the hook **shall** verify the ledger seal before releasing — if seal verification fails, it **shall** block with a seal-invalid message instructing the caller to re-run `bin/ledger gate advisor APPROVE`; the hook is read-only with respect to the ledger and **shall not** write ledger state directly.

### [enforcement-r-008 — Struggle-detector emits FAILURE journal event on consecutive tool failures](../enforcement/requirements/enforcement-r-008-struggle-detector-failure-signal.md#enforcement-r-008)

If consecutive PostToolUse events for the same tool type and file fingerprint (tool + file_path) accumulate at or above the configurable threshold (default: 3, overridable via `GROUNDWORK_STRUGGLE_THRESHOLD`), then the enforcement hook **shall** emit a `FAILURE` journal event recording the kind, fingerprint, and detail; subsequent failures for the same fingerprint within the same session **shall** not re-emit a duplicate signal (deduplication by fingerprint key).

### [enforcement-r-009 — Deslop-guard emits advisory on AI-fingerprint comment patterns](../enforcement/requirements/enforcement-r-009-deslop-guard-advisory.md#enforcement-r-009)

If an Edit, Write, or MultiEdit call contains AI-fingerprint comment patterns (restating comments, AI-opener phrases such as `// Let's`, step-marker comments such as `// Step 1`, commented-out code blocks, or AI emoji inside comments), then the enforcement hook **shall** emit an advisory allow response naming the detected patterns in `permissionDecisionReason`; the hook **shall not** deny the write under any circumstances.

### [enforcement-r-010 — Prose-negation-guard warns when negation words are removed from surviving sentences](../enforcement/requirements/enforcement-r-010-prose-negation-guard-advisory.md#enforcement-r-010)

If an Edit, Write, or MultiEdit call would remove the words `not`, `never`, `no`, `only`, or `except` from a sentence that survives the edit (≥40% vocabulary overlap between old and new sentence), then the enforcement hook **shall** emit an advisory allow response identifying the affected sentence and the removed negation word; the hook **shall not** deny the write; wholesale rewrites where vocabulary overlap falls below 40% **shall** pass through without advisory.

### [enforcement-r-011 — Prose-modality-guard warns when modal hedges are upgraded to strong assertions](../enforcement/requirements/enforcement-r-011-prose-modality-guard-advisory.md#enforcement-r-011)

If an Edit, Write, or MultiEdit call would replace a modal hedge (`may`, `could`, `sometimes`, `might`, `appears to`, `is likely to`) with a strong assertion (`will`, `does`, `always`, `is`) in a sentence that survives the edit (≥40% vocabulary overlap), then the enforcement hook **shall** emit an advisory allow response identifying the sentence and the hedge-to-assertion substitution; the hook **shall not** deny the write; wholesale rewrites where vocabulary overlap falls below 40% **shall** pass through without advisory.

### [enforcement-r-012 — Doc-read-guard enforces toc-first access for over-budget doc-class files](../enforcement/requirements/enforcement-r-012-doc-read-guard-progressive-disclosure.md#enforcement-r-012)

If a Read tool call targets a doc-class file that exceeds its class token budget and no `doc toc` command has been issued for that path this session, then the enforcement hook **shall** deny it and instruct the caller to run `doc toc <path>` first; if a Bash tool call would `cat` or `head` a doc-class file over budget without a prior toc record for that session, then the enforcement hook **shall** deny it and instruct the caller to run `doc show <path>`; Grep calls **shall** always pass through; the hook **shall** record a toc as issued when it observes a Bash command matching the `doc toc <path>` pattern, enabling subsequent Read calls to pass through for that session.

### [enforcement-r-013 — Doc-size-guard emits advisory when doc-class file exceeds budget without structure](../enforcement/requirements/enforcement-r-013-doc-size-guard-over-budget-advisory.md#enforcement-r-013)

If a Write, Edit, or MultiEdit results in a doc-class file that exceeds its class token budget AND is missing a summary header or section anchors, then the enforcement hook **shall** emit a violation message to stdout naming the path, class, measured tokens, budget, and the missing structural element; the hook **shall not** block the write (PostToolUse hooks cannot deny tool calls).

### [enforcement-r-014 — Spec-guard warns and permits spec writes when no active ledger exists](../enforcement/requirements/enforcement-r-014-spec-guard-warn-on-no-ledger.md#enforcement-r-014)

If an Edit, Write, or MultiEdit targets a path under `doc/specs/` or `docs/steering/` and no active run ledger is found for the current session, then the enforcement hook **shall** emit a WARN to stderr and permit the write (exit 0); when an active ledger is found, the hook **shall** pass through without modification.

Note: the RFC gate that would have blocked spec writes outside a tracked slice was removed in S6. The hook registration is retained as a stub for future re-enable. The current implemented behavior is warn-on-no-ledger only; writes with a ledger present are unconditional passthroughs. New requirements covering a re-enabled gate **shall** supersede this requirement.

### [enforcement-r-015 — Keyword-router injects deterministic routing hints for user prompts](../enforcement/requirements/enforcement-r-015-keyword-router-hint-injection.md#enforcement-r-015)

If a UserPromptSubmit payload is authored by the human (not identified as a harness-injected turn), and the prompt text matches one or more registered routing patterns, then the enforcement hook **shall** inject a `[GROUNDWORK ROUTING]` system-reminder naming the matched agent type and routing instruction; if the prompt is identified as a non-user harness turn (beginning with `[SYSTEM NOTIFICATION`, `<task-notification>`, `<local-command-stdout>`, or `<context_window_compaction>`), then the hook **shall** suppress all routing hints and return an unmodified passthrough.

### [enforcement-r-016 — Session-reminder injects ledger state and orchestrator rules at session start](../enforcement/requirements/enforcement-r-016-session-reminder-context-injection.md#enforcement-r-016)

If a SessionStart event fires (triggered by `startup`, `resume`, `clear`, or `compact`) and an active run ledger exists for the session, then the enforcement hook **shall** inject a structured context block into the session naming the outstanding slices, the stop-gate rules, the write token, and the fan-out constraints; if no active run ledger exists, the hook **shall** inject a minimal context block with session-level orientation only.

### [enforcement-r-017 — gw-hook shim requires bun, resolves it beyond PATH, and reports its absence legibly](../enforcement/requirements/enforcement-r-017-gw-hook-shim-requires-bun.md#enforcement-r-017)

The `bin/gw-hook` shim **shall** resolve a bun executable in this order: `$GW_BUN` when set and executable, then `bun` on PATH, then the well-known locations `~/.bun/bin/bun`, `~/.local/share/mise/shims/bun`, `~/.local/share/mise/installs/bun/latest/bin/bun`, `~/.local/bin/bun`, `/usr/local/bin/bun`, `/opt/homebrew/bin/bun`. Having resolved one, the shim **shall** exec that bun against `dist/gw.mjs` when the bundle is present and against `src/gw/cli/main.ts` otherwise. If no bun is resolved, the shim **shall not** invoke node; it **shall** exit non-zero, emit nothing on stdout, and emit a stderr diagnostic that names bun, lists the searched locations, states the `$GW_BUN` override, and states that node cannot substitute.

Note: node is not a usable runtime for the gw source. `node --experimental-strip-types` does not remap the NodeNext `.js` import specifiers in `src/gw/**` to `.ts`, and `dist/gw.mjs` is a `--target=bun` bundle that node cannot execute. A node route would therefore always crash; it previously surfaced as a raw `ERR_MODULE_NOT_FOUND` resolver stack naming `src/gw/cli/router.js`, which named neither bun nor the operator's actual problem. The 8 hooks that route through `bin/gw-hook` (agent-model-guard, nesting-guard, ledger-guard, ledger-bash-guard, piped-exit-code-guard, orchestrator-impl-guard, struggle-detector, stop-gate) are bun-dependent. Operators **shall** ensure bun is installed before deploying the plugin.

### [enforcement-r-018 — Commit-message gate enforces conventional format and strips attribution trailers](../enforcement/requirements/enforcement-r-018-commit-message-gate.md#enforcement-r-018)

Every commit message **shall** conform to `type(scope): subject` where `type` is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`; the subject line **shall** not exceed 72 characters; and the commit message body **shall** be empty — only the subject line is permitted. Attribution trailers (`Co-Authored-By:` lines naming Claude or Anthropic, `Claude-Session:` lines, and `Generated with Claude Code` lines) **shall** be stripped mechanically by the `commit-msg` hook without being reported to the author as violations. Groundwork process vocabulary (gate-cycle phrasing such as "gate cycle", "dogfood", slice ids, motive slugs, and decision ids) **shall** be rejected — not stripped — and the offending lines **shall** be named in the error output. The `gw ledger gate <slug> advisor APPROVE` command **shall** be refused while the run's commit range contains unresolved violations. Setting `GROUNDWORK_COMMIT_LINT=0` **shall** disable all enforcement.

Three enforcement surfaces share one rule source (`hooks/lib/commit-convention.mjs`):
1. The `commit-msg` git hook (`hooks/commit-msg`) — strips attribution trailers then rejects remaining violations.
2. The `commit-message-guard` PreToolUse Bash hook (`src/gw/hook/commit-message-guard.ts`) — denies Bash tool calls that would produce a non-conforming commit message; strips and rejects using the same rule source; does not execute rewrites.
3. The `gw commit-lint` CLI (`src/gw/cli/commands/commit-lint.ts`) with subcommands `report` (lists violations over a commit range) and `remediate-plan` (proposes an interactive-rebase plan but **shall not** execute a history rewrite itself).

### [enforcement-r-019 — Portable commit-msg hook auto-installs into host repo on SessionStart](../enforcement/requirements/enforcement-r-019-portable-commit-msg-auto-install.md#enforcement-r-019)

On every SessionStart, groundwork **shall** automatically install a `commit-msg` git hook into `.git/hooks/commit-msg` of the host project (resolved from `CLAUDE_PROJECT_DIR`, falling back to the process working directory). The installed hook **shall** enforce the CONCATENATED ruleset defined by ENFORCEMENT-R-020, according to two cases. (1) When the host repo has a `.gitmessage`, that template states the project's own convention and groundwork adds only its universal rules on top — attribution trailers stripped, process vocabulary rejected, and no commit body (`BODY_MAX_LINES = 0`); no subject format, enumeration, or length rule is imposed. (2) When the host repo has no `.gitmessage`, there is nothing to concatenate and groundwork's own convention applies in full, including subject shape and the 72-character cap. Neither case consults commit history, and neither source can switch a rule off, so there is no state in which a stated rule is silently inactive. The install logic **shall** be idempotent: if a groundwork-versioned hook already exists and is current, no write occurs. A foreign `commit-msg` file (one that does not carry a groundwork version header) **shall** never be overwritten; in that case the installer **shall** log a skip notice and leave the existing file intact. Repos where `core.hooksPath` is already set **shall** be skipped silently — they already have an active hooks mechanism and a `.git/hooks/` install would be shadowed. Setting `GROUNDWORK_COMMIT_MSG_HOOK=0` **shall** suppress both auto-install on SessionStart and enforcement by the installed hook at commit time.

The auto-install is implemented across these source files:

1. `src/gw/hook/session-commit-msg-installer.ts` — SessionStart hook entry point; resolves the host repo, checks preconditions (foreign hook, `core.hooksPath`, kill-switch), and delegates to the installer.
2. `src/gw/hooks/installer.ts` — portable install logic; writes the hook file, sets the executable bit, and stamps the groundwork version header used for idempotency checks and foreign-hook detection.
3. `hooks/lib/commit-msg-template.mjs` — the hook script template embedded into the installed file; calls back into groundwork's rule engine and derive-convention module so enforcement logic is never duplicated.
4. `hooks/lib/groundwork-resolver.mjs` — resolves groundwork's install root portably: tries `CLAUDE_PLUGIN_ROOT` first, then walks up from `__dirname` until `plugin.json` is found.

Manual control is available via `gw hooks install`, `gw hooks uninstall`, and `gw hooks status`.

### [enforcement-r-020 — Commit convention is concatenated from the project template and groundwork's universal rules, never derived](../enforcement/requirements/enforcement-r-020-commit-convention-deriver-self-validation.md#enforcement-r-020)

When groundwork enforces commit messages in a host repository, it **shall** CONCATENATE two sources rather than infer rules from either. The repository's `.gitmessage` supplies the project's own convention, carried verbatim as text for a human or agent to read and follow. Groundwork's universal rules apply on top and are machine-enforced. Groundwork **shall not** derive a subject grammar, an enumeration, or a length cap from the template, and **shall not** consult commit history to decide whether a rule applies. Concatenation is implemented in `hooks/lib/commit-convention.mjs` (`resolveHostRules`, `readCommitTemplate`, `activeConvention`).

### [pacing-r-001 — Wave-default pace policy initialised at ledger init; absent pacing disables enforcement](../enforcement/requirements/pacing-r-001-wave-default-pace-policy.md#pacing-r-001)

> **Withdrawn** (motive `phase-checkpoint-gate`): The wave-pacing throttle described by PACING-R-001..R-006 was removed. No shipped code reads `pacing.policy`, `pacing.budget`, `pacing.exempt_kinds`, or `pacing.grant`. The per-phase checkpoint gate (CHECKPOINT-R-*) replaces this mechanism. Preserved for historical reference.

When `ledger init` creates a new run and no `pacing` object is supplied, the ledger **shall** stamp `pacing` as `{policy:"wave", budget:1, exempt_kinds:["plan","diagnose","design","fog"]}`. When a run ledger carries no `pacing` field, the pacing module **shall** treat pacing as disabled and impose no start-time restrictions on any slice.

### [pacing-r-002 — Start-time hard block with exact-reason messaging](../enforcement/requirements/pacing-r-002-start-time-hard-block-with-exact-reason-messaging.md#pacing-r-002)

> **Withdrawn** (motive `phase-checkpoint-gate`): The wave-pacing throttle described by PACING-R-001..R-006 was removed. No shipped code reads `pacing.policy`, `pacing.budget`, `pacing.exempt_kinds`, or `pacing.grant`. Preserved for historical reference.

If `ledger claim` or `ledger set --status in_progress` is invoked for a slice that belongs to a new unit (a unit other than the lowest-numbered unit holding any non-exempt `in_progress` slice) and `resolved_units >= budget + grant.range`, then the ledger CLI **shall** exit 1 and emit a block message that states all three of: which budget was consumed, which unit was refused, and the two available remedies (`ledger autopilot --range N` or handoff to a new session).

### [pacing-r-003 — `ledger complete` is never blocked by pacing](../enforcement/requirements/pacing-r-003-ledger-complete-never-blocked-by-pacing.md#pacing-r-003)

> **Withdrawn** (motive `phase-checkpoint-gate`): The wave-pacing throttle described by PACING-R-001..R-006 was removed. Preserved for historical reference.

When `ledger complete` is invoked for any slice, the ledger CLI **shall** record the completion without restriction, regardless of pacing state or budget exhaustion.

### [pacing-r-004 — Autopilot grant is token-gated, recorded in the ledger, and run-scoped](../enforcement/requirements/pacing-r-004-autopilot-grant-token-gated-recorded-run-scoped.md#pacing-r-004)

> **Withdrawn** (motive `phase-checkpoint-gate`): The wave-pacing throttle described by PACING-R-001..R-006 was removed. `ledger autopilot` now returns a usage error naming `ledger checkpoint` as its replacement (see CHECKPOINT-R-007). Preserved for historical reference.

When `ledger autopilot --range N` is invoked, the ledger CLI **shall** write `pacing.grant = {range: N, granted_at: <ISO-8601 timestamp>, granted_by: <session-id, falling back to "orchestrator">, reason: <reason string>}` to the active run ledger and emit a MILESTONE journal event; the grant **shall** expire automatically with the run because it is stored in the session-scoped ledger file. A second invocation of `ledger autopilot --range N` overwrites the existing grant (one-shot cap raise, not cumulative).

### [pacing-r-005 — Pacing exhaustion is a sanctioned stop-gate release with directive handoff](../enforcement/requirements/pacing-r-005-pacing-exhaustion-stop-gate-release-directive-handoff.md#pacing-r-005)

> **Withdrawn** (motive `phase-checkpoint-gate`): The wave-exhaustion release path (`isExhausted`) is removed. Auto-advancing-tier checkpoint phases replace it (see CHECKPOINT-R-006). Preserved for historical reference.

If the Stop hook fires and pacing is exhausted (no claimable unit remains for the current session) and one or more incomplete slices remain in the ledger, the Stop hook **shall** allow the session to end and **shall** emit a directive (not an advisory) instructing the operator to run the handoff skill and open a new session, naming the motive MAP.md path and the exact ids of all remaining incomplete slices.

### [pacing-r-006 — Autopilot grant requires non-empty reason; block message routes authorization through the operator; stop-gate surfaces active grants](../enforcement/requirements/pacing-r-006-autopilot-grant-requires-nonempty-reason.md#pacing-r-006)

> **Withdrawn** (motive `phase-checkpoint-gate`): The wave-pacing throttle described by PACING-R-001..R-006 was removed. Preserved for historical reference.

Three HITL (human-in-the-loop) requirements for the pacing escape hatch:

### [pacing-r-007 — Milestone gate releases on human-verified shippable deliverables, not wave count](../enforcement/requirements/pacing-r-007-milestone-policy-gates-on-human-verified-shippable.md#pacing-r-007)

The completion checkpoint gate **shall** hold until a human sign-off is recorded. A sign-off is written by `ledger milestone-signoff --verdict APPROVE` (which sets `pacing.milestone_signoff`) or by `ledger checkpoint --phase completion --verdict APPROVE` (which writes directly to `gate.phases.completion`). When `pacing.milestone_signoff` is present and `gate.phases.completion` is absent, `cmdCheckpoint` migrates the sign-off on read into `gate.phases.completion` so the stop-gate can evaluate a single authoritative location. A declared set of evidence artifacts (`pacing.milestone_artifacts`) must satisfy the artifact-staleness check (PACING-R-009) before the gate releases.

### [pacing-r-008 — Milestone sign-off requires write_token authority; subagents must not self-sign](../enforcement/requirements/pacing-r-008-milestone-signoff-requires-write-token-authority.md#pacing-r-008)

Both `ledger milestone-signoff` (which writes `pacing.milestone_signoff`) and `ledger checkpoint` (which writes `gate.phases.<phase>`) **shall** require the orchestrator `write_token`. Invoking either command without a valid `write_token` **shall** exit 1 with a message naming the missing authority. A subagent that cannot present the `write_token` cannot record a sign-off or phase verdict — preventing a subagent from approving its own work.

### [pacing-r-009 — Milestone artifacts are hook-validatable; staleness is derived from build-hash comparison](../enforcement/requirements/pacing-r-009-milestone-artifacts-hook-validatable-staleness.md#pacing-r-009)

Each entry in `pacing.milestone_artifacts` **shall** carry a `path` (local file path or URL), a `kind` (one of `screenshot`, `run_output`, `live_url`, `file`), and a `captured_build_hash` — **required** for `screenshot` and `run_output` (rejected without one); **optional** for `live_url` and `file`. A hook **shall** be able to validate milestone artifacts mechanically: (1) for `file` artifacts, confirm the local file exists; for `live_url` artifacts, confirm a captured companion (`file`, `run_output`, or `screenshot`) is present in the same milestone — no network probe is performed; (2) when `captured_build_hash` is present, compare it against the current build hash and classify the artifact as `fresh` or `stale` — using the same comparison semantics as the traceability evidence freshness mechanism (`traceability-classify.mjs`) rather than a second independent scheme.

### [pacing-r-010 — Milestone sign-off composes with awaiting_human; the two mechanisms must not conflict](../enforcement/requirements/pacing-r-010-milestone-signoff-composes-with-awaiting-human.md#pacing-r-010)

When the completion checkpoint gate is waiting for human sign-off (`pacing.milestone_signoff` absent or `gate.phases.completion` absent/non-APPROVE), the orchestrator **shall** be able to set `awaiting_human = true` (via `ledger await-human --token <write_token>`) to suppress the stop-gate nag while the human decides. The `awaiting_human` hold does not release the completion gate — it only suppresses the nagging. Clearing `awaiting_human` (via `--clear`) resumes normal enforcement. Setting the hold AND receiving `milestone_signoff.verdict = "APPROVE"` **shall** remain two separate write events to preserve auditability.

### [pacing-r-011 — Evidence artifacts under `.groundwork/` are never committed](../enforcement/requirements/pacing-r-011-evidence-artifacts-under-groundwork-never-committed.md#pacing-r-011)

Evidence artifacts recorded in `pacing.milestone_artifacts` and stored under `.groundwork/` **shall** never be committed to the repository. HAR files routinely carry `Authorization` headers, `Cookie`/`Set-Cookie` headers, and session tokens; committing them exposes credentials to every consumer of the repository's history.

### [seal-r-001 — Accepted residual — arbitrary-code-execution as the same OS user can forge a valid seal](../enforcement/requirements/seal-r-001-accepted-residual-ace-same-os-user.md#seal-r-001)

The sealed-gate design provides tamper-evidence against the realistic threat model (CLI misuse, direct `Write`/`Edit` tool calls, and simple Bash mutation patterns) but **shall not** be construed as guaranteeing containment against a subagent with arbitrary code execution running as the same OS user. Such a subagent can read the seal key from disk and write a correctly re-sealed ledger via `computeSeal(canonicalReleaseState(ledger), key)`, bypassing the stop-gate entirely. This is an accepted, documented residual risk.

## gw Command Surface

### [gw-cli-r-001 — Subcommand registry — 16 subcommands, no init](../gw-cli/requirements/gw-cli-r-001-subcommand-registry.md#gw-cli-r-001)

The `gw ledger` command **shall** accept exactly the following 16 subcommands: `status`, `add`, `set`, `complete`, `rm`, `show`, `view`, `gate`, `abandon`, `fog`, `frontier`, `claim`, `await-human`, `checkpoint`, `scope-token`, and `milestone-signoff`; it **shall not** accept `init`; and **when** an unknown subcommand is supplied, `gw ledger` **shall** exit 2 with an `UNKNOWN_SUBCOMMAND` error.

### [gw-cli-r-002 — --motive flag required on every subcommand](../gw-cli/requirements/gw-cli-r-002-motive-flag-required.md#gw-cli-r-002)

If any `gw ledger <subcommand>` invocation omits `--motive` or supplies `--motive` without a value, the CLI **shall** exit 2 and emit a `USAGE_ERROR` envelope whose `error.message` names the missing flag.

### [gw-cli-r-003 — Motive slug validation against ledger](../gw-cli/requirements/gw-cli-r-003-motive-validation.md#gw-cli-r-003)

If `--motive <slug>` is supplied and the loaded ledger's `motive` field is set and differs from `<slug>`, `gw ledger` **shall** exit 1 and emit a `MOTIVE_MISMATCH` error envelope.

### [gw-cli-r-004 — Run-store path contract matches legacy hooks](../gw-cli/requirements/gw-cli-r-004-run-store-path.md#gw-cli-r-004)

The `gw ledger` command **shall** resolve the active run store at `<project-dir>/.groundwork/runs/<session_id>.json` when `<session_id>` satisfies `[A-Za-z0-9_-]{1,128}`, and **shall** fall back to `<project-dir>/.groundwork/run.json` when `<session_id>` is present but does not satisfy the pattern. `<project-dir>` is `process.env.CLAUDE_PROJECT_DIR` when non-empty (logical-OR semantics: an empty string falls back to `process.cwd()`), otherwise `process.cwd()`. This path formula mirrors `resolveLedgerPath` in `hooks/lib/ledger-io.mjs` for present session IDs (both valid and invalid), but diverges when `CLAUDE_CODE_SESSION_ID` is absent and `--session` is not supplied: `gw ledger` exits non-zero and names the missing variable, whereas `resolveLedgerPath` falls back to `<project-dir>/.groundwork/run.json`.

### [gw-cli-r-005 — Write-token authority on mutating subcommands](../gw-cli/requirements/gw-cli-r-005-write-token-authority.md#gw-cli-r-005)

If any of the write-mutating subcommands (`set`, `complete`, `gate`, `abandon`, `await-human`, `checkpoint`, `scope-token`, `milestone-signoff`, `hold`) is invoked without `--token <value>` that matches the ledger's `write_token`, the CLI **shall** exit with an `AUTH_ERROR` envelope at exit code 1; the `complete` subcommand additionally **shall** accept a scoped token that owns all targeted slice IDs as an alternative to the master write token.

### [gw-cli-r-006 — --json envelope shape and stdout contract](../gw-cli/requirements/gw-cli-r-006-json-envelope-contract.md#gw-cli-r-006)

### [gw-cli-r-007 — Exit-code semantics: 0 / 1 / 2](../gw-cli/requirements/gw-cli-r-007-exit-code-contract.md#gw-cli-r-007)

The `gw ledger` command **shall** exit 0 on success, exit 1 on operational failure (ledger not found, auth error, motive mismatch, or an unexpected internal error), and exit 2 on usage error (unknown subcommand or missing required flag).

## Journal and Motive Lifecycle

### [journal-motive-r-001 — Journal CLI command surface](../journal-motive/requirements/journal-motive-r-001-journal-cli-command-surface.md#journal-motive-r-001)

The journal CLI **shall** expose exactly the following top-level commands: `append`, `show`, `digest`, `compile`, `motive`, `baseline`, `migrate-tickets`, `ac-retract`, and `graph`. The `motive` subcommand **shall** accept only `new` and `archive`; it **shall not** accept `list` or any other subcommand. Commands `journal motive list` and `journal event add` **shall not** exist.

### [journal-motive-r-002 — Motive on-disk directory structure](../journal-motive/requirements/journal-motive-r-002-motive-directory-structure.md#journal-motive-r-002)

Each motive **shall** be stored under `.groundwork/motives/<slug>/` and **shall** contain: `motive.md` (the charter), `MAP.md` (the ambient human view, auto-regenerated), `tickets/` (durable hand/agent-authored work objects), and `open-items/` (generated drill-down views, swept on regeneration). A motive directory **shall not** be created at any path outside `.groundwork/motives/`. Archived motives **shall** be moved to `.groundwork/archive/motives/<slug>/`.

### [journal-motive-r-003 — DECISION event required fields](../journal-motive/requirements/journal-motive-r-003-decision-event-required-fields.md#journal-motive-r-003)

The `journal append --type DECISION` command **shall** require `data.id`, `data.decision`, and `data.rationale` in the JSON payload; it **shall** exit 2 if any of these fields is absent or empty. The optional field `data.revises` (set to the decision's own id) **shall** suppress the id-collision warning when a DECISION with the same id already exists in the motive.

### [journal-motive-r-004 — DECISION id-collision behavior](../journal-motive/requirements/journal-motive-r-004-decision-id-collision-behavior.md#journal-motive-r-004)

### [journal-motive-r-005 — append/compile title vs decision seam](../journal-motive/requirements/journal-motive-r-005-append-compile-title-seam.md#journal-motive-r-005)

### [journal-motive-r-006 — Ticket durability and migrate-tickets](../journal-motive/requirements/journal-motive-r-006-ticket-durability.md#journal-motive-r-006)

Files under `.groundwork/motives/<slug>/tickets/` **shall** never be deleted or overwritten by any regeneration command; tooling **shall** create a ticket file only when a file at that path does not already exist. Files under `.groundwork/motives/<slug>/open-items/` **shall** be swept (regenerated from scratch) each time MAP regeneration runs and **shall not** be used to store durable work objects.

The `journal migrate-tickets <slug>` command **shall** scan `tickets/*.md` and delete only files whose last non-empty line matches the autogen footer; it **shall not** touch hand-authored files. It **shall** exit 0 even when no files are deleted.

### [journal-motive-r-008 — Archive gating with event-based resolution](../journal-motive/requirements/journal-motive-r-008-archive-gating.md#journal-motive-r-008)

### [journal-motive-r-009 — last_pause derivation event ordering](../journal-motive/requirements/journal-motive-r-009-last-pause-derivation.md#journal-motive-r-009)

`motive-map.mjs` **shall** derive `last_pause` by calling `.find()` on a newest-first event list to retrieve the most recent PAUSE event; it **shall not** use `.filter().pop()` on the same newest-first list, which would return the **oldest** PAUSE event. Both `motive-map.mjs` and `motive-compile.mjs` **shall** agree on the event ordering convention used for PAUSE extraction; divergence between the two surfaces constitutes a seam defect.

## Motive DAG Model

### [motive-dag-r-001 — Canonical node and edge schema](../motive-dag/requirements/motive-dag-r-001-canonical-node-and-edge-schema.md#motive-dag-r-001)

The motive DAG model **shall** define a typed node schema whose legal `type` values are exactly the node kinds enumerated in `hooks/lib/motive-graph.mjs` plus the `baseline` kind (named revision pointer, introduced by D-8), and a typed edge schema whose legal `kind` values are exactly the members of `EDGE_KINDS` exported by `hooks/lib/motive-graph.mjs`, such that every node carries `id`, `type`, and `attrs`, and every edge carries `kind`, `from`, and `to`.

### [motive-dag-r-002 — Reconciliation completeness over all event types](../motive-dag/requirements/motive-dag-r-002-reconciliation-completeness-over-all-event-types.md#motive-dag-r-002)

The motive DAG fold **shall** map every event type in `VALID_TYPES` (exported by `hooks/lib/journal-io.mjs`) to exactly one of three roles — node-creating, edge-creating, or attribute-mutating — with no event type left unmapped (total function), and no event type assigned to more than one role (disjoint partition).

### [motive-dag-r-003 — Event-sourced mutation vocabulary](../motive-dag/requirements/motive-dag-r-003-event-sourced-mutation-vocabulary.md#motive-dag-r-003)

The graph write surface **shall** consist of exactly five reducer primitives — `node.assert(kind, id, attrs)`, `node.retire(id, by)`, `edge.assert(kind, from, to)`, `edge.retire(kind, from, to)`, and `attr.set(nodeId, key, value)` — persisted as events to the existing O\_APPEND journal stream (no new file format, no second store), with every `VALID_TYPE` mapping to one or more of these primitives per the D-8 reconciliation table, and with `node.retire` / `edge.retire` implemented as new immutable revisions (never deleting prior events).

### [motive-dag-r-004 — Deterministic fold semantics](../motive-dag/requirements/motive-dag-r-004-deterministic-fold-semantics.md#motive-dag-r-004)

The fold function `assembleGraphFold(orderedEvents, { at?, charter?, groundTruth? })` **shall** be a pure function: given the same ordered event array and options, it **shall** always return the same graph; it **shall not** import `node:fs`, `node:child_process`, `Date`, `Math.random`, or `process.env`; all I/O dependencies (charter data, ground-truth comparison target) **shall** be injected by callers.

### [motive-dag-r-005 — Tamper-evident seal over the folded graph](../motive-dag/requirements/motive-dag-r-005-tamper-evident-seal-over-the-folded-graph.md#motive-dag-r-005)

The graph seal module `hooks/lib/graph-seal.mjs` **shall** compute and verify a tamper-evident seal over the folded graph by (1) serializing the current graph to a deterministic canonical form — nodes sorted by `id`, edges sorted by (`kind`, `from`, `to`), attributes with sorted keys — and (2) computing `HMAC-SHA256` over that canonical representation using a per-project key stored as a `.seal.key` sibling file, mirroring the pattern of `hooks/lib/gate-seal.mjs`; verification **shall** use a timing-safe comparison.

### [motive-dag-r-006 — Field-level losslessness invariant](../motive-dag/requirements/motive-dag-r-006-field-level-losslessness-invariant.md#motive-dag-r-006)

For every event type in `VALID_TYPES`, the fold **shall** map every field present in that event's payload to a corresponding attribute, node, or edge in the folded graph, with no field silently dropped via `default:` fallthrough or ignored fallback; during the tracer phase, the set of fields consumed by the fold **shall** be a superset of the fields populated by the existing journal corpus, converging to equality as unmapped fields are resolved.

### [motive-dag-r-007 — Lossless backward-compatible replay across all existing motives](../motive-dag/requirements/motive-dag-r-007-lossless-backward-compatible-replay.md#motive-dag-r-007)

### [motive-dag-r-008 — Consumer-side ledger reference validation against the motive's declared AC set and canonical fold](../motive-dag/requirements/motive-dag-r-008-consumer-side-ledger-reference-validation.md#motive-dag-r-008)

## Orchestration Model

### [orchestration-r-001 — Orchestrator delegates non-trivial implementation](../orchestration/requirements/orchestration-r-001-orchestrator-delegates-non-trivial-implementation.md#orchestration-r-001)

When the orchestrator classifies a task as non-trivial, the orchestrator **shall** delegate implementation to a `groundwork:junior-orchestrator` subagent, or to a `groundwork:general-purpose` subagent when the slice satisfies all four leaf-carve-out conditions: single domain with no sub-domains; ≤2 files; no internal sequencing; small verification surface.

### [orchestration-r-002 — Ledger fog slice tracks open questions without blocking frontier](../orchestration/requirements/orchestration-r-002-ledger-fog-slice-tracks-open-questions-without-blocking-frontier.md#orchestration-r-002)

When the orchestrator runs `ledger fog <id> --desc "…" --question "…"`, `hooks/ledger.mjs` **shall** create a slice with `kind: "fog"` and no acceptance criteria, and the `ledger frontier` command **shall** exclude all slices with `kind: "fog"` from its output.

### [orchestration-r-003 — Authorship duties for ticket sections](../orchestration/requirements/orchestration-r-003-authorship-duties-for-ticket-sections.md#orchestration-r-003)

When a ticket is created for a slice, the **planner** agent **shall** fill the Question and Context sections before handing off to implementation. When the implementing agent marks the slice complete, it **shall** append its findings to the Evidence section and record the outcome in the Decision and Ruled out sections. Neither agent is required to fill Revisions or Links; those sections remain available for subsequent sessions. An agent **shall** not leave Question or Context empty on a ticket it opens; a parser **should** warn (not block) when a completed slice's ticket has an empty Decision section.

## Spec Tooling

### [SPEC-TOOLING-R-001 — Concept Node Identification](../spec-tooling/requirements/spec-tooling-r-001-concept-node-identification.md#spec-tooling-r-001)

The spec tooling **shall** treat a file as a concept node if and only if its basename is `index.md` or `README.md` and its YAML frontmatter contains a non-blank `id` field; tooling that restricts concept node identification to `index.md` alone **shall not** be considered conformant.

### [SPEC-TOOLING-R-002 — Root Singularity](../spec-tooling/requirements/spec-tooling-r-002-root-singularity.md#spec-tooling-r-002)

`spec lint` **shall** emit an `exactly-one-root` violation and exit 1 when the concept tree contains zero or more than one concept node that declares `parent: null` or omits the `parent` field entirely; it **shall** exit 0 when exactly one such root exists.

### [SPEC-TOOLING-R-003 — Parent Resolution](../spec-tooling/requirements/spec-tooling-r-003-parent-resolution.md#spec-tooling-r-003)

`spec lint` **shall** emit a `parent-resolves` violation and exit 1 when any non-root concept node's `parent` field does not match the `id` of an existing concept node in the corpus.

### [SPEC-TOOLING-R-004 — Cycle Prohibition](../spec-tooling/requirements/spec-tooling-r-004-cycle-prohibition.md#spec-tooling-r-004)

`spec lint` **shall** emit a `no-cycles` violation and exit 1 when following `parent` links from any concept node enters a cycle that does not terminate at the root.

### [SPEC-TOOLING-R-005 — Parent Field Presence](../spec-tooling/requirements/spec-tooling-r-005-parent-field-presence.md#spec-tooling-r-005)

`spec lint` **shall** emit a `parent-field-present` violation and exit 1 for any concept node (other than the designated root) whose frontmatter omits the `parent` field entirely.

### [SPEC-TOOLING-R-006 — Requirement Body Structure](../spec-tooling/requirements/spec-tooling-r-006-requirement-body-structure.md#spec-tooling-r-006)

Every requirement body **shall** contain: (1) an EARS normative sentence with `**shall**` bolded (or `**shall not**` for prohibitions); (2) a `- **Why** —` rationale bullet whose text is a concrete engineering consequence — filler phrases such as "ensures correctness" or "maintains consistency" are prohibited; (3) a `- **Fit criterion** —` bullet stating an observable pass/fail condition; (4) `- **Verification**:` and `- **Criticality**:` annotations. There is no `ears:` and no `verify:` frontmatter field; frontmatter is metadata only, and using either field in frontmatter is an error (`stale-frontmatter` violation).

### [SPEC-TOOLING-R-007 — Summary Length](../spec-tooling/requirements/spec-tooling-r-007-summary-length.md#spec-tooling-r-007)

The `summary` field on any spec node **shall** be at most 25 words; a summary of exactly 25 words passes, a summary of 26 or more words triggers a `summary-length` violation.

### [SPEC-TOOLING-R-008 — Tree Completeness](../spec-tooling/requirements/spec-tooling-r-008-tree-completeness.md#spec-tooling-r-008)

`spec tree` **shall** include in its output all concept nodes whose `type` field is either `concept` or `moc`; a renderer that filters on `type: concept` alone **shall not** be considered conformant.

### [SPEC-TOOLING-R-009 — Coverage Model](../spec-tooling/requirements/spec-tooling-r-009-coverage-model.md#spec-tooling-r-009)

The spec tooling **shall** determine test coverage of a requirement solely by scanning `test/` and `tests/` directories for `// @verifies <REQ-ID>` annotations (via `hooks/lib/verifies-scan.mjs`); the `verifies:` frontmatter field on a requirement node **shall not** be read for coverage purposes — it is slice linkage metadata only.

### [SPEC-TOOLING-R-010 — CLI Invocation Contract](../spec-tooling/requirements/spec-tooling-r-010-cli-invocation-contract.md#spec-tooling-r-010)

`bin/spec` **shall** be invoked as a path (e.g. `./bin/spec lint`) and **shall not** be invoked as `node bin/spec lint`; the wrapper resolves its own real location via `readlink` so that it works both as a direct path and as a symlink on `$PATH`. Exit codes across all subcommands **shall** follow: `0` — success; `1` — operational failure (violations found, file not found, index stale); `2` — usage error (unknown subcommand, invalid flag). The `type_names` check for manifest lint runs only when `language` is `typescript`; for any other language it emits an informational skip message and exits 0.

## Token Economy

### [token-economy-r-001 — Prose compression rules apply to agent output](../token-economy/requirements/token-economy-r-001-prose-compression-rules-apply-to-agent-output.md#token-economy-r-001)

Agent output prose **shall** apply the following compression rules sourced from the caveman project: drop definite and indefinite articles; drop filler words (`just`, `really`, `basically`, `actually`, `simply`); drop pleasantries (`happy to help`, `great question`, `of course`); drop hedging-as-padding (hedges that carry no information, such as `I think` or `it seems like` used as sentence openers without intent); allow sentence fragments; prefer shorter synonyms (`use` over `utilise`, `fix` over `remediate`); omit tool-call narration (`Let me read the file`); omit preamble and progress notes before or between tool calls; omit decorative tables and emoji; quote the shortest decisive line rather than dumping a log excerpt.

### [token-economy-r-002 — Intensity level is bounded per surface](../token-economy/requirements/token-economy-r-002-intensity-level-is-bounded-per-surface.md#token-economy-r-002)

Every agent output surface **shall** apply compression at no more than the intensity level assigned to that surface: leaf agent output prose at `full` intensity (drop articles, fragments permitted); orchestrator sequencing prose — wave ordering, `blocked_by`, and gate sequences — at `lite` intensity at most (drop filler only; keep articles and full sentences); evidence surfaces at `none` (see TOKEN-ECONOMY-R-003). The intensity level `ultra` (strip conjunctions) **shall not** be used on any surface in groundwork.

### [token-economy-r-003 — Compression is forbidden on evidence surfaces](../token-economy/requirements/token-economy-r-003-compression-is-forbidden-on-evidence-surfaces.md#token-economy-r-003)

Compression **shall not** alter any of the following evidence surfaces: advisor citations; ledger entries; gate evidence; test output; `file:line` references; error text; code blocks. These surfaces must be quoted or reproduced exactly as they appear in their source.

### [token-economy-r-004 — Negation and scope words are preserved](../token-economy/requirements/token-economy-r-004-negation-and-scope-words-are-preserved.md#token-economy-r-004)

Compression **shall** never remove `not`, `never`, `no`, `only`, or `except` from any prose, regardless of intensity level.

### [token-economy-r-005 — Modality is preserved](../token-economy/requirements/token-economy-r-005-modality-is-preserved.md#token-economy-r-005)

Compression **shall not** upgrade a modal hedge (`may`, `could`, `sometimes`, `is likely to`, `might`, `appears to`) to a stronger claim (`will`, `does`, `always`, `is`) in any prose output.

### [token-economy-r-006 — No invented abbreviations; domain vocabulary preserved](../token-economy/requirements/token-economy-r-006-no-invented-abbreviations-domain-vocabulary-preserved.md#token-economy-r-006)

Compression **shall not** introduce ad-hoc abbreviations or contractions (`cfg`, `fn`, `req`) as substitutes for their full forms. Groundwork's existing domain vocabulary (`AC`, `TBD`, `TBR`, `impl`) **shall** be left unchanged — neither expanded nor further contracted. (D-4: these four are defined terms-of-art; `impl` is preserved domain vocabulary, not a prohibited abbreviation.)

### [token-economy-r-007 — ASD-STE100 skill is at v0.4.0 or later](../token-economy/requirements/token-economy-r-007-asd-ste100-skill-is-at-v0-4-0-or-later.md#token-economy-r-007)

The user-level ASD-STE100 skill install at `~/.claude/skills/asd-ste100/` **shall** be upgraded to upstream v0.4.0 with the frontmatter `name` field corrected to the value defined in the upstream manifest.

### [token-economy-r-008 — No implementation slice assumes a clean working tree](../token-economy/requirements/token-economy-r-008-no-implementation-slice-assumes-a-clean-working-tree.md#token-economy-r-008)

Every implementation slice in this motive **shall** stage or commit changes by explicit file path rather than using `git add .`, `git add -A`, or any command that stages all modified and untracked files.

### [token-economy-r-009 — Turn count and cache-read attribution are reported per session](../token-economy/requirements/token-economy-r-009-turn-count-and-cache-read-attribution.md#token-economy-r-009)

The token-measurement harness (`hooks/token-meter.mjs`) **shall** report `turn_count` and `cache_read_per_turn` for every session it parses.

`turn_count` is the number of unique API calls in the session, derived by counting unique `requestId` values among assistant records that carry billing usage. When no `requestId` is present in the transcript (e.g. synthetic fixtures), `turn_count` falls back to `record_count`.

`cache_read_per_turn` is `cache_read_input_tokens / turn_count`, a finite number (0 when `turn_count` is 0). It is the per-call cache-read handle that lets an analyst project how much the cache-read line changes as turn count changes.

### [token-economy-r-010 — Out-of-repo token levers are recorded as evaluated and not actioned](../token-economy/requirements/token-economy-r-010-out-of-repo-token-levers-are-recorded-as-not-actioned.md#token-economy-r-010)

This motive **shall** document the token-cost levers that lie outside this repository — in the operator's MCP server configurations, cloud-side Connections, and other installed plugins — as explicitly evaluated and deliberately not actioned, with measured or estimated figures and a stated rationale for each.

### [token-economy-r-011 — Skills/MCP surface is measured and the groundwork-controlled portion is bounded](../token-economy/requirements/token-economy-r-011-skills-mcp-surface-is-measured-and-bounded.md#token-economy-r-011)

Every Claude Code session's prompt prefix carries, beyond CLAUDE.md, a skills/MCP surface: the available-skills listing (name + description for every installed skill), MCP server tool-name catalogs, MCP server instruction blocks, and the agent-type roster. This requirement records the measured baseline, attributes ownership, and enforces a ceiling on the groundwork-controlled portion.

The groundwork-controlled portion **shall** remain below a token-estimated ceiling derived from the T34 baseline measurement (2026-09-08), enforced by an automated test on the authority source trees (`skills/groundwork/**/SKILL.md` and `agents-src/*.md`).

## Traceability

### [traceability-r-001 — Traceability chain renders on real motive data](../traceability/requirements/traceability-r-001.md#traceability-r-001)

When the traceability build logic is run against a real dogfooded motive (e.g. `groundwork-development`), it **shall** traverse the full chain — objective→spec-req→slice→self-test→live-verify→gate — without error on the real corpus. Note: the ambient auto-regenerated file was removed by D-24; the interactive live view (`hooks/lib/traceability-serve.mjs`) has no production caller (no `gw` command or hook starts it). Whether the pipeline is wired to a production entrypoint is deferred to a separate motive (TBR-3).

### [traceability-r-002 — Full chain is rendered end-to-end](../traceability/requirements/traceability-r-002.md#traceability-r-002)

The traceability graph assembler **shall** include nodes of every type in the chain — objective, spec-req, slice, self-test, live-verify, gate, artifact-evidence — and edges connecting them, so that a consumer rendering the graph can display the full objective→spec-req→slice→self-test→live-verify→gate path without additional data fetching.

### [traceability-r-003 — Link classification is visibly rendered](../traceability/requirements/traceability-r-003.md#traceability-r-003)

Every edge in the rendered traceability chain **shall** be visibly classified as one of: proven (gate APPROVE and live-verify pass on record), unproven (slice exists but no live-verify or gate), stale (evidence hash does not match current build hash), or missing (required link absent from graph).

### [traceability-r-004 — Mechanical links are deterministic](../traceability/requirements/traceability-r-004.md#traceability-r-004)

The traceability graph assembler **shall** be a pure function of its input data: given the same ledger slices, journal events, spec requirements, and doc/specs/_generated/coverage.json, it **shall** produce byte-for-byte identical node and edge sets on every invocation, with no timestamps, random ids, or nondeterministic ordering.

### [traceability-r-005 — Semantic classification is sourced from recorded verdicts](../traceability/requirements/traceability-r-005.md#traceability-r-005)

The traceability graph assembler **shall** derive all semantic edge classifications (proven, unproven, stale, missing) exclusively from recorded GATE and VERIFICATION journal events; it **shall not** infer or invent a verdict for any edge that has no corresponding recorded event.

### [traceability-r-006 — Stale evidence is detected via build hash](../traceability/requirements/traceability-r-006.md#traceability-r-006)

Each artifact-evidence node in the traceability graph **shall** carry the build/data hash it was captured against; when the assembler detects that the current build hash differs from the stored hash on an evidence reference, it **shall** mark that edge as stale.

## Verification

### [verification-r-001 — Stop hook blocks session end while slices are incomplete](../verification/requirements/verification-r-001-stop-hook-blocks-session-end-while-slices-incomplete.md#verification-r-001)

If the Stop hook fires and the active run ledger contains any slices whose status is not `complete` or `skipped`, or the advisor gate verdict is not `APPROVE`, then the Stop hook **shall** block session end.

### [verification-r-002 — Orchestrator invokes advisor to validate completion](../verification/requirements/verification-r-002-orchestrator-invokes-advisor-to-validate-completion.md#verification-r-002)

When a non-trivial task is complete, the orchestrator **shall** invoke the advisor (native `advisor()` tool, or `groundwork:advisor` if unavailable) to validate that the work is genuinely complete in the real world.

### [verification-r-003 — Stop hook emits non-blocking advisory for DECISION events lacking research](../verification/requirements/verification-r-003-stop-hook-emits-advisory-for-decision-events-lacking-research.md#verification-r-003)

If the Stop hook fires and any journal DECISION event for the current motive carries `data.blast` of `"high"` or `"medium"` (case-insensitive) and no `data.research` field, then the Stop hook **shall** append a non-blocking advisory message naming the ids of those DECISION events.

### [verification-r-004 — Stop hook emits non-blocking advisory for DECISION events with empty alternatives or unmarked id collisions](../verification/requirements/verification-r-004-stop-hook-emits-advisory-for-decision-events-empty-alternatives.md#verification-r-004)

If the Stop hook fires and any journal DECISION event for the current motive has an empty or absent `data.alternatives` array, or has a `data.id` that collides with another DECISION event's id without being explicitly marked as a supersession, then the Stop hook **shall** append a non-blocking advisory message naming the ids of those DECISION events.
