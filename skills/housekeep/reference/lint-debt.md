# Lint and type-debt mode

Resolves accumulated TypeScript suppressions, `eslint-disable` comments, `any` annotations, and standing lint violations left unfixed in the working tree. Applies the shared 8-step spine from SKILL.md; this file provides the smell catalog, tooling, and passes specific to `lint-debt`.

---

## Smell catalog

| Smell | SEV | Notes |
|---|---|---|
| **`@ts-ignore` suppression** | SEV2 (SEV1 on critical path) | Silences a type error without fixing it; latent defect |
| **`@ts-expect-error` suppression** | SEV2 (SEV1 on critical path) | Same as `@ts-ignore`; at least self-documenting that an error was expected |
| **Dead suppression** | SEV4 | `@ts-expect-error` or `eslint-disable` whose target violation no longer exists; removing it is zero-risk |
| **`eslint-disable` — safety/correctness rule** | SEV2 | Disables a rule that prevents real defects (e.g. `no-eval`, `no-unsafe-*`) |
| **`eslint-disable` — style rule** | SEV3 | Disables a formatting or naming rule |
| **Untyped `any` at IO boundary** | SEV2 (SEV1 if security-relevant) | Unvalidated external input typed as `any` at an API, file, or network boundary |
| **Untyped `any` internal** | SEV3 | `any` annotation or unsafe cast inside non-boundary code |
| **Accumulated lint error** | SEV2–SEV4 | Violations present in `pnpm run check` output; SEV by rule class |

Severity context bumps (±1 from SKILL.md shared rubric): an `any` on a user-controlled input that reaches a database query is SEV1; a suppression on a type that was already validated upstream is SEV3.

---

## Tooling

```bash
pnpm run check                          # full TypeScript type check (exits non-zero on errors)
npx tsc --noEmit                        # same, without pnpm wrapper
pnpm run lint                           # ESLint violations
grep -rn '@ts-ignore\|@ts-expect-error\|eslint-disable' src/   # locate all suppressions
grep -rn ': any\|as any\| any\b' src/   # locate any annotations and casts
```

For a focused suppression inventory before triaging: pipe the grep output through `wc -l` to size the backlog, then sort by file to cluster related debt.

---

## Passes

One smell class per pass. Complete each pass before starting the next.

**Pass 1 — Dead suppressions**
Run `npx tsc --noEmit` with `@ts-expect-error` directives present. TypeScript itself flags dead `@ts-expect-error` directives (error TS2578: "Unused '@ts-expect-error' directive"). Remove each dead directive. Grep for `eslint-disable` lines and check whether the named rule still triggers on the surrounding code; remove any that don't. Commit after this pass — it is zero-risk and clears noise for later passes.

**Pass 2 — Resolve `@ts-ignore` / `@ts-expect-error`**
For each live suppression, read the surrounding code and reproduce the suppressed error in isolation (`npx tsc --noEmit`). Fix by: (a) correcting the type annotation, (b) adding a type guard, or (c) narrowing the type via a discriminated union. Remove the suppression directive only after the underlying error is gone. If fixing would require a large refactor, triage as Deferred with the underlying error documented.

**Pass 3 — Resolve `eslint-disable`**
For each active `eslint-disable`, identify the violating line(s). Fix the violation directly. If the rule is wrong for the context (e.g. a deliberate pattern the rule doesn't understand), add a targeted inline disable with a comment explaining why — never a file-level blanket disable.

**Pass 4 — Narrow `any` at IO boundaries**
Locate `any` usage at network, file, and IPC boundaries. Replace with a validated type: define a Zod schema or equivalent and parse input before it enters typed code. Internal `any` usage found in this pass is Deferred unless it blocks a boundary fix.

---

## Quality gate

After all accepted passes:

```bash
pnpm run check
```

Must exit 0. Net suppressions added must be zero or negative (removing debt, not accumulating it). If `pnpm run lint` is configured, it must also exit 0. A fix that introduces a new suppression to unblock another fix is a Finding, not a resolution.
