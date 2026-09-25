# Lens `lint-debt`: scan checklist for a Housekeep scan subagent. Return Finding rows in the SKILL.md format (`| id | lens | severity | effort | auto-fix | location | finding | fix |`); do not edit.

## Smell catalog

| Smell | SEV | Notes |
|---|---|---|
| **`@ts-ignore` suppression** | SEV2 (SEV1 on critical path) | Silences a type error without fixing it |
| **`@ts-expect-error` suppression** | SEV2 (SEV1 on critical path) | Same; at least self-documenting |
| **Dead suppression** | SEV4 | `@ts-expect-error` or `eslint-disable` whose target violation no longer exists |
| **`eslint-disable` — safety rule** | SEV2 | Disables a rule that prevents real defects |
| **`eslint-disable` — style rule** | SEV3 | Disables a formatting or naming rule |
| **Untyped `any` at IO boundary** | SEV2 (SEV1 if security-relevant) | Unvalidated external input typed as `any` |
| **Untyped `any` internal** | SEV3 | `any` annotation inside non-boundary code |

## Tooling

```bash
pnpm run check
npx tsc --noEmit
pnpm run lint
grep -rn '@ts-ignore\|@ts-expect-error\|eslint-disable' src/
grep -rn ': any\|as any' src/
```

## Passes

**Pass 1 — Dead suppressions.** TypeScript flags dead `@ts-expect-error` directives (TS2578). Remove each. Check `eslint-disable` lines for rules that no longer trigger.

**Pass 2 — Resolve `@ts-ignore` / `@ts-expect-error`.** For each live suppression, reproduce the suppressed error, then fix by correcting the annotation, adding a guard, or narrowing via discriminated union. If fixing requires a large refactor, triage as Deferred.

**Pass 3 — Resolve `eslint-disable`.** Fix the violation directly. If the rule is wrong for the context, add a targeted inline disable with a *why* comment.

**Pass 4 — Narrow `any` at IO boundaries.** Replace with a validated type (Zod schema or equivalent). Internal `any` found in this pass is Deferred unless it blocks a boundary fix.

## Quality gate

```bash
pnpm run check
```

Must exit 0. Net suppressions added must be zero or negative.
