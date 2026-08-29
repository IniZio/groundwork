---
status: accepted
date: 2026-08-29
---

# File-backed artifacts over a database

## Context

Groundwork needs to persist run state (slices, gate verdicts), decision history, and spec requirements across sessions and across multiple simultaneous users or processes. Two broad storage approaches exist: a relational or document database, or plain files on disk.

Groundwork operates inside a developer's local working directory, often inside a git repository. It must work offline, without a server process, and without installation of any database daemon. The artifacts it produces (run ledgers, journal events, spec requirements) are also things that humans may want to read, diff in git, or inspect with standard tools.

## Decision

All groundwork artifacts are stored as plain files on disk:

- **Run ledgers**: `.groundwork/runs/<session_id>.json` — one JSON file per session
- **Journal events**: `.groundwork/journal/<session_id>.jsonl` — one JSONL file per session, append-only
- **Spec tree**: `doc/specs/**/*.md` — Markdown with YAML frontmatter, committed to the repo
- **Tickets**: `.groundwork/motives/<slug>/tickets/*.md` (or `tickets_dir` override)

Mutations go through the `ledger` and `journal` CLIs, not direct file edits, to ensure field invariants (e.g. `completed_at`, `session_id` on complete; HMAC seal on gate release).

## Consequences

**Benefits:**
- Zero infrastructure — no server, no daemon, no installation beyond Node.js
- Human-readable — any artifact can be inspected with a text editor or `cat`
- Git-compatible — spec requirements and (optionally) tickets are committed and diffable
- Offline-first — works on an airplane, in a container, in CI

**Trade-offs:**
- No native query capabilities — cross-session aggregation requires a compile step
- No atomic multi-file transactions — the seal (gate-seal.mjs) provides a tamper-evident check for the gate, but concurrent writes to the same ledger are not safe without external locking
- File proliferation — long-running projects accumulate many ledger and journal shards; the archive command (`journal motive archive`) provides lifecycle management
