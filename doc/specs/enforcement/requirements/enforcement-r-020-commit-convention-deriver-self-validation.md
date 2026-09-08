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

When groundwork installs a `commit-msg` hook into a host repository that has a `.gitmessage` template groundwork can parse, it **shall** derive the project's commit convention from that template and validate the derived rules per rule group independently against the repo's own recent commit history before applying them — the same `RULE_GROUPS` oracle (`subjectShape`, `subjectCap`, `body`) used for repos without a template. Each group that clears 85% is enforced; groups below threshold pass freely. If derivation fails entirely, the installed hook **shall** apply universal-only rules (attribution trailer stripping and process vocabulary rejection) with no format, length, or body constraint. Derivation and per-group validation are implemented in `hooks/lib/derive-convention.mjs` and `hooks/lib/commit-convention.mjs` (`validateTemplateConvention` → `validateRulesPerGroup`).

**Template parsing** — the deriver reads `.gitmessage` as structured data, not prose. It locates the first non-blank line (stripping comment markers) and tests it against two recognised subject shapes:

- `type-scope`: specimen matches `<type>(<scope>): <subject>` or a placeholder variant (`<type>`, `<?type?>`)
- `scope-only`: specimen matches `<scope>: <subject>` or a placeholder variant

If the specimen does not match either shape, derivation fails immediately and universal-only rules apply.

**Enumeration extraction** — after identifying the shape, the deriver attempts to extract an allowed-values list for the bound field (`type` for `type-scope`, `scope` for `scope-only`) using two forms:

- Pipe-separated: a line of the form `types: feat | fix | docs | …` or `scopes: api | web | …`
- Dash-list: a run of three or more lines each matching `<token> — <description>`; the field is inferred from a label line within three lines above the run

If no enumeration is found, the derived rules enforce only the structural shape without constraining the allowed values.

**Validation against history** — before any enforcement, the hook reads the 30 most recent non-merge full commit messages from the repo. Revert and merge commits are excluded from the sample. If fewer than 10 usable messages are available, all derived enforcement is skipped and universal-only rules apply. Otherwise the derived rules are scored per group independently via `validateRulesPerGroup`: each of `subjectShape`, `subjectCap`, and `body` is tested against all sampled messages, and only groups that clear 85% are included in `enforce`. Universal rules always apply regardless. Measured outcomes: several repos enforce `subjectShape` only; the remainder fall back to universal-only.

**Body-group precedence** — a template that explicitly declares or invites a body outranks history: the body rule is never applied regardless of what history shows. Declaration is detected by `detectBodySection` (derive-convention.mjs) via two forms: (a) a structural section heading matching `[-= ]*[ body ][-= ]*` (case-insensitive), e.g. `-----[ BODY ]-----`; (b) any line containing the word "body" that does not also match a prohibition phrase (`no body`, `without body`, `omit body`, `skip body`), e.g. "Optional body if needed". A line prohibiting a body (e.g. "No body — subject line only.") does not trigger declaration; history decides. Measured outcomes: 17 `nexus-*` repos whose templates say "Optional body if needed" and 4 `hanlun-lms` repos with a structural `[ BODY ]` heading are not subject to the empty-body rule; groundwork's own repo enforces empty bodies (its template's "No body — subject line only." matches the prohibition pattern).

**Narrowing invariant** — the deriver **shall** only ever narrow what is rejected. It never enforces a rule group that the repo's own history does not already follow at ≥85% fidelity. Template-derived rules do not set `subjectCap` (no numeric cap is enforced even when that group clears history); `bodyPermitted` is set to `true` by default and overridden to `false` only when the body group clears the history threshold AND the template does not declare a body — making the empty-body rule always opt-in from evidence and always overridable by declaration.

- **Why** — A hook that imposes groundwork's own format on a project that uses a different convention breaks every commit in that project. Per-rule self-validation against history ensures each enforced rule describes the project's actual practice before enforcement begins. The 0.85 threshold sits between two measured populations: correct rule-group derivations score 0.93–1.00, while mis-derivations (rule does not match actual history) score 0.00–0.73. Dropping a group below threshold is the fail-safe: the worst outcome of a false drop is weaker enforcement; the worst outcome of enforcing a mis-derived rule is blocking all commits.
- **Fit criterion** — Given a `.gitmessage` with a recognisable specimen and a repo with ≥10 usable commit messages, each rule group that clears 85% in the repo's own history is enforced independently; the body rule is not applied when the template declares or invites a body. Given a `.gitmessage` whose specimen does not match either recognised shape, or fewer than 10 usable commits, the installed hook applies universal-only rules and accepts any commit format.
- **Verification**: unverified — in a repo with a `scope-only` `.gitmessage` and ≥10 commits where `subjectShape` clears 85%, confirm the hook rejects a `type(scope): subject` message; in the same repo with a history where most commits have no body, confirm the empty-body rule is enforced; in a repo whose template contains "Optional body if needed", confirm the empty-body rule is not applied; with fewer than 10 usable commits, confirm universal-only enforcement.
- **Criticality**: must
