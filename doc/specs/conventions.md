# Spec Authoring Conventions

This document is the normative authoring guide for all requirement files under `doc/specs/`. Every agent writing or reviewing specs follows these rules. An unenforced invariant is a wish; these rules are enforced by `spec lint` and `spec-guard.mjs`.

---

## 1. Principles

- One falsifiable assertion per requirement.
- A requirement without a rationale is incomplete. The absence of **Why** is the specific defect this format corrects.
- Frontmatter is typed metadata a tool reads. Prose in YAML cannot be rendered, linked, or fenced — it is invisible to Markdown renderers and unsearchable by prose queries. No normative content belongs there.
- An unverifiable fit criterion is a wish. If you cannot write a concrete observable outcome, the requirement is not ready.
- Cross-references are anchor links, never bare id text. A bare id cannot be navigated.

---

## 2. Frontmatter Is Metadata Only

Frontmatter fields are typed data consumed by the `spec` CLI, `spec-lint`, and `spec-guard`. They carry identity, provenance, and enumerated attributes. They never carry normative content. Parsers return `{data, content}` as separate objects; prose placed in YAML fields is stripped from the rendered page and cannot be linked, cross-referenced, or syntax-checked.

### 2.1 Concept Node Frontmatter

A concept node is the `README.md` at the root of a concept directory (e.g. `doc/specs/artifact/README.md`).

| Field | Required | Type / Enum | Notes |
|---|---|---|---|
| `id` | **required** | `C-<CONCEPT>` | Format: `C-[A-Z0-9]+(-[A-Z0-9]+)*`. Example: `C-ARTIFACT`. |
| `type` | **required** | `concept` | Always the literal string `concept`. |
| `title` | **required** | string | Human-readable concept name. |
| `summary` | **required** | string ≤25 words | Short index label. Derived from the H1 heading. Must NOT be a normative statement. |
| `parent` | **required** | string \| `null` | Parent concept id (e.g. `C-GROUNDWORK`), or `null` for the root concept. |
| `origin_rfc` | **required** | string | RFC uid that introduced this concept (e.g. `R-20260726-K4M2QX`). |

No other fields are permitted in concept node frontmatter.

### 2.2 Requirement Node Frontmatter

A requirement node lives in `doc/specs/<concept>/requirements.md` as an anchored H3 section. Each requirement's frontmatter is on the **containing file**, not per-section. The file-level frontmatter for `requirements.md` carries only `concept` and `origin_rfc` as a linking header; the per-requirement metadata appears in the body annotation line (§5).

However, when a concept's requirements are stored in a dedicated file (the new layout), the frontmatter applies to the file, not to individual requirements. The per-requirement identity and metadata are expressed in the body: the H3 heading carries the id, and the annotation line carries verification/criticality/source. The following field table applies to the per-requirement frontmatter of the **old** single-file-per-requirement layout (retained for reference during migration) and to any tool or lint that reads individual requirement files.

**Post-migration requirement frontmatter fields** (file-level, when `requirements.md` is a single consolidated file):

| Field | Required | Type / Enum | Notes |
|---|---|---|---|
| `id` | **required** | `<CONCEPT>-R-NNN` | Sequential, zero-padded 3 digits (e.g. `ARTIFACT-R-001`). Concept prefix is the directory name uppercased. |
| `type` | **required** | `requirement` | Always the literal string `requirement`. |
| `concept` | **required** | string | Owning concept node id (e.g. `C-ARTIFACT`). |
| `pattern` | **required** | `ubiquitous` \| `event` \| `state` \| `option` \| `unwanted` | The EARS pattern this requirement follows. |
| `verification` | **required** | `automated` \| `manual` \| `hybrid` | How this requirement is verified. |
| `status` | **required** | `active` \| `superseded` \| `withdrawn` | Lifecycle state. |
| `origin_rfc` | **required** | string | RFC uid that introduced this requirement. |
| `criticality` | optional | `must` \| `should` | Importance level. Defaults to `must` when absent. |
| `parent` | optional | string \| `null` | Parent requirement id, when this requirement refines another. |
| `summary` | optional | string ≤25 words | Short index label used by `spec index`. Must NOT duplicate the normative sentence; it is a navigation label only. |

Fields removed in this format: `ears` (normative sentence moves to body prose) and `verify` (fit criterion moves to **Fit criterion** bullet in body). These fields must not appear in new requirement files.

---

## 3. The Body Is the Requirement

The H3 heading and the body prose together constitute the complete requirement. The frontmatter carries only typed metadata; everything normative, explanatory, and verifiable lives in the body.

### 3.1 Canonical Requirement Shape

The following is a complete, copy-pasteable example. Downstream agents MUST use this exact structure.

```markdown
### ARTIFACT-R-001 — Ledger records slice completion {#artifact-r-001}

**When** a vertical slice is marked complete via the ledger CLI, `hooks/ledger.mjs`
**shall** persist the slice id, completion timestamp, and session id to
`.groundwork/runs/<session_id>.json`.

- **Why** — the Stop hook reads the ledger to gate session end; an entry without a
  session id cannot be attributed to the run that produced it.
- **Fit criterion** — after `ledger complete s3`, the `s3` entry carries non-null
  `id`, ISO-8601 `completed_at`, and `session_id` matching the completing session.
- **Verification** automated · **Criticality** must · **Source** R-20260726-K4M2QX
- **See also** [ARTIFACT-R-002](#artifact-r-002)
```

**H3 heading structure:** `### <ID> — <Short title> {#<id-lowercased>}`

The `{#<id-lowercased>}` attribute is the machine-readable anchor. It must immediately follow the title on the same line, with the id lowercased (e.g. `{#artifact-r-001}`).

### 3.2 Required Body Elements

Every requirement body must contain all of the following, in order:

**1. Normative sentence** (EARS-shaped, `shall` bolded)

The opening paragraph is a single sentence in EARS form (§4). The EARS keyword that opens the sentence is bolded; `**shall**` is bolded. This sentence is the normative assertion. It must be falsifiable: a reader must be able to construct a test that could prove it false.

**2. Why — rationale (REQUIRED)**

```
- **Why** — <rationale prose>
```

The rationale states the consequence of violation: why this rule exists and what breaks if it does not hold. ISO/IEC/IEEE 29148 §5.2.7 and Volere §6 carry rationale as a first-class element. A requirement without a **Why** is rejected by `spec lint`. One sentence is usually enough; two is the maximum.

**3. Fit criterion (REQUIRED)**

```
- **Fit criterion** — <observable outcome>
```

The Volere fit criterion is the measurable acceptance test: the concrete, observable condition that proves the requirement is satisfied. It must be specific enough that two engineers, reading it independently, would run the same test and agree on the result. "The system works correctly" is not a fit criterion. "After `ledger complete s3`, the `s3` entry carries non-null `id`, ISO-8601 `completed_at`, and `session_id` matching the completing session" is.

**4. Annotation line (REQUIRED)**

```
- **Verification** <value> · **Criticality** <value> · **Source** <rfc-uid>
```

The annotation line carries three typed attributes on a single bullet:

- **Verification**: `automated` | `manual` | `hybrid`
- **Criticality**: `must` | `should`
- **Source**: the origin RFC uid (same value as the `origin_rfc` frontmatter field)

**5. See also (optional)**

```
- **See also** [ARTIFACT-R-002](#artifact-r-002)
```

Cross-references to related requirements, as comma-separated anchor links. Omit this line if there are no cross-references. Never write bare id text (`ARTIFACT-R-002`); always link (`[ARTIFACT-R-002](#artifact-r-002)`).

---

## 4. EARS Is a Sentence Discipline, Not a Field

EARS (Easy Approach to Requirements Syntax), by Alistair Mavin, constrains the normative sentence to five patterns. These are sentence-level templates, not a field or frontmatter key. Pick the pattern that fits the requirement's trigger logic; use the template exactly; bold the opening keyword and `**shall**`.

| Pattern | Template |
|---|---|
| Ubiquitous | `The <system> **shall** <response>.` |
| Event-driven | `**When** <trigger>, the <system> **shall** <response>.` |
| State-driven | `**While** <precondition>, the <system> **shall** <response>.` |
| Optional-feature | `**Where** <feature included>, the <system> **shall** <response>.` |
| Unwanted-behaviour | `**If** <trigger>, **then** the <system> **shall** <response>.` |

The `pattern` frontmatter field records which of the five patterns applies: `ubiquitous`, `event`, `state`, `option`, `unwanted`. This field is typed metadata for tooling; the sentence in the body is the normative statement.

---

## 5. Anchors

Every requirement carries an `{#<id-lowercased>}` attribute on its H3 heading line. The anchor is:

- the **machine-checkable handle** — `spec lint` verifies anchor presence and uniqueness
- the **stable citation target** — tests cite `SPEC#artifact-r-001`; cross-references link to it

Anchors must be globally unique within the spec tree. The id lowercased is the anchor: `ARTIFACT-R-001` → `{#artifact-r-001}`.

Cross-references to requirements MUST be markdown anchor links:

```markdown
<!-- correct -->
[ARTIFACT-R-001](#artifact-r-001)

<!-- wrong — unfollowable, breaks tooling -->
ARTIFACT-R-001
```

---

## 6. Test Traceability — `@verifies`

A `@verifies` annotation in test source is the claim that a specific test verifies a specific requirement. The format is a `//` comment on or immediately above the relevant `describe` or `it` block, or embedded in the test title:

```
// @verifies ARTIFACT-R-001
// @verifies ARTIFACT-R-001, ARTIFACT-R-002
```

Multiple requirement ids MAY appear comma-or-space-separated on a single line. Ids follow the requirement id grammar: `<CONCEPT>-R-NNN` (§7).

**Where** — annotations live in `test/` and `tests/` source files, on the test that directly exercises the annotated requirement's behavior.

**Meaning** — an annotation is a truth claim, not a tag. The annotated test MUST actually assert the behavior the requirement specifies. A false `@verifies` (annotation present, behavior not asserted) is a defect worse than an unannotated gap: it reports coverage that does not exist.

**Enforcement** — `spec lint` enforces the following invariant: every requirement whose annotation line carries `**Verification** automated` MUST have at least one test citing its id via `@verifies`, or `spec lint` exits 1. `_generated/coverage.json` reports declared-vs-actual verification counts and lists every `automated` requirement that has no verifying test.

**Relationship to the `verification:` attribute:**

| Value | Meaning |
|---|---|
| `automated` | A `@verifies` test verifies this requirement. Machine-enforced by `spec lint`. |
| `manual` | Verified by a documented procedure; no `@verifies` annotation is expected or required. |
| `hybrid` | Both a `@verifies` test and a documented manual procedure apply. |

---

## 7. ID Scheme

Requirement ids are sequential per concept, zero-padded to 3 digits:

```
<CONCEPT>-R-NNN
```

Where `<CONCEPT>` is the concept directory name uppercased. Examples: `ARTIFACT-R-001`, `ENFORCEMENT-R-012`, `VERIFICATION-R-003`.

Rules:

- Start each concept's sequence at `001`.
- Never reuse a number within a concept, even if a requirement is withdrawn.
- Superseded requirements keep their original id; the replacement gets the next number.
- The concept prefix is the directory name, not the concept node id prefix. Directory `artifact` → prefix `ARTIFACT` (not `C-ARTIFACT`).

---

## 8. File Layout

```
doc/specs/
  README.md                       ← spec tree root (concept node C-GROUNDWORK)
  conventions.md                  ← this file
  _generated/
    index.md                      ← auto-generated by `spec build`
    index.json
  <concept>/
    README.md                     ← concept node (frontmatter + overview prose)
    requirements.md               ← all requirements for this concept, anchored H3 sections
```

**Concept `README.md`** carries: the concept node frontmatter (§2.1); a one-paragraph problem statement; explicit scope and non-goals; and key decisions or constraints. It is the entry point for understanding what the concept covers.

**`requirements.md`** carries all requirements for the concept as anchored H3 sections in id order. There is exactly one `requirements.md` per concept. Cross-concept references use anchor links pointing to the target concept's `requirements.md`.

**Why one file per concept, not one file per requirement:** No established requirements format uses one-file-per-requirement. That layout is an industrial requirements-database pattern. It fragments the read, makes cross-referencing awkward, and produces directory explosion (29 requirements → 29 files). A single anchored document is navigable, renderable, and diff-friendly.

---

## 9. Anti-Patterns

The following are prohibited. Each prohibition has a one-line reason.

| Prohibited | Why |
|---|---|
| Normative prose in frontmatter (any `ears:` or `verify:` field) | Frontmatter is invisible to renderers and cannot carry links or inline code. |
| A requirement body without `**Why**` | A requirement without rationale is structurally incomplete; `spec lint` rejects it. |
| A bare id cross-reference (`ARTIFACT-R-001` without a link) | Bare ids cannot be navigated; `spec lint` flags them. |
| An unfalsifiable fit criterion (`"the system works correctly"`) | A criterion no test can refute is a wish, not a specification. |
| A `summary` field that duplicates the normative sentence | `summary` is a ≤25-word index label for navigation; the sentence belongs in body prose. |
| A `requirements/` directory of per-requirement files | Abolished by RFC-0003; the layout is a one-file-per-concept `requirements.md`. |
| `shall` without bold (`shall` vs `**shall**`) | The bold is the machine-readable signal for `spec lint` pattern checking. |
