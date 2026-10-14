# 03 — `dockerfile.ts` classified as Dockerfile; TS rules skip it

Status: resolved
Priority: first (DECISION event 659)
Type: task
Source: dogfood run 2026-10-11 (research/dogfood-effectiveness.md)

## Bug

`languageForPath("plugins/house-rules/src/hooks/languages/dockerfile.ts")` returns `dockerfile` (verified at 9cc81ec3 via `bun -e`). Cause: plugins/house-rules/src/hooks/languages/registry.ts:129 `basenamePrefixes: ["Dockerfile.", "Containerfile."]` matched case-insensitively at registry.ts:285. Any `dockerfile.*` / `containerfile.*` source file (e.g. `dockerfile.ts`, `containerfile.test.ts`) skips every TS/JS rule. CLI misses 9 findings upstream reports in that file. Parity harness bypasses this registry, so parity never caught it.

## Acceptance (draft)

- `dockerfile.ts`, `Dockerfile.test.ts`, `containerfile.js` resolve to their extension language; `Dockerfile.prod`, `Containerfile.dev`, `Dockerfile` still resolve to dockerfile.
- Regression test through `languageForPath` and one through CLI `check` on a `dockerfile.ts` fixture (proves findings appear).
- Bug route: groundwork:debugger confirms fix design before implementer.

## Comments

### 2026-10-11 resolved

Fixed in 9ae1ab62 (slice PC-03): extension checked before basename prefix. Tests red at 9cc81ec3 (4 fail), green after; suites 4555/0 and 6073/0, tsc exit 0.
