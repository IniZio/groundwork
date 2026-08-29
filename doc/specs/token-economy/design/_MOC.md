---
tags: [moc, token-economy, design]
---

# Token Economy — Design

Map of Content for the **Token Economy** design folder. Start here; follow the reading path below.

---

## Start here: reading path

```
1. concepts/compression-model      — what compression is and what it is not
2. concepts/intensity-levels       — the three named levels and their surface assignments
3. concepts/evidence-surfaces      — why evidence zones are compression-free
4. flows/compression-review        — how to review an output for compression compliance
5. components/compression-rules    — the full rule set as a design component
6. recipes/apply-compression       — step-by-step: compress an agent output
7. reference/intensity-levels-by-surface — quick lookup table while working
```

---

## Concepts — explanations (Diátaxis: understanding)

| Note | What it explains |
|------|-----------------|
| [[concepts/compression-model]] | What compression means in groundwork: word/sentence level, not idea level |
| [[concepts/intensity-levels]] | `lite`, `full`, `ultra` — definitions, surface assignments, why `ultra` is banned |
| [[concepts/evidence-surfaces]] | Which surfaces are forbidden zones and why false compression is more costly than over-verbosity |

---

## Flows — decision paths and procedures

| Note | What it traces |
|------|---------------|
| [[flows/compression-review]] | How to review an agent output for compression-rule compliance (step by step) |

---

## Components — design-system pages for concrete artefacts

| Note | What it describes |
|------|------------------|
| [[components/compression-rules]] | The full compression rule set: each rule, its surface, its guard-rail, and its verification method |

---

## Recipes — how-to guides (Diátaxis: task)

| Note | Goal |
|------|------|
| [[recipes/apply-compression]] | Apply compression rules to a draft agent output |

---

## Reference

| Note | What it covers |
|------|---------------|
| [[reference/intensity-levels-by-surface]] | Every surface → assigned intensity level → prohibited and required elements |

---

## Requirements (out-of-folder, same concept)

| Id | Title |
|----|-------|
| [[../requirements/token-economy-r-001-prose-compression-rules-apply-to-agent-output\|R-001]] | Prose compression rules apply to agent output |
| [[../requirements/token-economy-r-002-intensity-level-is-bounded-per-surface\|R-002]] | Intensity level is bounded per surface |
| [[../requirements/token-economy-r-003-compression-is-forbidden-on-evidence-surfaces\|R-003]] | Compression is forbidden on evidence surfaces |
| [[../requirements/token-economy-r-004-negation-and-scope-words-are-preserved\|R-004]] | Negation and scope words are preserved |
| [[../requirements/token-economy-r-005-modality-is-preserved\|R-005]] | Modality is preserved |
| [[../requirements/token-economy-r-006-no-invented-abbreviations-domain-vocabulary-preserved\|R-006]] | No invented abbreviations; domain vocabulary preserved |
| [[../requirements/token-economy-r-007-asd-ste100-skill-is-at-v0-4-0-or-later\|R-007]] | ASD-STE100 skill is at v0.4.0 or later |
| [[../requirements/token-economy-r-008-no-implementation-slice-assumes-a-clean-working-tree\|R-008]] | No implementation slice assumes a clean working tree |
