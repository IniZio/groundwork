---
id: enforcement-r-020
type: requirement
concept: C-ENFORCEMENT
title: Commit-convention deriver self-validates derived rules against repository history before enforcing them
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-020 — Commit-convention deriver self-validates derived rules against repository history before enforcing them {#enforcement-r-020}

When groundwork installs a `commit-msg` hook into a host repository, it **shall** derive the project's commit convention from that repo's `.gitmessage` template and self-validate each rule group independently against the repo's own recent commits before applying it. A rule group that does not clear the 85% pass-rate threshold **shall** be silently dropped; only the groups that clear it are enforced. If no group clears the threshold — or if derivation fails entirely — the installed hook **shall** apply universal-only rules (attribution trailer stripping and process vocabulary rejection) with no format, length, or body constraint. Derivation and per-group validation are implemented in `hooks/lib/derive-convention.mjs`.

**Template parsing** — the deriver reads `.gitmessage` as structured data, not prose. It locates the first non-blank line (stripping comment markers) and tests it against two recognised subject shapes:

- `type-scope`: specimen matches `<type>(<scope>): <subject>` or a placeholder variant (`<type>`, `<?type?>`)
- `scope-only`: specimen matches `<scope>: <subject>` or a placeholder variant

If the specimen does not match either shape, derivation fails immediately and universal-only rules apply.

**Enumeration extraction** — after identifying the shape, the deriver attempts to extract an allowed-values list for the bound field (`type` for `type-scope`, `scope` for `scope-only`) using two forms:

- Pipe-separated: a line of the form `types: feat | fix | docs | …` or `scopes: api | web | …`
- Dash-list: a run of three or more lines each matching `<token> — <description>`; the field is inferred from a label line within three lines above the run

If no enumeration is found, the derived rules enforce only the structural shape without constraining the allowed values.

**Per-rule self-validation** — before any enforcement, the deriver reads the 30 most recent non-merge commits from the repo (`git log --first-parent --no-merges -30 --pretty=format:%B%x00`). Revert commits and merge commits are excluded from the sample. The three rule groups — `subjectShape`, `subjectCap`, and `body` — are each scored independently via `validateRulesPerGroup`. If fewer than 10 usable commits are available, all derived enforcement is skipped (not enough history to validate). Each group that reaches a pass rate of 0.85 or above is added to the enforced set; groups below threshold are silently dropped. A repo can therefore enforce subject shape and capitalisation while not enforcing the body rule, if that group's pass rate falls below threshold. Universal rules always apply regardless. Measured outcomes: `hanlun-lms` enforces scope-only subject shape (0.933 pass rate); several repos enforce `subjectShape` and `subjectCap` only; two enforce `subjectShape` alone; the remainder fall back to universal-only.

**Narrowing invariant** — the deriver **shall** only ever narrow what is rejected. It never enforces a rule group that the repo's own history does not already follow at ≥85% fidelity. The template cannot express a no-body policy (the deriver reads no prose); whether the body group is enforced is determined entirely by the history oracle's pass rate for that group.

- **Why** — A hook that imposes groundwork's own format on a project that uses a different convention breaks every commit in that project. Per-rule self-validation against history ensures each enforced rule describes the project's actual practice before enforcement begins. The 0.85 threshold sits between two measured populations: correct rule-group derivations score 0.93–1.00, while mis-derivations (rule does not match actual history) score 0.00–0.73. Dropping a group below threshold is the fail-safe: the worst outcome of a false drop is weaker enforcement; the worst outcome of enforcing a mis-derived rule is blocking all commits.
- **Fit criterion** — Given a `.gitmessage` with a recognisable specimen and a repo with ≥10 usable commits, each rule group (`subjectShape`, `subjectCap`, `body`) that reaches 85% pass rate in the sample is enforced independently; groups below the threshold are dropped. A repo whose history fails all groups falls back to universal-only. Given a `.gitmessage` whose specimen does not match either recognised shape, or a repo with fewer than 10 usable commits, the installed hook applies universal-only rules and accepts any commit format. The deriver never reads or interprets prose lines in the template.
- **Verification**: unverified — in a repo with a `scope-only` `.gitmessage` and ≥10 matching commits where `subjectShape` passes 85%, confirm the hook rejects a `type(scope): subject` message; confirm that if `body` pass rate is below 85% in that same repo, a commit with a non-empty body is accepted; with no `.gitmessage` or fewer than 10 usable commits, confirm universal-only enforcement.
- **Criticality**: must
