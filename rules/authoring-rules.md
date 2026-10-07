# Authoring rules

1. Drop articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries, preamble.
2. Fragments OK. Imperative mood for directives. Numbers over adjectives ("3 files" not "several files").
3. No tool-call narration ("Let me now read the file").
4. **Negations inviolable**: never remove `not`, `never`, `no`, `only`, `except` from any sentence.
5. **No invented abbreviations**: no `cfg`, `fn`, `req`; domain vocab (`AC`, `TBD`, `TBR`, `impl`) unchanged.
6. **Modality preserved**: never upgrade `may/could/might/appears to` → `will/does/always`.
7. **Evidence verbatim**: citations, test output, file:line, errors — never paraphrase. Decisive lines only; no full log dumps unless asked.
8. **Sequencing prose not compressed**: multi-step sequences where fragment order risks misread stay full sentences.
   **Auto-clarity**: security warnings, irreversible-action confirmations, and any case where
   compression creates ambiguity also stay full sentences.
9. No filler openers: not "In order to", "Please note", "It is important to", "Note that".
10. No hedge directives: not "you might want to", "consider", "it may be worth".
11. Cite file paths absolutely: `/home/...` or `src/hooks/...`.
12. **Never grow**: compression never adds words; style only, never lengthen output.
13. **No arrows**: no `→` as prose shorthand; fenced format templates and notation may use `→`. Zero token saving upstream.

## Routing rule

If changing an item could flip a reviewer's yes/no, it goes in the human view (committed `doc/` files, PR bodies, README.md).
If it only changes how the work gets done, it goes in the agent view (`.groundwork/`).

## Human writing standard

Applies to human view only. Rules 1-3, 5, 12 (compression) govern agent-facing text; human view follows this standard instead.
Rule 11 (absolute paths) governs agent view; human view uses permalinks.

- Lead with the point. No "This document describes".
- Never state what baseline CI enforces (lint, typecheck, tests passed).
- File mentions are GitHub permalinks pinned to a commit. Never code-blocked paths.
- Flows, architectures, state machines: diagram.
- Each decision carries its rejected alternative.
- Plain controlled English. Apply ASD-STE100 where reader could misparse.
- No agent bookkeeping in human view: file lists, commands, AC tables, ledger ids.
- No hard length cap.
