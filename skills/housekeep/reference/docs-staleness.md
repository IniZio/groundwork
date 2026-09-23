# Docs-staleness mode

Load when user selects `docs-staleness`. Shared spine, finding format, severity rubric, triage gate, and completion gate in `SKILL.md` apply.

Removes references to code that no longer exists, updates examples against the current API, and deletes documentation for removed features.

## Smell catalog

| Smell | Default SEV |
|---|---|
| **Dead API reference** — doc refers to a function, type, or config key that no longer exists | SEV2 (SEV1 for user-facing onboarding) |
| **Wrong file path** — doc references a moved or deleted file | SEV2 for onboarding context; SEV3 otherwise |
| **Stale example** — code example uses a deleted import or old API shape | SEV2 |
| **Deleted-feature doc** — section describing a removed feature | SEV3 (SEV2 if it actively misleads) |
| **Contradicted claim** — doc says X but code does Y | SEV2 |
| **Dead external link** — hyperlink returns 404 | SEV4 |

## Tooling

```bash
grep -rn '<symbol>' src/
find . -name '<filename>' -not -path '*/node_modules/*'
git log --follow -- <path>
```

## Passes

- **Pass 1 — Dead API references.** Grep each referenced symbol against source. Delete or update the doc.
- **Pass 2 — Wrong paths.** Find each referenced path. Update or remove the reference.
- **Pass 3 — Stale examples.** Read each code example against current imports and API shapes.
- **Pass 4 — Deleted-feature sections and contradicted claims.** Delete sections for removed features; update contradictions.

## Posture note

Deletion-favoring. Do not write new docs during a docs-staleness pass. Delete or update only.
