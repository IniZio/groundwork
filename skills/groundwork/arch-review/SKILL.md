---
name: arch-review
description: Mid-session codebase architecture review. All exploration runs in isolated subagents so findings never pollute main context. Surfaces shallow modules, coupling smells, and testability gaps as an HTML report. Use between tasks to retrospect on architecture without bloating the session context window.
---

# Architecture Review

Surface architectural friction in the current codebase without polluting the main session context. All heavy exploration runs in subagents — only distilled findings enter your conversation.

## Glossary (use these terms exactly in all findings and reports)

- **Module** — anything with an interface and an implementation (function, class, package, file)
- **Deep module** — high leverage: significant behaviour behind a small interface
- **Shallow module** — low leverage: interface nearly as complex as the implementation
- **Seam** — where an interface lives; where behaviour can be altered without editing in place
- **Locality** — change, bugs, and knowledge concentrated in one place
- **Deletion test** — delete the module mentally: does complexity vanish (it was a pass-through) or reappear across N callers (it was earning its keep)?

## Context hygiene — choose your isolation level

This skill runs subagents to keep raw exploration output out of context, but the findings summary and grilling conversation still land in your main session. Two native Claude Code commands let you go further:

| Want | Do |
|---|---|
| Full branch isolation — review findings disappear if you don't like them | Type `/fork`, then invoke `/groundwork:arch-review`. Type `/resume` to roll back entirely, or keep the branch if findings are useful. |
| One quick question without any context cost | Skip this skill. Type `/btw [your architecture question]` directly — it's read-only, ephemeral, and never enters history. Best for "is this pattern ok?" asides, not full reviews. |
| Findings in main context (discuss and act on immediately) | Invoke `/groundwork:arch-review` directly — no fork needed. |

**Recommended default**: `/fork` before invoking. The branch costs nothing if you discard it.

## When to Use

- Between tasks: "how does the architecture look so far?"
- After implementing a feature: did we introduce new coupling or shallow modules?
- When repeated friction appears: same files touched in every change, test setup growing unwieldy
- User says "review the structure", "any concerns about the codebase?", "improve architecture"

## Process

### Phase 1 — Explore in parallel subagents

**NEVER explore directly. Every byte of exploration output must stay out of main context.**

Spawn multiple `Explore` subagents simultaneously — one per codebase area. Adapt the areas to the actual project shape, but typical targets:

- Core domain / business logic
- Entry points (routers, controllers, CLI commands, event handlers)
- Data layer (persistence, queries, models)
- Shared utilities / helpers
- Test structure

Each subagent prompt (fill in `[AREA]`):

```
Explore [AREA] in this codebase. Return ONLY structured findings — no prose padding.

For each issue found, return:
- file: path/to/file.ts (+ line range if relevant)
- type: shallow_module | tight_coupling | testability_gap | pass_through | naming_inconsistency
- summary: one sentence describing the friction
- deletion_test: pass | fail | n/a
- strength: strong | worth_exploring | speculative

Limit: top 5 findings per area. Be specific — file paths and function names, not vague descriptions.
```

**Collect all findings as Task return values. Do not log them into your conversation.**

After all subagents return: deduplicate by file, discard `speculative` findings that duplicate stronger ones, and keep ≤15 candidates total for the report.

### Phase 2 — HTML report

Write a self-contained HTML report to the OS temp directory:

- Resolve temp dir: `$TMPDIR` → `/tmp` (Linux/macOS) → `%TEMP%` (Windows)
- Filename: `arch-review-<timestamp>.html`
- Use **Tailwind via CDN** for layout and **Mermaid via CDN** for graph-shaped diagrams
- Open with: `xdg-open` (Linux), `open` (macOS), `start` (Windows)
- Print the absolute path

Each candidate renders as a card:

| Field | Content |
|---|---|
| **Files** | Which files/modules are involved (with paths) |
| **Problem** | Why this causes friction — use Glossary terms |
| **Solution** | What deepening would look like |
| **Benefit** | Locality gained, leverage gained, testability improvement |
| **Before/After diagram** | Side-by-side — Mermaid for call graphs/dependencies; hand-crafted divs for depth/mass |
| **Strength badge** | `Strong` · `Worth exploring` · `Speculative` |

End the report with a **Top recommendation** section: which candidate to tackle first and why.

**Do NOT propose concrete interfaces or implementation details in the report.**

After writing the report, present a compact list to the user (≤12 lines total):

```
Architecture review complete. Found N candidates:

1. [Title] — [one-line problem] (Strong)
2. [Title] — [one-line problem] (Worth exploring)
...

Report: /tmp/arch-review-<timestamp>.html
Which would you like to explore?
```

### Phase 3 — Grilling loop

Once the user picks a candidate, enter a conversational grilling loop:

- Walk through constraints, dependencies, the shape of the deepened module
- What sits behind the seam? What callers simplify? What tests would survive?
- Challenge shallow reasoning: "if we deleted this module, where does the complexity go?"

Side effects as decisions crystallize:

- **New concept not in project docs?** → Offer to add it to `CONTEXT.md` (create lazily if absent). Use project domain vocabulary, not generic terms.
- **User rejects with a load-bearing reason?** → Offer an ADR: _"Want me to record this so future reviews don't re-suggest it?"_ Only offer when the reason would genuinely matter to a future explorer — skip ephemeral reasons ("not now") or self-evident ones.
- **Ready to act?** → Route to `groundwork:general-purpose` with: the candidate description, agreed interface shape, and success criteria.
- **Durable architectural lesson?** → If a finding represents a recurring pattern or a lesson that applies beyond this codebase (not a one-off), invoke `/retrospective` to persist it in the Learnings KB. The HTML report is ephemeral; `/retrospective` is not.

## Context budget rules

These are mandatory, not advisory:

1. **Phase 1 output never enters your context directly.** Collect findings via Task return values only.
2. If a subagent returns more than 20 lines, ask it to summarise to ≤10 bullets before returning.
3. Use `ctx_batch_execute` for any file-count or structural analysis — never sequential Bash grepping.
4. Your summary to the user after Phase 2 is ≤12 lines. The HTML file is the full artifact.
5. **No files created in the repo.** Temp dir only.

## Completion gate

After Phase 2, invoke `advisor-gate` with:
- Total candidates found and their strength distribution
- Top recommendation + rationale
- Any ADRs that would be contradicted

`advisor-gate` response governs:
- **APPROVE** → present to user as written
- **REVISE** → tighten recommendations (too speculative? re-rank) and re-run advisor-gate
- **REJECT** → tell user "analysis too speculative for this codebase shape — need to scope narrower" and re-enter Phase 1 with a single focused area

## What NOT to Do

- Do not read raw file contents into your conversation to find patterns — that's subagents' job
- Do not propose implementation details before the user picks a candidate
- Do not run sequential grep calls — one `ctx_batch_execute` covers all discovery
- Do not create files in the repo — temp dir only
- Do not skip `advisor-gate` even when findings seem obvious
- Do not conflate this with `diagnose` — this skill finds architectural friction, not bugs
