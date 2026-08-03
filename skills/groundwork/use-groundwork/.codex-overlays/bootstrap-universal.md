# Groundwork Universal Rules (Codex)

These rules apply to every role in the groundwork workflow.

## Core Rules (Non-Negotiable)

1. **No worktrees.** For new work, continue in the same session. Do not use `git worktree add` or similar.
2. **Never commit plans or design docs** to git. They live in `.groundwork/motives/` (gitignored) — never staged.
3. **Skill tool invocation (progressive disclosure).** Load skills when routing names them — they carry instructions not present in the bootstrap. If you start direct and hit ambiguity, stop and load the matching skill. Loading a skill unnecessarily is fine — better too much structure than too little. Skills are tools, not gatekeepers.
4. **Prefer watch/follow over polling.** For long-running or status commands use `--watch`/`--follow`/`-f`/`--tail`, or run the process in the background and check it once. Repeated one-shot calls waste tokens.
5. **Use compact evidence checks.** For ambiguity or impact, state the decision, evidence, and pass/fail criterion; do not repeat the full workflow bootstrap.

### Direct-write allowlist (destination-path gated, NOT judgment-gated)

You may write directly ONLY for content you already hold verbatim this turn, and ONLY under these destination paths:

- `.groundwork/**` EXCEPT `.groundwork/runs/**` and legacy `.groundwork/run.json` (the ledger is updated via the ledger CLI, never hand-edited)
- `.groundwork/out-of-scope/**`
- Session/project memory files (e.g. `memory/*.md` and its `MEMORY.md` index)

**Verbatim precondition:** if composing the content first requires reading or searching the codebase, that is exploration — do it deliberately, then write.

**Hard deny-floor** (never write here directly, regardless of the above): anything under `src/`, `test/`, `tests/`; any file matching build/behavior extensions (`.ts .tsx .js .mjs .cjs .json .yaml .yml .toml`, lockfiles, `Dockerfile`/`Containerfile`, CI configs); `package.json`, `tsconfig*`; and the orchestrator-rule files themselves (`bootstrap-orchestrator.md`, `bootstrap-universal.md`).

**Anti-creep tripwire:** if the doc's purpose is to carry a code or config change to be applied elsewhere, this exception does not apply — that is implementation, not coordination.

## Triage pre-check (before routing any new request)

- **Dedup against the rejection KB.** Scan `.groundwork/out-of-scope/*.md` and match **by concept, not keyword**. On a match, surface to the user (Confirm / Reconsider / Disagree) and append to *Prior requests* instead of re-planning.
- **Conflict → stop and ask.** Conflicting classification signals (trivial vs risky, bug vs feature) → state the conflict, ask before routing.
- **Negative scope is first-class** — state what is explicitly out of scope when you route.

## Skill Triggers

| Skill | Invoke when... |
|-------|----------------|
| `interview` | **Plan a feature** (synthesizes a concise plan). Before `diagnose` for complex bugs. Standalone for small changes. Anytime understanding is incomplete before action. |
| `diagnose` | **Any bug or regression.** Something broken that needs root cause analysis. Replaces the feature/`implement` path for bugs. |
| `implement` | **After a plan (features) or interview (small changes).** NOT for bugs. Runs `vertical-slice` first, then executes the slices. |
| `vertical-slice` | **Before executing slices.** Decomposes the task into conflict-free slices with wave assignments and writes the run ledger. |
| `ultrawork` | **Max fan-out mode.** Slice → write ledger → execute every independent slice. |
| `prototype` | **Design exploration.** Spike on uncertain approaches, test state models, explore UI layouts. Throwaway. |
| `housekeep` | **Codebase hygiene / cleanup.** Default mode `deslop`; scans and produces a severity-ranked findings backlog for triage before cleaning. |
| `commit` | Creating git commits (ensures consistent style). |
| `goal` | **Multi-step work needing focus tracking.** See "Session Goal" below. |

## Session Conventions

### Session Goal

For multi-step work, state a clear objective up front and re-establish it after context compaction. Codex does not inject goals into every turn. Keep the objective in the host's plan surface or a user-visible project note when needed; for short work, keep it in the current turn's plan. Do not create recurring reminders for ordinary turns.

### Learnings (docs/learnings.md)

Capture non-obvious gotchas discovered during any work session. Lazy-created at project root. Append-only.

**Add learnings when:** surprising framework behavior; non-obvious configuration; integration pitfall; test setup complexity; anything that made you say "I didn't expect that."

**Format:** one bullet per gotcha — `**<topic>**: <what happened, why it is surprising, what to do instead>`. Only genuinely surprising things; never committed to git (lives alongside plans in `.groundwork/`).

### Domain Glossary (CONTEXT.md)

See the `interview` skill for CONTEXT.md format and rules. Created and maintained during interview sessions.

## What NOT to Do

- **Do not use worktrees** (`git worktree add` etc.).
- **Do not commit plan, spec, or design markdown files.**
- **Do not skip the plan/slice step** for non-trivial work.
- **Do not declare work done without fresh evidence** from the relevant checks.
