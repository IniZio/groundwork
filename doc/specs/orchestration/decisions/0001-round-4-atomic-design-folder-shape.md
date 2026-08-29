# ADR-0001: Round-4 Atomic Design Folder Shape for Orchestration

**Date:** 2026-08-29
**Status:** Accepted
**Deciders:** Newman Chow (session: obsidian-native-groundwork)
**Decision ref:** obsidian-native-groundwork#D-15

---

## Context and problem statement

The orchestration concept previously had its design captured as a flat `constraints.md` file with normative requirements inline. This made the spec hard to navigate, impossible to link atomically, and unsuitable for an Obsidian vault (no Wikilink graph, no MOC structure).

Four rounds of prototyping were conducted to find a spec shape that satisfies:
1. Atomic notes — each idea is a single, independently linkable file
2. Diátaxis structure — concepts / flows / components / recipes / reference separated
3. Requirements as first-class files — each requirement is its own document with YAML frontmatter
4. Mermaid diagrams as first-class citizens — embedded inline, not linked externally
5. No information architecture that requires opening 10 files to understand the concept

---

## Decision drivers

- Obsidian vault compatibility (Wikilinks, graph view, backlinks)
- Diátaxis documentation taxonomy (understanding / task / reference / explanation)
- Groundwork requirement schema (`id`, `title`, `concept`, `criticality`, `verification`, `ears_pattern`, `verification_method`, `status`)
- ConceptIndex schema (`id`, `type: moc`, `title`, `summary`, `status`, `parent`, `origin_decision_ref`)

---

## Considered options

1. **Round 1** — flat files, requirements in `constraints.md`, no design folder
2. **Round 2** — single `design.md` file with all concepts inline
3. **Round 3** — design folder with one big `overview.md`
4. **Round 4** — design folder with atomic notes + MOC index (chosen)

---

## Decision outcome

**Chosen option: Round 4 — atomic design folder.**

The design is split into five sub-folders (`concepts/`, `flows/`, `components/`, `recipes/`, `reference/`) each containing small, focused atomic notes. A `_MOC.md` file serves as the Map of Content and curates the reading path.

Requirements are first-class files under `requirements/` with full YAML frontmatter conforming to the groundwork requirement schema.

The `index.md` at the concept root carries ConceptIndexSchema frontmatter and links to the design folder and requirements.

### Positive consequences

- Every note is independently linkable and backlinkable
- The reading path is explicit and curated via `_MOC.md`
- Requirements are versionable independently of design rationale
- Mermaid diagrams live in the file that owns the concept, not a separate asset
- Obsidian graph view shows the full relationship topology

### Negative consequences

- More files to maintain (mitigated by clear ownership rules)
- Cross-links must be kept up-to-date when files are renamed (mitigated by stable filenames)

---

## Links

- Prototype source: `.groundwork/motives/obsidian-native-groundwork/prototype-spec-shapes/round-4-design-folder/orchestration/`
- Related concept: [[../index]]
- Requirements: [[../requirements/orchestration-r-001-orchestrator-delegates-non-trivial-implementation|R-001]] … [[../requirements/orchestration-r-004-every-decision-event-carries-a-structured-data-id|R-004]]
