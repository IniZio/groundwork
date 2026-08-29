# Enforcement Glossary

Terms specific to the enforcement concept. For groundwork-wide terms, see the root glossary.

---

**autopilot grant**
An explicit, operator-authorized extension to the pacing budget for the current session. Written to `pacing.grant` in the run ledger by `ledger autopilot --range N --reason "…" --token <write_token>`. Expires with the run (session-scoped). A second invocation overwrites the first (not cumulative). Requires a non-empty `--reason`; agents must not self-grant.

**awaiting_human**
A ledger flag (`awaiting_human = true`) that suppresses the stop-gate block nag while a legitimate human decision is pending (e.g. waiting for milestone sign-off). Set via `ledger await-human --token <write_token>`; cleared via `--clear`. Does not release the milestone gate — it only pauses enforcement noise.

**captured_build_hash**
A content hash of the data/build state at the time an evidence artifact was captured. Required on `screenshot` and `run_output` milestone artifacts; optional on `file` and `live_url`. Used for staleness detection: if the underlying data is regenerated, the hash drifts and the hook marks the artifact stale.

**directive**
An output line from the Stop hook that is an instruction to the operator, not an advisory. Specifically: when pacing is exhausted and incomplete slices remain, the Stop hook emits a directive naming the motive MAP.md path and all remaining incomplete slice ids. Contrast with advisory (a suggestion the operator may ignore).

**exempt_kinds**
The slice kinds (`plan`, `diagnose`, `design`, `fog`) that are excluded from pacing enforcement. Exempt slices may be claimed in any unit without consuming pacing budget.

**fail-closed**
Enforcement mode where the absence of a required signal causes the check to block. Example: when `--build-hash` is absent and a `captured_build_hash` is declared, the artifact is classified stale and the gate blocks. Contrast with fail-open.

**fail-open**
Enforcement mode where the absence of a required signal causes the check to warn but permit. Example: when the nesting-guard cannot determine the caller's depth, it warns and allows. Used for advisory constraints to preserve liveness. Contrast with fail-closed.

**hard-block**
A PreToolUse hook response with `{"decision": "block", "reason": "..."}` that denies the tool call before the model sees it. The orchestrator impl-guard uses hard-block; other enforcement hooks are fail-open advisories.

**impl-guard**
Short for orchestrator-impl-guard. The PreToolUse hook (`hooks/orchestrator-impl-guard.mjs`) that blocks the orchestrator from writing files outside the one permitted memory path shape.

**milestone artifact**
An evidence artifact declared in `pacing.milestone_artifacts`. Has a `path`, `kind` (`screenshot`, `run_output`, `live_url`, or `file`), and optionally a `captured_build_hash`. Validated mechanically by the hook at gate time.

**milestone sign-off**
A record (`pacing.milestone_signoff`) written to the ledger by the operator (requires `write_token`) to confirm a named shippable increment. With `verdict: "APPROVE"`, releases the milestone pacing gate. Cannot be written by a subagent (no write_token).

**pacing**
The mechanism that throttles how many units of work (waves) a session may claim. Default: 1 wave per session (`budget: 1, policy: "wave"`). Absent pacing field = disabled. Blocks `claim` and `set --status in_progress`; never blocks `complete`.

**resolved unit**
A wave (or milestone, depending on policy) for which all non-exempt slices have reached a terminal status. The pacing module compares `resolved_units` against `budget + grant.range` to determine whether a new unit may be claimed.

**seal**
An HMAC over the canonical release state of the run ledger, stored in a per-session key file (`.groundwork/runs/<sessionId>.seal.key`, mode 0600). Provides tamper-evidence against CLI misuse and direct file writes. Does not protect against a process running as the same OS user (see SEAL-R-001).

**stop-gate**
The Stop hook (`hooks/stop-gate.mjs`) that blocks session end while the active run ledger has incomplete slices or an absent advisor APPROVE. Yield-aware (allows stop when background tasks are in flight or `awaiting_human = true`). Releases with a directive when pacing is exhausted.

**write_token**
The orchestrator-level credential printed at `ledger init`. Required for `ledger gate advisor APPROVE`, `ledger complete`, `ledger autopilot`, and `ledger await-human`. Never passed to subagents; requiring it on a command structurally excludes subagents from performing that action.
