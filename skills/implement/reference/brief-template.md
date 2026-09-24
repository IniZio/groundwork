# Agent Brief Template

## Required first line

Every implementer brief MUST begin with:

```
SLICE: <id>
```

This line is parsed by the spawn-model-guard hook. When the named slice owns ≥3 files and the caller is not `groundwork:junior-orchestrator`, the guard **redirects** (does not deny) the spawn to `groundwork:junior-orchestrator`, prefixing the prompt with `[size-guard: slice <id> owns <N> files — redirected from implementer; split into ≤2-file leaves]`.

**Leaf exception**: if `Files owned` lists 1–2 entries and each is a slice file or sits under a slice directory, the spawn stays a leaf implementer. A list that is missing, unparseable, has >2 entries, or names a file outside the slice triggers a redirect. Omit `SLICE:` only if there is no active slice (the guard fails open).

Every spawn uses this template. Fill every field; send in ONE message before delegating.

## One-line statement (before delegating)

> Delegating to `<agent>` because `<why>`. Success check: `<verifiable outcome>`.

## Brief fields

**Slice ID** — the SLICE: <id> line (first line of brief).

**Goal** — one sentence: what behavior must exist when done. No process description.

**Files owned** — explicit list; parsed by spawn-model-guard (see SLICE rules above). Implementer touches only these. Accepted syntaxes — comma-separated on the same line:

```
Files owned: src/foo.ts, src/bar.ts
```

or `- ` / `* ` bullets on the lines that follow (rest of label line must be empty):

```
**Files owned:**
- src/foo.ts
- src/bar.ts
```

Label separator may be `:`, `—`, or `-`; separator may sit inside the bold (`**Files owned:**`) or outside (`**Files owned**:`). Backticks and a trailing `(…)` parenthetical are stripped from each entry.

**Files NOT owned** — explicit list. Read-only or hands-off. If uncertain, list here and ask.

**Success criteria (ACs)** — verifiable done-conditions, ≥1 per behavior. Written before implementation.

**Constraints** — hard limits: no new deps, stay under X lines, no schema changes, etc.

**Receipt format** — what the agent must return: STATUS / files changed / test output / bite proof.

## Size limit

≤3 files and ~200 lines per task. Larger scope = split into multiple slices before delegating.

## Bite proof requirement

Receipt must include a bite proof: break the behavior → confirm red → restore → confirm green.
Arguing correctness without running is not a bite proof.
Fixtures must be copied from real data in the codebase, not invented.
"Pre-existing failure" claims need a HEAD comparison (baseline run before any change).
