---
id: s0-eval-design
ticket_type: research
motive: obsidian-native-groundwork
---

# S0-EVAL-DESIGN — Eval design for spec/workflow shape changes

**Purpose.** Every change to the Markdown+frontmatter spec shape (index.md, requirements/, design.md) should be judged by evidence from groundwork's own sessions — not taste. This ticket designs the eval loop and its signals so future shape changes have a regression test bed built from dogfooding.

---

## Research summary

**Kiro** (kiro.dev/docs/specs/analyze-requirements/, kiro.dev/docs/hooks/, fetched 2026-08-29): their "Analyze Requirements" step does cross-requirement reasoning — inconsistencies, ambiguities, gaps across the full requirement set — streaming clarifying questions to chat; re-runnable after edits. Their PostFileSave hooks fire on spec-file saves and run arbitrary commands (continuous linting for free). Key insight: Kiro separates human-in-the-loop quality review from machine-enforced structural checks. Groundwork already has the machine side (spec-lint.mjs) but lacks an eval harness that aggregates the signal across sessions.

**GitHub Spec Kit**: could not fetch (404). General knowledge: constitution-based checklist + /speckit.analyze for cross-artifact consistency. Treats a spec as a multi-artifact contract with explicit traceability.

**claude plugin eval**: official docs returned 404. Session memory note (plugin-eval-ablation-unscores-Skill-grader.md): default --ablation with-without makes tool_used: Skill an unscored indicator; accuracy-task suites **must use --ablation none**.

**EARS / INCOSE**: INCOSE PDF 404. Kiro confirms EARS syntax (WHEN [condition] THE SYSTEM SHALL [behavior]). Groundwork's spec-lint already enforces normative-statement, why-required, fit-criterion — partial EARS conformance is live.

**Agent-workflow eval / LLM-judge** (data4sci.com/blog/building-an-advanced-agentic-harness, indexed 2026-08-29): deterministic checks first (cheap), LLM judge for survivors. "Worker produces, Critic evaluates." SWE-bench pattern: fresh agent given only the spec answers targeted questions; scored correct/total.

---

## Signals

Signals 1–3 require no new instrumentation — all capture infrastructure already runs.

### Signal 1 — LINT_DRIFT rate per session [HIGH]

**Measures.** How often spec invariants are violated per session. Rising rate = agents author the new shape incorrectly more often, or shape constraints are under-specified.

**Capture.** spec-lint.mjs already calls emitLintDrift() → journal LINT_DRIFT event for every violation. Aggregate: `bin/journal compile | grep LINT_DRIFT | wc -l` grouped by session field.

**Baseline.** Per-session LINT_DRIFT average from existing journal shards, computed before migration.

**Regression.** Rate increases >20% vs baseline, or new violation categories appear.

---

### Signal 2 — AC-coverage completeness and retraction ratio [HIGH]

**Measures.** (a) Fraction of motive ACs with ≥1 covering slice at motive close — low = ACs too abstract to claim. (b) AC_RETRACTION / AC_COVERAGE ratio — high = ACs ambiguously defined, agents claim then retract.

**Capture.** AC_COVERAGE emitted at `ledger complete --covers-ac` per slice×AC pair; AC_RETRACTION retracts mistaken claims. Both processed by motive-compile.mjs into Map<ac_key, Set<sliceId>>. Counts via `bin/journal compile --motive <slug> | grep AC_COVERAGE`.

**Baseline.** Completeness and retraction ratio from existing closed motives.

**Regression.** Completeness <80%, or retraction ratio >15%.

---

### Signal 3 — Struggle signals on spec file paths [HIGH]

**Measures.** file-thrash and fail-retry signals from struggle-detector.mjs where the fingerprint contains doc/specs/ (or requirements/ in the new layout). These specifically signal spec-shape comprehension breakdown — agent repeatedly rewrites the same file or retries after error.

**Capture.** .groundwork/struggle-signals.jsonl. Filter entries with doc/specs in fingerprint. Count per session.

**Baseline.** Last 10 sessions from struggle-signals.jsonl filtered to spec paths.

**Regression.** Signals/session on spec paths increase >30% vs baseline.

---

### Signal 4 — Agent comprehension task score [MEDIUM]

**Measures.** Given only index.md + requirements/*.md + design.md for one concept (no codebase), a fresh agent answers N=5–8 targeted questions: "which requirement covers X?", "is Y automated or manual verification?", "trace enforcement path for Z?". Score = correct/total. **This is the core dogfood signal** — directly tests whether the new shape is self-sufficient as agent context.

**Capture.** Author .claude/evals/spec-comprehension/<concept>.json eval suite per migrated concept. Run `claude plugin eval --ablation none` (must be none — with-without makes tool_used: Skill unscored per session memory note). Capture JSON output score.

**Baseline.** Run same suite against old shape for the same concept before migration.

**Regression.** Score <70%, or drops >15% vs old-shape baseline. Treated as a single-trigger gate (no "any two" rule — this signal has no confounders).

---

### Signal 5 — Decision re-litigation rate [MEDIUM]

**Measures.** DECISION journal events where a topic was already resolved in the same motive. The wikilink graph (D8) should make prior decisions discoverable; high re-litigation = decisions are buried or unlinked in the new shape.

**Capture.** `bin/journal compile --motive <slug>`; parse DECISION events by topic key; count duplicates. Alternatively add a counter to the DECISION handler in motive-graph-fold.mjs (already builds a decision map; duplicate keys detectable).

**Baseline.** Re-litigation count per motive from existing closed motives.

**Regression.** >2 re-litigation events per motive session average.

---

### Signal 6 — Spec-lint first-pass clean rate [MEDIUM]

**Measures.** Fraction of spec files authored in a session that trigger zero LINT_DRIFT events on the first spec lint pass. Higher = shape conventions are intuitive enough that agents get them right without feedback loops.

**Capture.** Cross-reference LINT_DRIFT events (journal, keyed by nodeId × session) against files edited in that session (from struggle-detector tally at .groundwork/runs/<sid>.detector.json). Requires a small aggregation script.

**Baseline.** Compute for existing spec shape before migration.

**Regression.** First-pass clean rate drops below 60%.

---

### Signal 7 — Cross-artifact orphan rate [LOW]

**Measures.** Fraction of requirements with no trace in design.md and no verifies: wikilink on any slice. Adapted from Kiro's cross-artifact analysis (kiro.dev/docs/specs/analyze-requirements/) — an orphan requirement was never claimed or referenced, a sign it is dead scope or too vague to connect to work.

**Capture.** New spec-lint invariant coverage-orphan (not yet implemented). Parse requirement IDs from requirements/*.md frontmatter; check design.md and all slice files for each ID or [[req-id]] wikilink.

**Baseline.** Not available until implemented; establish on first run.

**Regression.** >10% of requirements orphaned.

---

## Eval loop

**When it runs.**
- Per session, automatic: signals 1–3 and 5 captured by existing hooks with no new work.
- On spec-shape RFC merge: run spec lint full sweep + comprehension eval suite for every concept in the RFC's spec_delta. Trigger manually or via a PostFileSave hook on doc/specs/** (Kiro pattern, kiro.dev/docs/hooks/).
- Per motive close (stop gate): AC-coverage completeness and retraction ratio verified before advisor APPROVE.

**Where results land.**
- Signals 1–3, 5: already in journal shards, surfaced in MAP.md via motive-map.mjs.
- Signal 4 scores: new eval-notes/<concept>-<date>.md in the motive's vault dir, frontmatter {concept, score, shape_version, date}; wikilinked into the Obsidian graph.
- Shape-change summary: a ## Eval delta section in the RFC's rfc.md after migration.

**A/B comparison.** Migrate concept A under old shape; concept B under new D8 layout. Run the same comprehension eval suite against both with identical questions. Compare signals 1, 4, 6. Record in eval-notes/ab-<date>.md with delta table.

---

## Regression rules

A shape change is a regression if **any two** thresholds trigger simultaneously, or if **signal 4 alone** triggers.

| Signal | Threshold |
|---|---|
| LINT_DRIFT/session | >20% increase vs baseline |
| AC-coverage completeness | <80% at motive close |
| AC_RETRACTION ratio | >15% of AC_COVERAGE events |
| Struggle signals/session (spec paths) | >30% increase vs baseline |
| Comprehension score | <70%, or >15% drop vs old shape |
| First-pass clean rate | <60% |
| Re-litigation events | >2/motive avg |

Rationale for "any two": individual signals can move for reasons unrelated to shape quality (one complex concept inflates LINT_DRIFT). Signal 4 is a single-trigger gate — it directly measures agent comprehension with no confounders.

---

## Minimal first slice (~2h, real signal)

Before migration begins, establish baselines on the existing shape:

1. **LINT_DRIFT baseline**: scan last 5 session journal shards for LINT_DRIFT events → per-session average. Zero implementation work.
2. **Struggle baseline**: filter .groundwork/struggle-signals.jsonl for doc/specs paths → per-session average. Zero implementation work.
3. **Comprehension baseline**: author a 5-question eval suite (.claude/evals/spec-comprehension/stop-gate.json) for the stop-gate concept under the old shape. Run `claude plugin eval --ablation none`. Record score. (~1h eval authoring)

Migrate stop-gate to the new D8 layout and re-run step 3. This is the minimum A/B proof.

Full loop additionally requires: first-pass clean rate aggregation script (~2h), cross-artifact orphan spec-lint invariant (~4h), eval-notes/ vault section and `gw eval spec-shape` CLI (~4h).

---

## Confidence grades and sources

| Finding | Grade | Source |
|---|---|---|
| Signals 1–3 capturable today from existing hooks | HIGH | hooks/struggle-detector.mjs, hooks/spec-lint.mjs, hooks/journal.mjs (primary: repo) |
| AC_COVERAGE/AC_RETRACTION usable as signal 2 | HIGH | hooks/lib/motive-compile.mjs, hooks/lib/motive-graph-fold.mjs (primary: repo) |
| claude plugin eval --ablation none for accuracy tasks | MEDIUM | session memory note plugin-eval-ablation-unscores-Skill-grader.md; official docs 404 |
| Kiro cross-artifact consistency as prior art for signal 7 | MEDIUM | kiro.dev/docs/specs/analyze-requirements/ (official Kiro docs, 2026-08-29) |
| PostFileSave hook trigger pattern | MEDIUM | kiro.dev/docs/hooks/ (official Kiro docs, 2026-08-29) — adapted, not prescriptive |
| Deterministic-first / LLM-judge two-tier gate | MEDIUM | data4sci.com/blog/building-an-advanced-agentic-harness (secondary blog, 2026-08-29) |
| Signal 7 (orphan rate) capturable | LOW | proposed new invariant; no existing enforcement; no baseline |

---

## Known hazard — orchestrator persona injection into eval probes (S6-EVAL-SYSTEM-PROMPT-LEAK)

**Root cause (confirmed 2026-08-30).** `hooks/session-reminder.mjs` injects the groundwork orchestrator persona (CLAUDE.md + pacing/motive context) into every SessionStart that is not an embedded SDK agent. The guard at session-reminder.mjs:322 calls `isEmbeddedAgent()`, defined in `hooks/lib/hook-io.mjs:34-36`:

```js
export function isEmbeddedAgent() {
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT
  return ep === 'sdk-py' || ep === 'sdk-js'
}
```

`claude plugin eval` spawns probe agents as `claude -p` (CLI subprocesses), which set `CLAUDE_CODE_ENTRYPOINT=cli` — the same value as a normal interactive session. The guard therefore does not fire, and every probe agent starts believing it is the groundwork orchestrator.

**Two confirmed symptoms:**

(a) **`execution.system` in case.yaml is overridden.** The session-reminder injection is prepended to the system prompt. Any persona or constraint the case author places in `execution.system` is drowned out by the orchestrator identity, which dominates the model's self-image.

(b) **Trigger evals score 0% recall.** A probe that boots as the orchestrator answers every question by delegating with `Task()` instead of responding to the spec comprehension question. The grader sees no answer and scores incorrect.

**Why a guard cannot be added.** `CLAUDE_CODE_ENTRYPOINT=cli` is used by both eval probes and real interactive orchestrator sessions. No env var reliably distinguishes them at SessionStart time. Adding `cli` to the blocked set would suppress the orchestrator injection for real sessions — the opposite of the intent.

**Constraint for case authors.** Because `execution.system` is unreliable when eval suites are run inside this repo, **all grading constraints and persona instructions must live in `execution.prompt`**, not `execution.system`. The `prompt` field reaches the model as a user-turn message; it is not overridden by the hook injection. The `execution.system` field may be omitted or treated as best-effort.

**Surface (b) — external run_eval.py harnesses.** Any Python harness that resolves the project root to this repo and spawns `claude -p` in that directory triggers the same injection. Constraints must again live in the prompt, not the system field.
