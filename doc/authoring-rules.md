# Authoring rules — groundwork v2 agent and skill files

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
