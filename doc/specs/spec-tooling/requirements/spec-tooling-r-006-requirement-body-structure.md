---
id: SPEC-TOOLING-R-006
type: requirement
concept: C-SPEC-TOOLING
title: Requirement Body Structure
summary: Every requirement body must have a bolded shall sentence, Why rationale, and Fit criterion.
status: draft
verification: manual
criticality: must
---

## SPEC-TOOLING-R-006 — Requirement Body Structure {#spec-tooling-r-006}

Every requirement body **shall** contain: (1) an EARS normative sentence with `**shall**` bolded (or `**shall not**` for prohibitions); (2) a `- **Why** —` rationale bullet whose text is a concrete engineering consequence — filler phrases such as "ensures correctness" or "maintains consistency" are prohibited; (3) a `- **Fit criterion** —` bullet stating an observable pass/fail condition; (4) `- **Verification**:` and `- **Criticality**:` annotations. There is no `ears:` and no `verify:` frontmatter field; frontmatter is metadata only, and using either field in frontmatter is an error (`stale-frontmatter` violation).

- **Why** — Without a mandatory Why and Fit criterion, requirements accumulate that cannot be reviewed, challenged, or verified. Filler rationale ("ensures correctness") provides zero information about the engineering consequence, making triage impossible.
- **Fit criterion** — `./bin/spec lint` exits 1 on a requirement file that omits `**shall**` from its body (`normative-statement` violation), exits 1 on a file missing `**Why**` (`why-required` violation), and exits 1 on a file missing `**Fit criterion**` (`fit-criterion` violation). A requirement file that includes an `ears:` or `verify:` frontmatter key triggers a `stale-frontmatter` violation.
- **Verification**: manual — inspect `hooks/spec-lint.mjs` for the `normative-statement`, `why-required`, `fit-criterion`, and `stale-frontmatter` invariant implementations.
- **Criticality**: must
