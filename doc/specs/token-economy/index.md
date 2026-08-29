---
id: "C-TOKEN-ECONOMY"
type: "moc"
title: "Token Economy"
summary: "Groundwork defines prose-compression rules, per-surface intensity levels, and forbidden zones so that agent output stays terse without fabricating evidence or erasing meaning."
parent: null
status: "draft"
---

# Token Economy

The token-economy model governs how groundwork agents compress prose output to reduce input-token cost without introducing false claims or erasing meaning. It distinguishes three compression intensities, assigns each to a surface, and marks zones where compression is forbidden entirely.

> Start at [[design/_MOC]] for the reading path and curated design links.

---

## Quick links

| | |
|---|---|
| Design (folder) | [[design/_MOC]] |
| Compression concept | [[design/concepts/compression-model]] |
| Intensity levels concept | [[design/concepts/intensity-levels]] |
| Evidence surfaces concept | [[design/concepts/evidence-surfaces]] |
| Compression review flow | [[design/flows/compression-review]] |
| Compression rules (component) | [[design/components/compression-rules]] |
| Apply compression (recipe) | [[design/recipes/apply-compression]] |
| Intensity level reference | [[design/reference/intensity-levels-by-surface]] |

---

## Requirements

| Id | Title |
|----|-------|
| [[requirements/token-economy-r-001-prose-compression-rules-apply-to-agent-output\|R-001]] | Prose compression rules apply to agent output |
| [[requirements/token-economy-r-002-intensity-level-is-bounded-per-surface\|R-002]] | Intensity level is bounded per surface |
| [[requirements/token-economy-r-003-compression-is-forbidden-on-evidence-surfaces\|R-003]] | Compression is forbidden on evidence surfaces |
| [[requirements/token-economy-r-004-negation-and-scope-words-are-preserved\|R-004]] | Negation and scope words are preserved |
| [[requirements/token-economy-r-005-modality-is-preserved\|R-005]] | Modality is preserved |
| [[requirements/token-economy-r-006-no-invented-abbreviations-domain-vocabulary-preserved\|R-006]] | No invented abbreviations; domain vocabulary preserved |
| [[requirements/token-economy-r-007-asd-ste100-skill-is-at-v0-4-0-or-later\|R-007]] | ASD-STE100 skill is at v0.4.0 or later |
| [[requirements/token-economy-r-008-no-implementation-slice-assumes-a-clean-working-tree\|R-008]] | No implementation slice assumes a clean working tree |
