<!-- This file is generated. Do not edit manually. -->

# pr-body

Keeps PR bodies and doc pages readable. Off by default; enable with {"rules":{"pr-body":"error"}} in .house-rules.json. Flags a sentence over 25 words, a semicolon or mid-sentence colon that joins clauses, a bare path:line or backticked path outside a link label, a github.com /blob/ link whose ref is not a commit sha, and, in a PR body, a sentence that reports a baseline command (make lint, cargo test, bun test, tsc and similar) as passing, because CI already shows it. A PR body must also have the Why and Scope headings and may use only the headings Why, What changed, Scope, Tradeoffs, Blast Radius, Verification and Review tier. A failing `gh pr create|edit` is denied, and so is a top-level PR comment (`gh pr comment`, or a `gh api` POST to repos/<o>/<r>/issues/<n>/comments), because proof and updates belong in the PR body. If this bun has no Bun.markdown the prose check is skipped with a notice; a doc write under doc/, docs/ or README.md gets an advisory.

> Not in policy.

**Edit-time check**: no | **Languages**: none

## Allowed

### short sentences with one fact each

```
## Why

The client printed no output. Users saw only progress lines.

## Scope

The run log is unchanged.
```

### a colon that ends a line before a list

```
## Why

Two things changed:

- The log is followed.
- The frame is new.

## Scope

No protocol change.
```

### a path inside a link label that points at a commit sha

```
## Why

See [`client.rs`](https://github.com/o/r/blob/6406f6368908bd787d57cfaeaf95635c97149ae0/client.rs#L1) for the loop.

## Scope

One file.
```

## Flagged

### a semicolon joins two clauses

```
## Why

The log is followed; the frame is new.

## Scope

One file.
```

**Expected findings:**
- a semicolon joins clauses; split it into two sentences

### a colon joins clauses mid-sentence

```
## Why

One test changed: the registry counts 26 kinds.

## Scope

One file.
```

**Expected findings:**
- a colon joins clauses mid-sentence; split it into two sentences

### a blob link pinned to a branch name

```
## Why

See [the loop](https://github.com/o/r/blob/main/client.rs).

## Scope

One file.
```

**Expected findings:**
- blob link ref "main" is not a commit sha (7-40 hex digits)

### a PR body without the required Scope heading

```
## Why

The client printed no output.
```

**Expected findings:**
- PR body has no "## Scope" heading
