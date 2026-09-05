# Vertical-Slice Failure Modes

Six failure modes promoted from the groundwork memory index. Each names the incident, traces the causal chain, and states the correction.

---

**Failure: fence-slices-by-file-not-ac** — slicing by acceptance criterion when the code is one decision tree gives each implementer only its assigned branch; the other views break silently.

In the junior-orchestrator-parity motive, three defects shared this shape. S8 tightened the ledger schema from the production write path, breaking `motive_ref` which arrives via ledger init input and is read by the stop-gate — a hard init failure. S6 changed the scoped-token format without owning the tests that pinned the old format. S6's narrow allow branch returned `passthrough()` before mutation/exfil pattern checks ran, reopening a redirect protection. The advisor's diagnosis: the guard is one decision tree whose branches were owned by different ACs.

Correction: fence by file, not by acceptance criterion, whenever slices share a function or predicate. Grant ownership of every test that pins a shared format in the same brief as the format change. Require the implementer to enumerate the contract from every direction it is consumed — written by code, accepted as input, read by consumers — not just the direction named by its AC.

---

**Failure: ledger-cannot-see-missing-slices** — the ledger verifies only registered slices; a forgotten obligation reads as N/N complete, gate: APPROVE.

In the RFC-0001 motive, the plan specified that a generated `rfc:manifest` block would supersede the hand-written `DIGEST.md`. The deletion slice was registered and completed; the manifest-generator slice was never registered. The ledger reported 37/37 complete with APPROVE while the RFC had no navigable entry point: `DIGEST.md` gone, no manifest, all 12 table-of-contents anchors dangling.

Correction: never register a deletion without its replacement in the same wave, or with an explicit `blocked_by` on it. After decomposing from a plan, diff the plan's own slice list against the ledger. `N/N complete` answers "did I finish what I listed", never "did I list the right things".

---

**Failure: green-slices-broken-seam** — a contract enforced at two points drifts while both sides stay green; slice-local tests assert only one side of the seam.

Shipping `data.revises`, `hooks/journal.mjs` documented and accepted `revises: true` while `hooks/lib/motive-compile.mjs` required `revises === id`. Each file was internally consistent, each had passing tests, all 8 slices were verified. The system was still broken. The seam was confirmed again: a session adding payload validators to `hooks/journal.mjs` only created a new divergence where `gw journal append` accepted payloads `bin/journal` rejected.

Correction: when one contract is enforced at two points (write path vs read path, CLI vs library, authoring vs compilation), the deliverable is a parity test — one payload evaluated on both sides, asserting the verdicts agree. Write it as part of the slice that introduces the second enforcement point, not as cleanup.

---

**Failure: pipeline-stage-insertion-moves-wiring** — inserting a stage into a pipeline or collapsing two entry points into one is not a phrasing edit; grep-clean and build-green do not verify it.

When `interview → vertical-slice` became `interview → planner → vertical-slice`, three things moved that a phrase-grep never catches: (1) the downstream handoff — interview's `description:` frontmatter still routed to vertical-slice, bypassing the newly-inserted planner; (2) resource ownership — a corrective edit invented "planner initializes the ledger" when CLAUDE.md says vertical-slice writes it; (3) the deliverable's other half — D-83 (planner Phase 0 intake) rode along in the same slice and was self-reported, never audited. The session's self-reports on this change were 2-for-2 defective, each "clean fix" introducing the next seam.

Correction: on any pipeline-topology change, before the gate run three source-grounded checks: (a) does the reframed stage's description and terminal handoff point at the new next stage? (b) does every file touched this session agree on who owns each shared resource, checked against the authoritative definition? (c) was every named sub-deliverable read against source, not just self-reported?

---

**Failure: redgreen-perturbation-destroys-sibling-work** — briefing a slice to temporarily set a real project file to a violating state for a red→green proof destroys any uncommitted work a sibling slice made to that file.

In the obsidian-native-groundwork motive, slice T4 repaired four `doc/specs/*/index.md` files (`parent: null` → `parent: C-GROUNDWORK`). Slice T6, running concurrently, was briefed to set `doc/specs/verification/index.md` back to `parent: null` to prove its new lint rule bit. It perturbed all four and never restored them. T4's change was uncommitted, so reverting to `parent: null` was HEAD — the work was unrecoverable. The ledger still read `T4 ✓`; slice completion records that an agent reported success, never that the artifact still exists.

Correction: in every brief demanding a red→green proof, state explicitly: perturb a copy in a temp dir outside the repo, never the real tree. Reserve real-file perturbation for a file no other in-flight slice touches, and only when the slice's own work is already committed.

---

**Failure: agent-git-stash-destroys-run** — a wave agent's plain `git stash` reverted ~110 uncommitted tracked changes mid-run; prose prohibition in all six briefs did not prevent it.

On 2026-09-01, a wave-7 agent ran `git stash` reverting waves 3–6 of the obsidian-native-groundwork motive to HEAD. Staged adds, staged deletes, and tracked modifications vanished; untracked files survived untouched. `bin/gw-hook` disappeared from disk and index; `hooks/hooks.json` silently reverted to its pre-cutover form, undoing an 8-hook rewire. Detected only because an unrelated assertion reported a hook "missing from hooks.json". Agents reach for `git stash -u` habitually to get a red→green baseline; the struggle-detector had logged it repeatedly in the prior session.

Correction: commit at the end of every verified wave — do not let multiple waves accumulate uncommitted. When a brief must allow perturbation, mandate `cp` to a path outside the repo and restoration from that copy, never a git-based restore. Recovery from a stash (not `reset --hard`): `git stash show --name-only stash@{0}` to list paths, then `git stash apply` (never `pop`). See the full recovery procedure in the memory entry `agent-git-stash-destroys-run`.
