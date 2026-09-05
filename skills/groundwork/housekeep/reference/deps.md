# Dependency hygiene mode

Audits the dependency graph for phantom packages, outdated releases, boundary violations, and resolution noise. Applies the shared 8-step spine from SKILL.md; this file provides the smell catalog, tooling, and passes specific to `deps`.

---

## Smell catalog

| Smell | SEV | Notes |
|---|---|---|
| **Phantom dep** | SEV3 (SEV2 if it inflates bundle) | Package in `package.json` but no import found in source |
| **Outdated dep — security gap** | SEV2 | Major-version gap that hides a security patch |
| **Outdated dep — feature only** | SEV3 | Newer non-breaking release available; no known CVE |
| **Dev dep in prod** | SEV3 | Package in `dependencies` imported only in tests or scripts, never in production source |
| **Circular dep** | SEV2 (SEV3 if type-only) | Two packages depend on each other at runtime |
| **Peer dep mismatch** | SEV2 | Declared peer requirement not satisfied by installed version |
| **Duplicate dep** | SEV3 | Same logical package appears under two names or versions in the resolution graph |
| **Unused transitive pinning** | SEV3 | `overrides`/`resolutions` entry for a package no longer transitively required |

Severity context bumps (±1 from SKILL.md shared rubric): a phantom dep in a published bundle is blast-radius SEV2; a peer mismatch that causes silent runtime coercion bumps to SEV1.

---

## Tooling

```bash
pnpm outdated                           # lists outdated deps with current/wanted/latest
pnpm ls --depth 0                       # lists direct deps and their resolved versions
npx depcheck                            # reports unused deps + missing deps
pnpm why <package>                      # traces why a dep is installed (transitive chain)
grep -rn 'import.*from' src/ | grep <package>   # verify actual usage in source
pnpm ls --depth Infinity 2>/dev/null | grep <package>  # find all resolution graph entries
```

For security patch detection: `pnpm audit` surfaces CVEs in the installed graph; pair with `pnpm outdated` to identify which outdated packages carry fixes.

---

## Passes

One smell class per pass. Complete each pass before starting the next.

**Pass 1 — Phantom and unused removal**
Run `npx depcheck`. For each reported unused package, confirm with `grep -rn` before removing — depcheck misses dynamic requires and some CLI-only packages. Remove confirmed phantoms. Update lockfile with `pnpm install`.

**Pass 2 — Security-patch updates**
Run `pnpm audit` and `pnpm outdated`. Focus on major-version gaps where a newer major carries a CVE fix. Update one package at a time; run `pnpm run check` after each to surface breaking changes early.

**Pass 3 — Dev/prod boundary correction**
Cross-reference `dependencies` vs `devDependencies` against actual import paths. Move packages used only in test or build scripts from `dependencies` to `devDependencies`. Run `pnpm install` to re-lock.

**Pass 4 — Duplicates, circulars, and resolution cleanup**
Use `pnpm why` to trace duplicate entries. Remove stale `overrides`/`resolutions` entries and confirm the package is no longer in the resolution graph. For circulars, document in a Finding and propose a re-architecture path rather than a blind removal.

---

## Quality gate

After all accepted passes:

```bash
pnpm install && pnpm run check
```

Both must exit 0. A type error introduced by a dep update is a blocker — revert the specific update and file it as a Deferred Finding with the breakage noted.
