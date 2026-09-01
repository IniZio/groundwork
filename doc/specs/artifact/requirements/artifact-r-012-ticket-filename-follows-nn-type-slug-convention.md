---
id: "artifact-r-012"
type: requirement
concept: C-ARTIFACT
criticality: must
verification: unverified
status: open
design: "[[design/reference/slice-fields-reference]]"
---

## ARTIFACT-R-012 — Ticket filename follows NN-type-slug convention; type is a closed enum {#artifact-r-012}

When a ticket file is created, its filename **shall** follow the pattern `<NN>-<type>-<slug>.md`, where `<NN>` is a zero-padded two-digit ordinal unique within the motive's ticket corpus, `<type>` is one of the eight valid values (`research`, `choose`, `model`, `build`, `grill`, `spec`, `fix`, `chore`), and `<slug>` is a kebab-case description. The `Type:` metadata field in the ticket document **shall** match the filename type segment. The `type` field is a closed enum; any value outside the eight valid values **shall** be rejected.

- **Why** — A consistent filename convention enables deterministic id derivation from the stem, supports machine-parseable ticket corpora, and makes ticket type immediately visible in directory listings without opening each file. A closed enum prevents proliferation of ad-hoc type labels that cannot be mapped to ledger `--kind` values.
- **Fit criterion** — Creating a ticket with `type: research` produces a file named `NN-research-<slug>.md`; the in-document `Type:` field reads `research`; creating a ticket with `type: invalid` is rejected with an error naming the invalid value. All eight valid types produce correctly formatted filenames.
- **Verification**: unverified — Automated — the ticket creation path validates type against the enum before writing the file; tests cover each of the eight valid types and at least one invalid type rejection.
- **Criticality**: must

### Ticket type vocabulary

| Type | Intent | Maps to ledger `--kind` |
|---|---|---|
| `research` | Gather evidence; always requires a primary-source citation in Evidence | `plan` |
| `choose` | Evaluate options and commit to one | `plan` |
| `model` | Define or revise a domain model or schema | `design` |
| `build` | Implement a slice of production behaviour | `impl` |
| `grill` | Adversarial review or stress-test of a prior decision | `plan` |
| `spec` | Author or update a spec requirement | `plan` |
| `fix` | Diagnose and repair a defect | `diagnose` |
| `chore` | Housekeeping with no user-facing behaviour change | `impl` |
