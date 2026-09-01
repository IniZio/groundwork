---
id: SPEC-TOOLING-R-010
type: requirement
concept: C-SPEC-TOOLING
title: CLI Invocation Contract
summary: The spec CLI must be invoked as ./bin/spec; node bin/spec fails. Exit codes are 0, 1, and 2.
status: draft
verification: manual
criticality: must
---

## SPEC-TOOLING-R-010 — CLI Invocation Contract {#spec-tooling-r-010}

`bin/spec` **shall** be invoked as a path (e.g. `./bin/spec lint`) and **shall not** be invoked as `node bin/spec lint`; the wrapper resolves its own real location via `readlink` so that it works both as a direct path and as a symlink on `$PATH`. Exit codes across all subcommands **shall** follow: `0` — success; `1` — operational failure (violations found, file not found, index stale); `2` — usage error (unknown subcommand, invalid flag). The `type_names` check for manifest lint runs only when `language` is `typescript`; for any other language it emits an informational skip message and exits 0.

- **Why** — `node bin/spec lint` bypasses the `readlink` resolution in the bash wrapper and fails to locate `hooks/spec.mjs` relative to the script's symlink-resolved path. Undocumented or inconsistent exit codes make the CLI unsafe to use in CI pipelines (`if ./bin/spec lint; then …` must be reliable).
- **Fit criterion** — `./bin/spec lint` exits 0 on a clean corpus. `./bin/spec --help` exits 0 and prints usage. `./bin/spec unknowncmd` exits 2. A spec.yaml with `lint.data-model.type_names.language: ruby` causes `spec lint` to print a skip message rather than a violation.
- **Verification**: manual — run `./bin/spec lint`, `./bin/spec --help`, and `./bin/spec unknowncmd`; record exit codes. Inspect `hooks/spec-lint.mjs:927–943` for the language guard.
- **Criticality**: must
