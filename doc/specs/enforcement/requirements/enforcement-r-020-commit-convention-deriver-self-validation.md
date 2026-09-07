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

When groundwork installs a `commit-msg` hook into a host repository, it **shall** derive the project's commit convention from that repo's `.gitmessage` template and validate the derived rules against the repo's own recent commits before applying them. A derivation that fails validation **shall** be discarded entirely; the installed hook **shall** then apply universal-only rules (attribution trailer stripping and process vocabulary rejection) with no format, length, or body constraint. Derivation is implemented in `hooks/lib/derive-convention.mjs`.

**Template parsing** — the deriver reads `.gitmessage` as structured data, not prose. It locates the first non-blank line (stripping comment markers) and tests it against two recognised subject shapes:

- `type-scope`: specimen matches `<type>(<scope>): <subject>` or a placeholder variant (`<type>`, `<?type?>`)
- `scope-only`: specimen matches `<scope>: <subject>` or a placeholder variant

If the specimen does not match either shape, derivation fails immediately and universal-only rules apply.

**Enumeration extraction** — after identifying the shape, the deriver attempts to extract an allowed-values list for the bound field (`type` for `type-scope`, `scope` for `scope-only`) using two forms:

- Pipe-separated: a line of the form `types: feat | fix | docs | …` or `scopes: api | web | …`
- Dash-list: a run of three or more lines each matching `<token> — <description>`; the field is inferred from a label line within three lines above the run

If no enumeration is found, the derived rules enforce only the structural shape without constraining the allowed values.

**Self-validation** — before any enforcement, the deriver reads the 30 most recent non-merge commits from the repo (`git log --first-parent --no-merges -30 --pretty=format:%s`). Revert commits and merge commits are excluded from the sample. The derived rules are checked against each subject in the sample. If fewer than 10 usable commits are available, derivation fails (not enough history to validate). If the pass rate is below 0.85, derivation fails (the template does not describe the actual history). Validated pass rates on real repositories: 0.933 for a `scope-only` template (hanlun-lms), 1.000 for `type-scope` templates with full history (nexus-main, groundwork). Any derivation failure leaves the installed hook in universal-only mode.

**Narrowing invariant** — the deriver **shall** only ever narrow what is rejected. It never imposes a rule that the repo's own history does not already follow at ≥85% fidelity. A body is always permitted in derived rules — the deriver cannot infer a no-body policy from a `.gitmessage` template without reading prose.

- **Why** — A hook that imposes groundwork's own format on a project that uses a different convention breaks every commit in that project. Self-validation against history ensures the derived rules describe the project's actual practice before enforcement begins. The 0.85 threshold sits between two measured populations: correct derivations score 0.93–1.00, while mis-derivations (template shape does not match actual history) score 0.00–0.73. Discarding derivations below threshold is the fail-safe: the worst outcome of a false discard is weaker enforcement; the worst outcome of a false derivation is blocking all commits.
- **Fit criterion** — Given a `.gitmessage` with a recognisable specimen and a repo with ≥10 usable commits where ≥85% match the derived rules, the installed hook enforces the derived format and rejects commits that violate it. Given a `.gitmessage` whose specimen does not match either shape, or a repo where derivation pass rate is below 0.85, the installed hook applies universal-only rules and accepts any commit format. The deriver never reads or interprets prose lines in the template.
- **Verification**: unverified — in a repo with a `scope-only` `.gitmessage` and ≥10 matching commits, confirm the hook rejects a `type(scope): subject` message and accepts a `scope: subject` message; in a repo with a `.gitmessage` whose history pass rate is below 0.85, confirm the hook accepts any format; with no `.gitmessage`, confirm universal-only enforcement.
- **Criticality**: must
