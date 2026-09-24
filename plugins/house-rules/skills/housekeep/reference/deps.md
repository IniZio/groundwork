# Dependency hygiene mode

Load when user selects `deps`. Shared spine, finding format, severity rubric, triage gate, and completion gate in `SKILL.md` apply.

## Smell catalog

| Smell | SEV | Notes |
|---|---|---|
| **Phantom dep** | SEV3 (SEV2 if it inflates bundle) | Package in `package.json` but no import found in source |
| **Outdated dep — security gap** | SEV2 | Major-version gap hiding a security patch |
| **Outdated dep — feature only** | SEV3 | Newer non-breaking release; no known CVE |
| **Dev dep in prod** | SEV3 | In `dependencies` but imported only in tests or scripts |
| **Circular dep** | SEV2 (SEV3 if type-only) | Two packages depend on each other at runtime |
| **Peer dep mismatch** | SEV2 | Declared peer requirement not satisfied by installed version |
| **Duplicate dep** | SEV3 | Same logical package under two names or versions |
| **Unused transitive pinning** | SEV3 | `overrides`/`resolutions` entry for a package no longer required |

## Tooling

```bash
pnpm outdated
pnpm ls --depth 0
npx depcheck
pnpm why <package>
pnpm audit
```

## Passes

**Pass 1 — Phantom and unused removal.** Run `npx depcheck`. Confirm with `grep -rn` before removing — depcheck misses dynamic requires and CLI-only packages.

**Pass 2 — Security-patch updates.** Run `pnpm audit` and `pnpm outdated`. Update one package at a time; run `pnpm run check` after each.

**Pass 3 — Dev/prod boundary correction.** Cross-reference `dependencies` vs `devDependencies` against actual import paths.

**Pass 4 — Duplicates, circulars, resolution cleanup.** Use `pnpm why` to trace duplicates. For circulars, document as a Finding and propose a re-architecture path.

## Quality gate

```bash
pnpm install && pnpm run check
```

Both must exit 0. A type error introduced by a dep update is a blocker — revert the specific update, file as Deferred.
