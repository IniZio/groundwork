# Authoring rules — groundwork agent and skill files

## Compression rules (from caveman)

1. Drop articles (`a`, `an`, `the`) when meaning is clear.
2. Drop filler words: `just`, `really`, `basically`, `actually`, `simply`.
3. Drop pleasantries and preamble openers.
4. Fragments permitted where meaning is clear.
5. No tool-call narration ("Let me now read the file").
6. Imperative mood for directives.
7. Numbers over adjectives: "3 files" not "several files".

## Groundwork-specific rules

8. Negations inviolable: never remove `not`, `never`, `no`, `only`, `except` from an existing sentence.
9. No invented abbreviations: no `cfg`, `fn`, `req`. Domain vocabulary (`AC`, `TBD`, `TBR`, `impl`) unchanged.
10. Modality preserved: never upgrade `may/could/might/appears to` to `will/does/always`.
11. One idea per sentence.
12. No filler openers: not "In order to", "Please note", "It is important to", "Note that".
13. No hedge phrases as soft directives: not "you might want to", "consider", "it may be worth".
14. Line length ≤140 characters.
15. Cite paths absolutely when referencing files: `/home/...` or `src/hooks/...`.
16. Evidence verbatim: citations, test output, file:line references, error messages — never paraphrase.
    Decisive lines only; no full log dumps unless asked.
17. Sequencing prose not compressed: multi-step sequences where fragment order risks misread stay full sentences.
    Auto-clarity: security warnings, irreversible-action confirmations, and any case where
    compression creates ambiguity also stay full sentences.
18. Never grow: compression never adds words; style only, never lengthen output.
19. No arrows: no `→` as prose shorthand; fenced format templates and notation may use `→`. Upstream measured zero token saving.

## Routing rule

Agent-written specs, tickets, motives, designs and PR bodies split into a human view and an agent view.
If changing an item could flip a reviewer's yes/no, it goes in the human view (committed `doc/` files, PR bodies, README.md).
If it only changes how the work gets done, it goes in the agent view (`.groundwork/`).

## Human writing standard

This standard applies to the human view only. The compression rules above (dropped articles, fragments) apply to agent-facing text.
The human view follows this standard instead, so the two sets do not conflict.
Rule 15 (cite paths absolutely) applies to the agent view. The human view uses permalinks.

- Lead with the point. Never open with "This document describes".
- Never state what baseline CI enforces (lint, typecheck, tests passed).
- File mentions are GitHub permalinks pinned to a commit, never code-blocked paths.
- Flows, architectures and state machines are shown as a diagram.
- Each decision carries its rejected alternative.
- Write plain controlled English. Apply ASD-STE100 where a reader could misparse.
- No agent bookkeeping in the human view: file lists, commands, AC tables, ledger ids.
- No hard length cap.
