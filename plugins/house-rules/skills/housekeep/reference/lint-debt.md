# Lens `lint-debt`: scan checklist for a Housekeep scan subagent. Return Finding rows in the SKILL.md format (`| id | lens | severity | effort | auto-fix | location | finding | fix |`); do not edit.

Scope: lint, type-check and security-scanner suppressions in every language present. Detect languages from manifests (`package.json`/`tsconfig.json`, `pyproject.toml`/`setup.cfg`, `go.mod`, `Cargo.toml`, `build.gradle*`/`pom.xml`, `Package.swift`, `*.sh`) and run only what applies. The marker set mirrors `src/hooks/languages/tool-markers.ts` and `go.ts`. Non-suppression markers (`@license`, `@preserve`, `sourceMappingURL`, `__PURE__`, `fmt: off`, `prettier-ignore`, `/// <reference>`, `SAFETY:`, `@generated`, `MARK:`) are not findings.

## Smell catalog

| Language | Marker | SEV | Notes |
|---|---|---|---|
| Any | **Dead suppression** | SEV4 | Target violation no longer exists; delete |
| Any | **Blanket suppression** (no rule named) | +1 SEV vs the coded form | Hides every current and future rule on the line |
| Any | **Suppression of a safety/security rule** | SEV1 on critical path, else SEV2 | Real defects: swallowed errors, panics, injection, unsafe casts |
| Any | **Suppression of a style/naming rule** | SEV3 | Formatting, naming, complexity |
| TS/JS | `@ts-ignore`, `@ts-nocheck` | SEV2 (SEV1 on critical path) | Silences type errors; `@ts-nocheck` is file-wide |
| TS/JS | `@ts-expect-error` | SEV2 (SEV1 on critical path) | Same; self-documenting, self-expiring |
| TS/JS | `eslint-disable*`, `biome-ignore` | SEV2 safety rule, SEV3 style rule | Block form and `-file` form are worse than `-next-line` |
| TS/JS | `istanbul ignore`, `c8 ignore` | SEV3 | Hides untested code; SEV2 if the ignored branch is error handling |
| TS/JS | Untyped `any` at IO boundary | SEV2 (SEV1 if security-relevant) | Unvalidated external input typed as `any` |
| TS/JS | Untyped `any` internal | SEV3 | `any` inside non-boundary code |
| Python | `# noqa` (blanket) / `# noqa: CODE` | SEV3 coded, SEV2 blanket | `S`-prefixed (bandit) codes are SEV2 |
| Python | `# type: ignore`, `# pyright: ignore` | SEV2 blanket, SEV3 coded | Prefer the coded form `[code]` / `[rule]` |
| Python | `# pylint: disable=`, `# nosec` | SEV3 pylint style, SEV2 `nosec` | `nosec` hides a security finding |
| Go | `//nolint` (blanket) | SEV2 | Must name a linter: `//nolint:name` |
| Go | `//nolint:errcheck` | SEV2 | Swallowed error |
| Go | `//nolint:gosec` | SEV1 on critical path, else SEV2 | Security finding |
| Go | `//nolint:<other>` | SEV3 | Style/complexity linters |
| Rust | `#![allow(...)]` (crate/module-wide) | SEV2 | Worse than item-level: hides every future hit |
| Rust | `#[allow(clippy::indexing_slicing / unwrap_used / expect_used / panic)]` | SEV2 | Possible panic path |
| Rust | `#[allow(...)]` other | SEV3 | `dead_code`/`unused_*` are usually dead code, not lint debt |
| Rust | `#[expect(...)]` without `reason = "..."` | SEV3 | Self-expiring, but undocumented |
| Kotlin/Java | `@Suppress`, `@SuppressWarnings` | SEV3 (SEV2 for `"unchecked"`, `"deprecation"` on boundaries, `"all"`) | `"all"` is blanket |
| Swift | `// swiftlint:disable` | SEV3 (SEV2 for `force_cast`, `force_try`) | `disable` without `:next`/`:this` spans to end of file |
| Shell | `# shellcheck disable=SCxxxx` | SEV3 (SEV2 for quoting/injection codes: SC2086, SC2046, SC2091) | |

## Tooling

Inventory (one `rg` per language present):

```bash
rg -n '@ts-(ignore|expect-error|nocheck)|eslint-disable|biome-ignore|(istanbul|c8) ignore' --glob '*.{ts,tsx,js,jsx,mjs,cjs}'
rg -n ': any\b|as any\b' --glob '*.{ts,tsx}'
rg -n '#\s*(noqa|type:\s*ignore|pylint:\s*disable|pyright:\s*ignore|nosec)' --glob '*.py'
rg -n '//\s*nolint' --glob '*.go'
rg -n '#!?\[(allow|expect)\(' --glob '*.rs'
rg -n '@Suppress(Warnings)?\(' --glob '*.{kt,kts,java}'
rg -n 'swiftlint:disable' --glob '*.swift'
rg -n '#\s*shellcheck\s+disable=' --glob '*.{sh,bash}'
```

Dead suppressions (native, per language):

| Language | Command |
|---|---|
| TS | `npx tsc --noEmit` (unused `@ts-expect-error` is TS2578) |
| JS/TS eslint | `npx eslint --report-unused-disable-directives .` |
| Python | `ruff check --select RUF100 .` (`--fix` removes dead `noqa`); mypy `--warn-unused-ignores` |
| Go | `golangci-lint run` with `nolintlint` enabled and `allow-unused: false` |
| Rust | Convert `#[allow(x)]` to `#[expect(x)]`; `unfulfilled_lint_expectations` then flags dead ones |
| Others | No native tool: re-run the linter with the suppression removed (Pass 2) |

## Passes

**Pass 1 — Dead suppressions.** Run the dead-suppression command for each language present. Delete every flagged suppression.

**Pass 2 — Fix the suppressed violation.** For each live suppression, remove it and re-run the linter to reproduce the violation, then fix the cause (handle the error, guard the index, narrow the type, quote the variable). Order: safety/security rules (`errcheck`, `gosec`, `indexing_slicing`, `panic`, `nosec`, `any`) first, blanket before coded, crate/file-wide before line-level. If the fix needs a large refactor, triage as Deferred.

**Pass 3 — Deferred.** Whatever remains is Deferred with the reason. A leftover suppression must name one specific rule (no blanket, no `all`) and sit on the narrowest scope (line or item, not file or crate). Remaining suppressions are reported for a human decision.

**Pass 4 — Narrow `any` at IO boundaries (TS/JS).** Replace with a validated type (Zod schema or equivalent). Internal `any` is Deferred unless it blocks a boundary fix.

## Quality gate

The repo's own gate if present (`make lint`, else the `lint`/`check` script in `package.json`), else the native command per language:

```bash
npx tsc --noEmit && npx eslint .      # TS/JS
ruff check . && mypy .                # Python (as configured)
golangci-lint run                     # Go
cargo clippy --all-targets -- -D warnings   # Rust
```

Must exit 0. Net suppressions added must be zero or negative.
