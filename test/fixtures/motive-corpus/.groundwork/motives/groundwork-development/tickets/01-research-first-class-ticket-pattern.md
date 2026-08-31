# First-class ticket pattern for groundwork

Type: research
Status: open
Blocked by: —

## Question

What defines the first-class ticket shape this motive is adopting, and how does it differ from the
auto-generated stubs that preceded it? Specifically: what sections are required, what makes a
citation "resolvable", what type vocabulary is sanctioned, and what does a RICH ticket look like
versus a stub?

## Context

Until 2026-08-06 the `tickets/` directory for `groundwork-development` held 29 auto-generated stub
files produced by motive-tickets tooling. Each stub carried only a Status + Details section and the
autogen footer `_Auto-generated — do not edit by hand._` — no Question, Evidence, Decision, Ruled
out, Revisions, or Links. The ledger slice G5 (D-79) authorises replacing them with a first cohort
of hand-authored "first-class" tickets in the mattpocock/nexus3 issue-doc style.

The format contract is codified in two places:

- `hooks/lib/motive-ticket-doc.mjs` — exports `REQUIRED_SECTIONS`, `renderTemplate`, `parseTicket`,
  and `lintResearchCitation`; the authoritative source on section names and the research-lint rule
- `doc/specs/artifact/data-model.md` (ARTIFACT-R-012) — closed type enum, filename convention
  `NN-type-slug.md`, and the requirement that `Type:` in the document matches the filename segment

The nexus3 project (`/home/newman/magic/nexus3/.scratch/nexus3-architecture/issues/`) provides
real exemplars: `01-research-herdr-crabbox.md` is a resolved research ticket in this style;
`13-fork-restore-mechanism.md` demonstrates a deeply evidenced grilling ticket with inbound
findings sections and a structured Answer.

## Evidence

**Required sections** (from `hooks/lib/motive-ticket-doc.mjs` line 24–32):
`Question`, `Context`, `Evidence`, `Decision`, `Ruled out`, `Revisions`, `Links` — all seven must
be present and non-empty for a ticket to pass the `lint` command.

**Research-lint rule** (`hooks/lib/motive-ticket-doc.mjs` lines 159–187): a `Type: research` ticket
must carry at least one _resolvable reference_ — a URL (`https?://`), relative file path (`./` or
`../`), absolute file path (`/word`), or a bare spec requirement id matching `[A-Z][A-Z0-9]*-R-\d+`
— in its `Evidence` or `Links` section. Without this the lint exits 1 with a descriptive message.

**Type vocabulary** (`doc/specs/artifact/data-model.md`, ARTIFACT-R-012): closed enum of eight
values: `research`, `choose`, `model`, `build`, `grill`, `spec`, `fix`, `chore`. Any other value is
invalid. The filename type segment must match the `Type:` metadata field.

**Filename convention** (`doc/specs/artifact/data-model.md`, ARTIFACT-R-012): `NN-type-slug.md`
where `NN` is a zero-padded two-digit ordinal unique within the motive's ticket corpus.

**Exemplar — research**: `/home/newman/magic/nexus3/.scratch/nexus3-architecture/issues/01-research-herdr-crabbox.md`
A resolved research ticket whose Answer section replaces the empty Decision body with a concise
verdict and a citation to a findings file. Demonstrates that research tickets need not remain
open forever: they graduate to resolved once the question has an answer.

**Exemplar — grilling**: `/home/newman/magic/nexus3/.scratch/nexus3-architecture/issues/13-fork-restore-mechanism.md`
Shows "Inbound findings from ticket X" subsections feeding a structured Answer — evidence layered
across multiple research runs before a decision is reached.

**Spec requirement for ticket entity** (`doc/specs/artifact/constraints.md`, ARTIFACT-R-007): "A
ticket is the durable work object authored by a human or agent; the no-delete invariant applies."

## Decision

**The first-class ticket shape is: seven required non-empty sections (Question/Context/Evidence/Decision/Ruled out/Revisions/Links), a Type from the closed eight-value enum, a filename of `NN-type-slug.md`, and — for research tickets — at least one resolvable primary-source reference in Evidence or Links.**

This is the contract already implemented in `hooks/lib/motive-ticket-doc.mjs` and
`doc/specs/artifact/data-model.md`; this ticket documents it as an explicit research finding so
future authors have a stable reference.

## Ruled out

- **Relaxing the "non-empty" requirement for any section.** Considered to reduce authoring friction,
  but the lint rule exists precisely because auto-generated stubs were empty-section tickets that
  provided no value. Keeping all seven sections required preserves the signal.

- **Allowing free-form type values.** The closed enum prevents category drift (e.g. "bug" vs "fix")
  and lets the MAP renderer group tickets by type correctly. Open vocabulary was rejected by
  ARTIFACT-R-012.

## Revisions

None yet.

## Links

- `hooks/lib/motive-ticket-doc.mjs` — source of truth for `REQUIRED_SECTIONS` and `lintResearchCitation`
- `doc/specs/artifact/data-model.md` (ARTIFACT-R-012) — closed type enum and filename convention
- `doc/specs/artifact/constraints.md` (ARTIFACT-R-007) — ticket entity and no-delete invariant
- `/home/newman/magic/nexus3/.scratch/nexus3-architecture/issues/01-research-herdr-crabbox.md` — research exemplar
- `/home/newman/magic/nexus3/.scratch/nexus3-architecture/issues/13-fork-restore-mechanism.md` — grilling exemplar
- Graduated from: G5 (ledger slice authorising this cohort)
