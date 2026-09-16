---
id: "artifact-r-012"
type: requirement
concept: C-ARTIFACT
criticality: must
verification: automated
status: open
design: "[[design/reference/slice-fields-reference]]"
---

## ARTIFACT-R-012 — Ticket filename follows NN-type-slug convention; type is a closed enum {#artifact-r-012}

When a ticket file is created, its filename **shall** follow the pattern `<NN>-<type>-<slug>.md`, where `<NN>` is a zero-padded two-digit ordinal unique within the motive's ticket corpus, `<type>` is one of the thirteen valid values (`analysis`, `build`, `chore`, `choose`, `decision`, `design`, `enhancement`, `feat`, `fix`, `grill`, `model`, `research`, `spec`), and `<slug>` is a kebab-case description. The ticket document's type field — `type:` in YAML frontmatter, or `Type:` as a bare header line in legacy tickets — **shall** match the filename type segment. The `type` field is a closed enum; any value outside the thirteen valid values **shall** be rejected.

- **Why** — A consistent filename convention enables deterministic id derivation from the stem, supports machine-parseable ticket corpora, and makes ticket type immediately visible in directory listings without opening each file. A closed enum prevents proliferation of ad-hoc type labels that cannot be mapped to ledger `--kind` values.
- **Fit criterion** — Creating a ticket with `type: research` produces a file named `NN-research-<slug>.md`; the ticket's type field (frontmatter `type:` or bare-header `Type:`) reads `research`; creating a ticket with `type: invalid` is rejected with an error naming the invalid value. All thirteen valid types produce correctly formatted filenames.
- **Verification**: Automated — `test/hooks/motive-ticket-cli.test.ts` ("invalid type is rejected": asserts exit 2 and stderr names the value; "all thirteen valid types": iterates `TicketType.options` and asserts exit 0 + `NN-type-slug.md` filename shape for each). `test/hooks/ticket-type-parity.test.ts` guards that `hooks/lib/ticket-types.mjs` stays in sync with `TicketType` in `src/gw/schema/ticket.ts`.
- **Criticality**: must

### Ticket type vocabulary

| Type | Intent | Maps to ledger `--kind` |
|---|---|---|
| `analysis` | Analyse data, behaviour, or a system to produce structured findings | `plan` |
| `build` | Implement a slice of production behaviour | `impl` |
| `chore` | Housekeeping with no user-facing behaviour change | `impl` |
| `choose` | Evaluate options and commit to one | `plan` |
| `decision` | Record a decision with its rationale and consequences | `plan` |
| `design` | Design a system component, architecture, or interface | `design` |
| `enhancement` | Extend or improve existing behaviour without fixing a defect | `impl` |
| `feat` | Implement a new user-facing feature end-to-end | `impl` |
| `fix` | Diagnose and repair a defect | `diagnose` |
| `grill` | Adversarial review or stress-test of a prior decision | `plan` |
| `model` | Define or revise a domain model or schema | `design` |
| `research` | Gather evidence; always requires a primary-source citation in Evidence | `plan` |
| `spec` | Author or update a spec requirement | `plan` |
