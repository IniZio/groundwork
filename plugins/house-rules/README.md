# house-rules

Code-quality rule engine for Claude Code. Developers guard codebase health against vibe-coded bloat by registering per-file and per-pattern rules that run as hooks.

## Install

Add the groundwork marketplace to Claude Code, then install the `house-rules` plugin:

```
/plugin marketplace add IniZio/groundwork
/plugin install house-rules@groundwork
```

Requires Claude Code v2.1.193 or later (plugin dependencies); older versions silently lose enforcement.

## Rules

| Rule | What it enforces | Guard (PreToolUse) | Gate (Stop/SubagentStop) | CLI | Autofix |
|---|---|---|---|---|---|
| comment-density | 5 net-new comment lines per 100 added lines; reword pairing encouraged | TypeScript/JavaScript and Go: strips over-budget comments before Write/Edit/MultiEdit; other languages pass through | blocks when session-changed file is over budget; auto-trims TypeScript/JavaScript and Go | `house-rules check --base <ref>` | TypeScript/JavaScript, Go: stable; other langs: preview |
| stray-artifacts | coexisting synonym dir pairs (doc+docs, test+tests, scripts+script, util+utils, lib+libs) and root scratch files (test-*.{js,mjs,ts}, *.bak, tmp*, scratch*) | DENY Write into either synonym dir when its sibling exists | blocks if session-created strays exist | `house-rules check --base <ref>` | none |

Per-rule READMEs are generated under `rules/<id>/`.

## CLI

```
house-rules check [--all | --base <ref>] [--fix] [--format <text|json>] [<pathspec>...]
house-rules baseline [--all | --base <ref>] [--format <text|json>] [<pathspec>...]
house-rules housekeep [--all | --since <ref>] [--rules <a,b>] [--paths <glob,...>] [--baseline] [--max <n>] [--dry-run] [--diff] [--format <text|json>] [<pathspec>...]
```

**Scope**: pass `--base <ref>` to diff against a commit; `--all` to scan all tracked files. `--all` cannot be combined with `--base` or `--since` (exit 2). Positional arguments are pathspecs that narrow the file set.

**Exit codes** — same meaning for `check`, `check --fix`, and `housekeep`:

| Code | Meaning |
|---|---|
| 0 | No error-severity findings remain |
| 1 | Error-severity findings remain |
| 2 | Usage error, unknown flag, or runtime error |

`--fix` is valid only for the `check` subcommand; using it on another subcommand is a usage error (exit 2).

**JSON output**: `--format json` emits one JSON line to stdout; no scope header is written. Text mode prints the scope header to stderr: `house-rules: base=<ref|all> files=<N>`.

```
{"scope":{"base":"HEAD","mode":"diff","files":1},"findings":[{"ruleId":"comment-density","path":"demo.ts","line":2,"severity":"error","message":"100.0/100 (5 comments in 5 added lines; rows 2, 3, 4, 5, 6)"}],"fixed":[],"manual":[],"summary":{"fixed":0,"manual":0,"findings":1}}
```

Shape: `scope.base` is the ref or `"all"`; `scope.mode` is `"diff"` or `"all"`; `scope.files` is a count. `findings`, `fixed`, and `manual` are arrays of `{ruleId, path, line, severity, message}`; `manual` entries also carry `reason`. `summary` mirrors array lengths.

**Housekeep options**: `--dry-run` runs the fix in memory — no files written, no ledger entries appended. `--diff` (text mode) prints a unified diff of what would change. `--baseline` targets entries in `.house-rules/baseline.json`; after a real (non-dry-run) run, fixed entries are pruned from the baseline. `--max <n>` caps the number of fixes applied; findings beyond the cap appear in the manual-fix list with reason `--max limit reached`. Manual-fix lines end with ` — <reason>`.

## Baseline

`.house-rules/baseline.json` records known violations at a point in time. `house-rules check` subtracts baseline entries so that violations at or below baseline are not errors. Run `house-rules baseline` to ratchet the baseline to current state. Use this to introduce enforcement to an existing codebase without blocking on pre-existing violations.

## Keep policy

When trimming a file to meet the density cap, comment groups are sorted shortest-first (fewest rows; ties broken by source order). The density trim drops the longest kept group first until the file is within budget.

## Divider and spacer exemptions

Dividers and spacers are exempt from the comment count and do not count toward density.

- **Divider**: a comment whose entire stripped content is either 2+ box-drawing characters (U+2500–U+257F, i.e. `─` through `╿`) or 4+ of `-=#*~_`. Exempt reason: `divider`.
- **Spacer**: a `//` comment with no content after stripping. Exempt reason: `spacer`.

A `/* */` block is exempt only if every non-blank inner line is individually exempt. Dividers and spacers on added rows are removed together with the comment group they frame, or when left orphaned next to a removal; pre-existing ones stay.

## Lint-tool marker exemptions

Lint-tool markers and toolchain directives are recognised only in the language that uses them: TypeScript/JavaScript (`eslint-disable`/`enable`, `prettier-ignore`, `biome-ignore`, `/// <reference`), Python (`noqa`, `type: ignore`, `pylint:`, `pragma:`), Bash (`shellcheck`), and YAML (`yaml-language-server:`). A marker from another toolchain — for example `// noqa` in Go or Rust, or `// eslint-disable-next-line` in Rust — is ordinary prose and counts toward density. In-language markers are directive comments and are never removed by the autofix.

Annotation tags (`@…`, matching `/^@\w/`) are exempt in every language, the same as dividers, URLs, note markers, spacers, regions, and groundwork rule markers — they are a comment-density policy exemption, not a TypeScript-specific one. Assigning `pragma:` to Python (coverage.py's `# pragma: no cover`) is a deliberate choice beyond ticket 11's list; `// pragma:` in TypeScript is therefore counted.

## Enforcement scope — comment-density

**comment-density guard** (PreToolUse Write/Edit/MultiEdit) — emits `updatedInput` + `additionalContext`; never emits `permissionDecision` (Claude Code runs its normal permission check on the rewritten input).

**comment-density gate** (Stop, SubagentStop) — emits `decision: "block"` + `reason`; or `continue: true`; auto-trims TypeScript/JavaScript and Go before the block decision. 4-attempt bound: gate tracks consecutive blocks per session and agent in `os.tmpdir()/groundwork-comment-density/`. Attempts 1–3: block naming over-limit files. Attempt 4: allow with a stderr warning. A changed set of violating files resets the counter. SubagentStop and Stop have independent counters (keyed by agent_id vs "main").

TypeScript/JavaScript covers `.ts`, `.mts`, `.cts`, `.tsx`, `.jsx`, `.js`, `.mjs`, `.cjs` — one `typescript` language parsed with two grammars (see Grammar variants below).

When the gate auto-trims a file, the next Read/Edit/Write of that file emits a one-time note giving a count of the removed comments. A "file changed since last Read" message on a file you were editing is expected if the gate ran autofix at turn end — it is not another agent; re-read the file before editing and do not re-add the removed comments (a comment that must stay should explain a non-obvious why). On Stop, files being actively edited by still-running background subagents are left alone.

**Go autofix** — removes comments as text; spacing at comment-removal join points (` ,`, ` )`, `{ }`) is repaired natively; string literals are never touched. No gofmt is run. Aligned trailing-comment columns are left to your formatter. Protected Go comments (never removed): `//go:*` pragmas, `// +build`, `//export`, `//line` and `/*line` directives, `//nolint`, `//lint:ignore`/`file-ignore`, `// +marker:` (e.g. kubebuilder), everything before the `package` clause (license, SPDX, `Code generated ... DO NOT EDIT.`), the whole comment group (any mix of `//` and `/* */`) directly above `import "C"` (top-level or grouped import spec), `// Output:`/`// Unordered output:`/`/* Output: */` blocks inside Example funcs, go/doc `MARKER(uid)` notes with continuations, and doc comments on declarations including interface methods and embedded interface elements.

**Supported languages** — all languages house-rules can parse are listed below.

<!-- languages:start -->
| Language | Detected by | Grammar source |
|---|---|---|
| bash | `.sh`, `.bash`; shebang: `bash`, `bsh`, `sh`, `zsh` | vendored from `tree-sitter-bash` |
| yaml | `.yml`, `.yaml` | vendored from `@tree-sitter-grammars/tree-sitter-yaml` |
| typescript | `.ts`, `.mts`, `.cts`, `.tsx`, `.jsx`, `.js`, `.mjs`, `.cjs` | vendored from `tree-sitter-typescript` |
| python | `.py` | vendored from `tree-sitter-python` |
| dockerfile | `.dockerfile`; basenames: `Dockerfile`, `Containerfile`; prefixes: `Dockerfile.`, `Containerfile.` | built from source by `scripts/build-dockerfile-grammar.sh` |
| go | `.go` | vendored from `tree-sitter-go` |
| rust | `.rs` | vendored from `tree-sitter-rust` |
| sql | `.sql` | built from source by `scripts/build-sql-grammar.sh` |
| make | `.mk`; basenames: `Makefile`, `GNUmakefile`, `makefile` | vendored from `tree-sitter-make` |
| toml | `.toml` | vendored from `@tree-sitter-grammars/tree-sitter-toml` |
| kotlin | `.kt`, `.kts` | vendored from `@tree-sitter-grammars/tree-sitter-kotlin` |

Files in other languages are not measured.
<!-- languages:end -->

**No opt-out**: there is no environment variable or config knob to disable comment-density enforcement. The `CLAUDE_CODE_ENTRYPOINT=sdk-py/sdk-js` skip exists only to prevent nested-agent leakage.

## Adding a language

Adding a language requires three steps, one optional step, and two reference sections below (grammar variants and promoting autofix to stable).

**1. One language adapter in `src/hooks/languages/registry.ts`.**

Add an entry to the `ADAPTERS` object. The adapter must set:

- `id` — a short lowercase identifier (e.g. `"rust"`).
- `detect` — at least one of `extensions`, `basenames`, `basenamePrefixes`, or `shebangInterpreters` (shebang is checked only when the file has no extension).
- `grammar` — the wasm filename under `src/hooks/grammars/` plus either:
  - `vendor: { package, file }` — copy the wasm from the npm package by running `bun scripts/vendor-grammars.ts`; the script writes the wasm and records the provenance in `src/hooks/grammars/SOURCES.json`.
  - `build` — plugin-relative path to a build script (e.g. `"scripts/build-dockerfile-grammar.sh"`); place a `<wasm-stem>.source.json` beside the wasm recording its `sha256` and `bytes`.

**ABI trap**: never use `tree-sitter-wasms` to source wasm files — its scanner grammars crash at runtime (ABI mismatch). Use each grammar's own npm package (e.g. `tree-sitter-rust`, `@tree-sitter-grammars/tree-sitter-toml`).

Optionally add:

- `isCommentNodeType` — a predicate on tree-sitter node type names; omit to accept any type containing `"comment"`.
- `classifyComments` — a classifier that sets `kind`, `directive`, `header`, and `group` on each comment; omit to use the default (shebang → directive, `/**` → doc, adjacent whole-line comments form a group).

**2. One conformance fixture `test/fixtures/languages/<id>.<ext>`.**

The fixture is real-world source content with exactly one line matching the pattern:

```
conformance: comments=N directive=N doc=N groups=N
```

written inside a normal comment of the language (e.g. `# conformance: ...` for Bash). Also include a `source: <provenance path/URL/commit>` line. Count all comments — including the header and source lines — by hand to fill in the numbers. `languageForPath(<fixture-path>, <first-line>)` must return the language id.

The conformance suite (`test/languages/conformance.test.ts`) fails until this fixture exists.

**3. Update the README languages table.**

Add the language's row to the section between `<!-- languages:start -->` and `<!-- languages:end -->` in this file (the check does not rewrite it), then run `bun test test/languages/readme-languages.test.ts` to confirm the table matches the registry. The test names any missing or extra language ids.

**4. (Optional) A rule language hook.**

If a rule needs language-specific behaviour (e.g. a protected-comment list), add a branch inside that rule's code and list the new language in the rule's `languages` array. This is a rule language hook — owned by the rule, not the language adapter.

**5. Grammar variants (multi-grammar languages).**

A language that needs more than one grammar declares `grammarVariants` (each variant has `extensions` + `grammar`) and `defaultGrammarVariant` in its adapter. `grammarVariantForPath` picks the variant from the file extension. For a language with variants, `grammarFor(lang)` with no variant throws — "has grammar variants; bind the file path with parserForPath" — so bind the file path with `parserForPath` (`src/hooks/languages/parse.ts`) instead. `grammarsOf(lang)` lists every grammar, and the vendoring and strip-safety suites iterate it. Example: `typescript` uses `tree-sitter-typescript.wasm` (default `ts`) and `tree-sitter-tsx.wasm` (`jsx`: `.tsx`, `.jsx`, `.js`, `.mjs`, `.cjs`).

**6. Promote a language's autofix from preview to stable.**

1. Add one strip-safety fixture per grammar at `test/fixtures/strip-safety/<id>.<ext>`, with a `strip-safety: removed=N` header. It must contain over-budget comments plus that language's directives.
2. Run `bun test test/languages/strip-safety.test.ts`. All four checks (a parse, b code preserved, c directives/doc kept, d removed count) pass, and no preview todo remains for the language.
3. Classify the language's directives in its adapter (`classifyComments`) or `src/hooks/languages/tool-markers.ts`. Fix the classifier. Do not shape the fixture to fit it.
4. Add a `COMMENT_DENSITY_LANGUAGE_HOOKS` entry in `rules/comment-density/languages.ts` with `stability: "stable"`, plus `removalGrouping` / `repairAfterStrip` if needed.
5. Add a deployed-path e2e `test/deployed/<id>-autofix.by-path.test.ts` that spawns the hook by path (see `js-autofix.by-path.test.ts`).
6. Update the autofix-language text surfaces: `plugins/house-rules/README.md` (Rules table comment-density row; the Enforcement scope gate paragraph; the TypeScript/JavaScript coverage sentence) and `src/hooks/session-start.ts` (the house-rules paragraph injected at SessionStart; then update its measured byte/token row in `doc/instruction-budget.md`, which a test pins).

**Known preview gaps** (found in JS-01; the next promotion starts here):

- python: `# -*- coding: ... -*-` (PEP 263) is stripped. It must be classified as a directive.
- sql: `--` comments are never exempt, because `commentInnerText` keeps the `--` prefix.
- make: there is no directive category, so check (c) cannot pass.
