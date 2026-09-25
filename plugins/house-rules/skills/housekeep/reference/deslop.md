# Lens `slop`: scan checklist for a Housekeep scan subagent. Return Finding rows in the SKILL.md format (`| id | lens | severity | effort | auto-fix | location | finding | fix |`); do not edit.

## 7 smell categories

| Smell | Definition |
|---|---|
| **Duplication** | Repeated logic, copy-paste branches, redundant helpers |
| **Dead code** | Unused code, unreachable branches, stale flags, debug leftovers |
| **Needless abstraction** | Pass-through wrappers, speculative indirection, single-use helper layers |
| **Boundary violations** | Hidden coupling, misplaced responsibilities, wrong-layer imports or side effects |
| **Missing tests** | Behavior not locked, weak regression coverage, edge-case gaps |
| **UI/design defaults** | Generic visual patterns that make an AI-built interface feel unreviewed |
| **Redundant comments** | Narration, step markers, restatements. Keep: non-obvious *why*, invariants, gotchas, spec links, doc-comments |

## Fix guidance

- Pass 1: Dead code deletion
- Pass 2: Duplicate removal
- Pass 3: Naming and error-handling cleanup
- Pass 4: Comment cleanup — remove narration, step markers, restatements; keep *why* rationale
- Pass 5: Test reinforcement

## Quality gates

- Regression tests green
- Typecheck and lint pass
