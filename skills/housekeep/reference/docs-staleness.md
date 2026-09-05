# Housekeep — docs-staleness mode

Load this file only when the user selects `docs-staleness` mode. The shared spine, finding format, severity rubric, triage gate, and completion gate in `SKILL.md` apply.

Docs-staleness removes references to code that no longer exists, updates examples against the current API, and deletes documentation for features that were deleted.

## Triggers

`housekeep docs`, `stale docs`, `dead comments`

## Smell catalog

| Smell | Definition | Default SEV |
|---|---|---|
| **Dead API reference** | Doc page, README, or inline comment refers to a function, type, or config key that no longer exists in source | SEV2; bump SEV1 for user-facing onboarding doc that causes setup failures |
| **Wrong file path** | Doc references a file or directory that has moved or been deleted | SEV2 for setup/onboarding context; SEV3 otherwise |
| **Stale example** | Code example in a README or doc comment uses a deleted import, an old API shape, or a deprecated pattern | SEV2 |
| **Deleted-feature doc** | An entire section describing a feature that was removed | SEV3; bump SEV2 if it actively misleads a reader |
| **Contradicted claim** | Doc says X but the code does Y | SEV2 |
| **Dead external link** | A hyperlink to a resource that returns 404 or has moved | SEV4 |
| **Stale CHANGELOG entry** | CHANGELOG references a migration or behavior that has since changed again | SEV4 |

Context bumps apply per the shared severity rubric (consequence × blast-radius): a misleading comment on a security boundary → SEV1; a dead link in an archived module → SEV4.

## Tooling

Verify a referenced symbol still exists:
```
grep -rn '<function-or-type-name>' src/
```

Verify a referenced file path:
```
find . -name '<filename>' -not -path '*/node_modules/*'
```

Trace renames and deletions:
```
git log --follow -- <path>
```

Spot-check an external link (use sparingly — do not curl every link):
```
curl -s -o /dev/null -w "%{http_code}" <url>
```

## Passes

- **Pass 1 — Dead API references:** grep each referenced symbol against source. Delete or update the doc.
- **Pass 2 — Wrong paths:** find each referenced path. Update or remove the reference.
- **Pass 3 — Stale examples:** read each code example against current imports and API shapes. Fix or delete.
- **Pass 4 — Deleted-feature sections and contradicted claims:** delete sections for removed features; update contradicted claims.

Re-read or re-run any relevant doc-build or linkcheck after each pass.

## Quality gates

- No doc references a symbol, type, or config key that does not exist in current source
- No code example imports from a path that does not exist
- No doc section describes a feature that has been removed from the codebase
- If a gate fails, fix or delete the offending doc — never leave a known-broken reference behind

## Posture note

This mode is deletion-favoring. Do not write new docs during a docs-staleness pass — that is a separate task. Delete or update only. If a doc deserves rewriting from scratch, route that as a separate writing task after this sweep closes.
