# Proof harness (agent-facing)

agents/qa.md carries the protocol; this file holds the advisor-rejects rule and the heal rule because qa.md and advisor.md are at the 1536-byte cap.

## Options

Script: scripts/proof-harness.sh.

| Flag | Effect |
|---|---|
| `--repo <path>`, `--prompt <text>` | Throwaway git repo (cwd) and prompt for `claude -p`. Required unless `--install-only` or `--check-log`. |
| `--plugin <path>` | Repo root holding the plugin manifest directory. Default: the script's own repo. |
| `--check-log <file>` | Skip install and run; check an existing `stdout.log` only. |
| `--install-only` | Add marketplace, install, list plugins, then exit. No billed call; exit status is the install status. |

Pass-through and housekeeping flags: `--agent`, `--settings`, `--model` (default `sonnet`), `--out`, `--keep-home`.

Claude Code does not add a dependency's marketplace for you. `--no-dep-marketplace` skips adding it, and with `--install-only` install exits 0 with a warning that `mattpocock-skills@mattpocock` was not installed, and groundwork shows `failed to load`. With the marketplace added, all three plugins show `enabled`.

`--plugin` copies the directory as is, untracked files included. A `node_modules` holding a broken symlink fails install with `ENOENT ... symlink`. Pass a clean export of the tree instead.

Exit codes: 0 all checks pass, 1 init check failed, 2 safety abort, 3 usage error.

## Deployed-path evidence

Any claim that a hook fires in a real session must be backed by a run through `scripts/proof-harness.sh`. `--plugin-dir` silently drops plugins that declare `dependencies`; never use it as evidence. Install path: see doc/proof-harness.md.

## QA evidence contract

QA output is tool-agnostic so human teammates keep their own tools (Argent, Playwright, agent-browser, Maestro). No tool is required; these are examples.

Every acceptance criterion (AC) gets one row:

[PASS|FAIL] <AC id>: evidence=<link> · replay=<flow path>

- evidence: one link a human opens in one click (video, trace, or screenshot pair).
- replay: path to a saved tool-native flow that reproduces the check without an LLM.
- Advisor rejects a report whose AC row lacks verdict, evidence, or replay.

### Flow index

Committed in the project beside its tests: qa/flows/index.md, or the project's own path. Any tool's native format; columns: flow, file, needs, leaves.

### Order

1. Replay a matching flow before exploring.
2. Explore only on miss; save every explored flow and add it to the index.
3. Healed replay (a replay that needed a re-explored step) reports PASS and overwrites the saved flow (DECISION 547). No advisor review of the heal.

### Parallel workers

Fan out one worker per flow group. Each worker gets an isolated browser session or device and its own seeded account.
