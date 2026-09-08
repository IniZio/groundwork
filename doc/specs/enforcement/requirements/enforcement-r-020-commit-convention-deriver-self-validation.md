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

When groundwork installs a `commit-msg` hook into a host repository that has a `.gitmessage` template groundwork can parse, it **shall** derive the project's commit convention from that template and validate the derived rules ALL-OR-NOTHING against the repo's own recent commit subjects before applying them. If fewer than 85% of recent subjects match the derived shape — or if derivation fails entirely — the installed hook **shall** apply universal-only rules (attribution trailer stripping and process vocabulary rejection) with no format, length, or body constraint. Derivation and validation against history are implemented in `hooks/lib/derive-convention.mjs` (`deriveConvention` → `validateRules`). Repos without a `.gitmessage` follow a separate path: groundwork tests its own convention per rule group against that repo's history — see ENFORCEMENT-R-019.

**Template parsing** — the deriver reads `.gitmessage` as structured data, not prose. It locates the first non-blank line (stripping comment markers) and tests it against two recognised subject shapes:

- `type-scope`: specimen matches `<type>(<scope>): <subject>` or a placeholder variant (`<type>`, `<?type?>`)
- `scope-only`: specimen matches `<scope>: <subject>` or a placeholder variant

If the specimen does not match either shape, derivation fails immediately and universal-only rules apply.

**Enumeration extraction** — after identifying the shape, the deriver attempts to extract an allowed-values list for the bound field (`type` for `type-scope`, `scope` for `scope-only`) using two forms:

- Pipe-separated: a line of the form `types: feat | fix | docs | …` or `scopes: api | web | …`
- Dash-list: a run of three or more lines each matching `<token> — <description>`; the field is inferred from a label line within three lines above the run

If no enumeration is found, the derived rules enforce only the structural shape without constraining the allowed values.

**Validation against history** — before any enforcement, the deriver reads the 30 most recent non-merge commit subjects from the repo (`git log --first-parent --no-merges -30 --pretty=format:%s`). Revert and merge commits are excluded from the sample. The derived rules are scored ALL-OR-NOTHING via `validateRules`: if fewer than 10 usable subjects are available, all derived enforcement is skipped (not enough history to validate); if the aggregate pass rate falls below 85%, derivation is discarded and universal-only rules apply. This is a single combined threshold across all subjects — not independent per-group scoring. Template-derived rules always set `bodyPermitted: true` and never set `subjectCap`; the body constraint and subject-length groups are structurally absent from derived rules, so only `subjectShape` enforcement is possible on this path. Universal rules always apply regardless. Measured outcomes: `hanlun-lms` enforces scope-only subject shape (0.933 pass rate); several repos enforce `subjectShape` only; the remainder fall back to universal-only.

**Narrowing invariant** — the deriver **shall** only ever narrow what is rejected. It never validates a derived subject shape that the repo's own history does not already follow at ≥85% fidelity. The template cannot express a body or length policy (the deriver reads no prose); template-derived rules always set `bodyPermitted: true` and never set `subjectCap`, so the body constraint and subject-length groups are structurally absent — not history-gated — on this path.

- **Why** — A hook that imposes groundwork's own format on a project that uses a different convention breaks every commit in that project. Per-rule self-validation against history ensures each enforced rule describes the project's actual practice before enforcement begins. The 0.85 threshold sits between two measured populations: correct rule-group derivations score 0.93–1.00, while mis-derivations (rule does not match actual history) score 0.00–0.73. Dropping a group below threshold is the fail-safe: the worst outcome of a false drop is weaker enforcement; the worst outcome of enforcing a mis-derived rule is blocking all commits.
- **Fit criterion** — Given a `.gitmessage` with a recognisable specimen and a repo with ≥10 usable commit subjects clearing 85% aggregate pass rate, the hook enforces the derived `subjectShape` only (`bodyPermitted: true` and no `subjectCap` are hardcoded on derived rules, so body and length groups are structurally absent). Given the same conditions but an aggregate pass rate below 85%, or a `.gitmessage` whose specimen does not match either recognised shape, or a repo with fewer than 10 usable commits, the installed hook applies universal-only rules and accepts any commit format. The deriver never reads or interprets prose lines in the template.
- **Verification**: unverified — in a repo with a `scope-only` `.gitmessage` and ≥10 commits where the aggregate subject pass rate reaches 85%, confirm the hook rejects a `type(scope): subject` message and accepts a body (body group is structurally absent on this path); with aggregate pass rate below 85% or fewer than 10 usable commits, confirm universal-only enforcement and that any format passes.
- **Criticality**: must
