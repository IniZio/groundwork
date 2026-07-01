# Housekeep — lint-debt mode

Load this file only when the user selects `lint-debt` mode. The shared posture and completion gate in `SKILL.md` apply.

## When to use this mode

- Accumulated suppression/type-debt from AI-generated patches
- Pre-merge hygiene before opening a PR
- Recurring lint noise that nobody addresses

## Smells

| Smell | Definition |
|---|---|
| **Suppression drift** | `// eslint-disable`, `@ts-ignore`, `# type: ignore`, `//nolint`, `#![allow(...)]` accumulated over time |
| **Type-safety erosion** | `any`/`unknown` abuse, unchecked `as` casts, `!` non-null assertions hiding real nullability |
| **Format drift** | Files not following the project formatter (prettier/rustfmt/gofmt/black) |
| **Dead suppressions** | A disable whose underlying rule no longer fires — the suppression is now redundant |
| **Suppressed-but-trivially-fixable** | The disable is lazier than the fix would be |

## Passes

Order safest (zero-risk) to riskier (type rewrites).

- **Pass 1: Format drift** — run the formatter; zero-risk, no behavior change.
- **Pass 2: Dead suppressions** — remove disables that no longer fire; verify lint still passes.
- **Pass 3: Trivially-fixable suppressions** — fix the root cause, remove the disable.
- **Pass 4: Type-safety erosion** — replace `any`/casts with proper types; one module per diff.

Re-run lint + typecheck + tests after EACH pass.

## Quality gates (lint-debt-specific)

- Lint clean — and ZERO NEW suppressions added by this pass
- Typecheck clean
- Tests green
- The diff must show a NET DECREASE in suppression count — you are removing debt, not moving it elsewhere
