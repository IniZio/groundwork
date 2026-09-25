# Lens `slop`: scan checklist for a Housekeep scan subagent. Return Finding rows in the SKILL.md format (`| id | lens | severity | effort | auto-fix | location | finding | fix |`); do not edit.

## 8 smell categories

| Smell | Definition |
|---|---|
| **Duplication** | Repeated logic, copy-paste branches, redundant helpers |
| **Dead code** | Unused code, unreachable branches, stale flags, debug leftovers |
| **Needless abstraction** | Pass-through wrappers, speculative indirection, single-use helper layers |
| **Boundary violations** | Hidden coupling, misplaced responsibilities, wrong-layer imports or side effects |
| **Missing tests** | Behavior not locked, weak regression coverage, edge-case gaps |
| **UI/design defaults** | Generic visual patterns that make an AI-built interface feel unreviewed |
| **Redundant comments** | Narration, step markers, restatements. Keep: non-obvious *why*, invariants, gotchas, spec links, doc-comments |
| **Orphaned entry point** | A file in an entry-point directory (`hooks/`, `src/hooks/`, `plugins/*/src/hooks/`, `src/cli/`, `.claude/skills/*/scripts/`, `bin/`) that is not reachable from any manifest (`.claude-plugin/plugin.json` hooks, `plugins/*/.claude-plugin/plugin.json`, `hooks.json`, `package.json` bin/scripts, or the git-hook installer: `src/hooks/installer.ts` imports `hooks/lib/commit-msg-template.mjs` via a `file://` URL dynamic `import()` — `installer.ts:33`) or import graph starting at a live file. Dynamic `import()` calls (including `file://` URL imports) count as import edges. Two parallel implementations of one behaviour are SEV2; anything else unreachable is SEV3. A test that imports a file does not make it live. This check always runs repo-wide, independent of hot-spot scope. |

## Fix guidance

- Pass 1: Dead code deletion
- Pass 2: Duplicate removal
- Pass 3: Naming and error-handling cleanup
- Pass 4: Comment cleanup — remove narration, step markers, restatements; keep *why* rationale
- Pass 5: Test reinforcement

## Quality gates

- Regression tests green
- Typecheck and lint pass
