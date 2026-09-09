---
id: enforcement-r-020
type: requirement
concept: C-ENFORCEMENT
title: Commit convention is concatenated from the project template and groundwork's universal rules, never derived
status: implemented
verification: verified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-020 — Commit convention is concatenated from the project template and groundwork's universal rules, never derived {#enforcement-r-020}

When groundwork enforces commit messages in a host repository, it **shall** CONCATENATE two sources rather than infer rules from either. The repository's `.gitmessage` supplies the project's own convention, carried verbatim as text for a human or agent to read and follow. Groundwork's universal rules apply on top and are machine-enforced. Groundwork **shall not** derive a subject grammar, an enumeration, or a length cap from the template, and **shall not** consult commit history to decide whether a rule applies. Concatenation is implemented in `hooks/lib/commit-convention.mjs` (`resolveHostRules`, `readCommitTemplate`, `activeConvention`).

**Universal rules** — stated in `UNIVERSAL_RULE_STATEMENTS` and enforced in every repository:

- Attribution trailers (`Co-Authored-By: Claude`, `Claude-Session:`, "Generated with Claude Code") are stripped automatically.
- Groundwork process vocabulary is rejected: gate cycle, dogfood cleanup, advisor APPROVE, slice ids, decision ids, motive slugs.
- **No commit body — subject line only.**

**Three repository classes** — every one of them enforces the universal rules:

1. **Host repo with a `.gitmessage`** — `resolveHostRules` returns `UNIVERSAL_RULES` (`enforce: ['body']`) together with the template's path and text. Groundwork imposes no subject shape, no type or scope enumeration, and no length cap; the project states those in its own template.
2. **Host repo without a `.gitmessage`** — there is nothing to concatenate, so groundwork's own convention (`GROUNDWORK_RULES`) applies in full: subject shape, 72-character cap, and the body rule.
3. **Groundwork's own repository** — unchanged; its hardcoded convention is the source of truth that `.gitmessage` and this spec are checked against.

**Observability** — `gw commit-lint convention` **shall** report the whole active ruleset for the current repository: which class it falls into, the project template path and text, the universal rule statements, whether a body is permitted, and which rule groups are enforced. Every field is present in every repository, so a caller reads which rules apply instead of inferring it.

**No inactive state** — this is the property the requirement exists to guarantee. Neither source can switch the other off. A template that mentions a body does not disable the body rule; a history full of bodies does not disable it either; an unparseable template disables nothing, because nothing is parsed for enforcement.

- **Why** — Derivation is inference, and inference has an inactive state. Under the previous derive-and-validate design a rule that failed to parse, or that the repository's own history contradicted, was silently dropped — and a dropped rule was indistinguishable from a rule that permits the thing. Agents cited the body rule as authority while it was off. Concatenation removes the state entirely: what is stated is what is enforced, and what is enforced is reportable.
- **Fit criterion** — Given a host repository with any `.gitmessage` (including one whose every line is `#`-commented, and one that declares a body section) over a history in which every commit carries a body, a commit message with a body is rejected, a commit message whose subject does not match groundwork's grammar is accepted, and `gw commit-lint convention` reports the no-body rule as active alongside the template text. Given a host repository with no `.gitmessage`, groundwork's full convention applies regardless of what its history looks like.
- **Verification**: verified — `test/hooks/commit-convention-concatenation.test.ts` drives `gw commit-lint convention` and `gw commit-lint report` against an all-commented, body-declaring template over a body-writing history; `test/hooks/commit-per-rule-oracle.test.ts` and `test/hooks/commit-host-convention.test.ts` cover the three repository classes across all enforcement surfaces.
- **Criticality**: must
