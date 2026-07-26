# Technology

## Runtime

Node.js (v22+) with native ESM (`"type": "module"`). The hooks directory contains plain `.mjs` scripts runnable with `node hooks/<name>.mjs` — no build step required. TypeScript source lives in `src/` and is compiled with `tsc`; scripts also run directly via `node --experimental-strip-types`. The repo ships a `bun.lock` so Bun is a supported runtime for the test suite.

## Package manager

`pnpm` with a `pnpm-workspace.yaml`. Use `pnpm install` after checkout; `pnpm run check` type-checks; `pnpm test` runs the Vitest suite.

## Test framework

Vitest 3.x. Test files live in `test/` and `tests/`. Two pre-existing `deslop-guard` failures are known and are not regressions introduced by any single task. Run individual test files with `npx vitest run <path>` — never bare `pnpm test` from a subagent.

## TypeScript

`strict: true`, `target: ES2024`, `moduleResolution: NodeNext`. Path aliases: `#src/*` → `./src/*`, `#test/*` → `./test/*`.

## Key dependencies

- `js-yaml` / `yaml` — YAML parsing for hook CLIs and spec frontmatter
- `@sinclair/typebox` — runtime type validation
- `pi-subagents` — subagent dispatch SDK
- `@earendil-works/pi-*` — agent framework packages (pi-ai, pi-coding-agent, pi-tui)

## Hook CLIs

All CLIs in `hooks/` are zero-dependency Node.js ESM scripts. They share helpers from `hooks/lib/` (hook-io.mjs, spec-io.mjs). They use exit codes: `0` success, `1` operational failure, `2` usage error.
