---
name: interview
description: One-question-at-a-time planning interview; synthesizes a concise plan that feeds vertical-slice.
---

# Interview

## Core Principle

**Understanding before synthesis.** Relentlessly interview about every aspect of a plan, resolving dependencies between decisions one-by-one. Each question comes with a recommended answer. Codebase exploration replaces questions when possible.

Interviewing is separate from writing the plan. When the two are conflated, the agent does both poorly — it half-understands and half-specifies. Separation forces genuine Q&A first, then a concise plan grounded in what was actually resolved.

## When to Use

- **Before implementing a feature** — full interview, then synthesize the plan
- **Before `diagnose`** for complex bugs — scope before debugging
- **Standalone for small changes** — interview output serves as the lightweight spec
- **Anytime understanding is incomplete before action** — when the approach is unclear, user says "help me plan", etc.

**Do NOT use for:**
- **Trivial tasks** (<1h, fully specified, ≤2 files, AND small verification surface (no real hardware, single platform, single-service or no live environment, ≤5 QA scenarios)) — default to direct implementation. Load skills only when routing names them; don't force a heavy classification phase before every action.

**Versus the planner agent:** when the research load itself — reading source across many files, searching for constraints, weighing architectural options — would burn orchestrator context before a single question can be framed, dispatch `Task(subagent_type="groundwork:planner", model="opus")` instead. The planner absorbs all of that codebase reading in its own context and returns only the plan file reference.

## Two Modes

### Quick Interview (for small changes)
- **3-4 questions max** — cover only the unclear aspects
- Focus on: boundaries, edge cases, acceptance criteria
- Skip: data model, architecture, error handling (unless relevant)

### Full Interview (for features)
- **8-10 questions** — cover all areas listed below
- Systematic exploration of the design tree
- Context updates (CONTEXT.md, ADRs) happen during full interviews

## Rules

1. **Ask EXACTLY one question at a time.** Formulate the question, provide your recommended answer, then STOP and wait for the user's response. MUST NOT ask a second question in the same message. This is the most important rule.
2. **Provide a recommended answer** for each question — grounded in codebase knowledge when possible.
3. **If a question can be answered by exploring the codebase, explore the codebase instead** of asking the user.
4. **Cap at 8-10 questions.** After that, synthesize what you know and propose next steps. User can always request more interviewing.
5. **Challenge fuzzy language.** When the user uses vague terms, propose precise alternatives.
6. **Discuss concrete scenarios.** Invent edge cases that force precision about boundaries.

## Five Concurrent Activities

During interviewing, these happen simultaneously:

1. **Challenge against the glossary** — when user uses a term conflicting with `CONTEXT.md`, call it out immediately.
2. **Sharpen fuzzy language** — propose precise canonical terms when user uses vague words (e.g., "account" → "Customer" vs "User").
3. **Discuss concrete scenarios** — invent edge-case scenarios that force precision about boundaries between concepts.
4. **Cross-reference with code** — check if code agrees with what user states; surface contradictions.
5. **Update docs inline** — capture resolved terms in `CONTEXT.md` immediately. Record architectural decisions in `docs/adr/` when they qualify.

## Workflow

### 0. Detect Project Planning Conventions (do this first)

Groundwork does not impose a heavyweight PRD format. Before synthesizing a plan, find out how **this project** already plans, and defer to it:

1. **Project planning skills/commands.** Check the available skills and `.claude/commands/` (and `commands/`) for a project-specific planning skill — e.g. a `/plan`, `/spec`, `/design-doc`, or `/rfc` command. If one exists, that is the canonical way to write the plan for this repo — use it instead of inventing a format.
2. **Project planning conventions.** Look for an existing plans directory or convention: `.groundwork/plans/`, `docs/rfcs/`, `docs/adr/`, `PLANNING.md`, or a `planner` agent's output. Match the existing format, location, and naming.
3. **Project instructions.** Honor any planning rules in `CLAUDE.md` / `AGENTS.md` (where plans live, whether they are committed, required sections).

**Order of preference:** project planning skill → project plans convention → groundwork's default concise plan (below). State which one you're using before writing. Never override a project's own planning workflow with groundwork's default.

### 1. Determine Scope

Ask: is this a bug, a small change (<1 day), or a feature (≥1 day)?

This determines what follows:
- **Bug** → hand off to `diagnose` (interview output is the bug scope)
- **Small change** → proceed to `implement` (interview spec IS the spec)
- **Feature** → synthesize the plan (Step 4), then `vertical-slice` → fan out `general-purpose`

### 2. Interview

For each area of uncertainty:

1. **Identify the question** — what decision needs resolving?
2. **Check codebase** — can this be answered by reading code? If yes, explore and state the finding instead of asking.
3. **Ask with recommendation** — pose the question, then provide your recommended answer with reasoning.
4. **Capture the resolution** — update your understanding.
5. **Update docs inline:**
   - **CONTEXT.md** — if a new domain term was crystallized, add it now. Pure language definitions only — no implementation details.
   - **docs/adr/** — only when ALL THREE are true: (a) hard to reverse, (b) surprising without context, (c) result of a real trade-off with genuine alternatives.

Areas to cover (adapt to context — not all apply to every situation):

- **Problem scope** — what exactly is broken / needed?
- **Boundaries** — what's in scope vs out of scope?
- **Edge cases** — what happens when...?
- **Integration points** — what existing systems are affected?
- **User impact** — who experiences this and how?
- **Data model** — what entities, relationships, state changes?
- **Error scenarios** — what can go wrong?
- **Acceptance criteria** — how do we know it's done?

### 3. Synthesize

After interviewing (or when hitting the 8-10 question cap):

1. **Summarize resolutions** — what was decided, what remains uncertain.
2. **Propose next steps** — which skill follows (`diagnose`, `implement`, or fan-out via `vertical-slice`).
3. **Present via `question` tool** — user confirms next steps or requests more interviewing.

### 4. Synthesize the Plan

After synthesis and user confirmation, write the plan to a durable file. **Use whatever planning convention you detected in Step 0.** Only fall back to the default below when the project has no planning skill or convention of its own.

- **Project planning skill exists** → invoke it; it owns the format and location.
- **Project plans convention exists** → write the plan there, matching the existing format/naming.
- **No project convention** → use groundwork's default concise plan at `.groundwork/plans/<slug>.md`.

The plan must stay **concise and durable** — describe behaviors, interfaces, and acceptance criteria, not file paths or line numbers (those go stale). It exists to feed `vertical-slice`, not to be an exhaustive document.

**Default concise plan format** (`.groundwork/plans/<slug>.md`, slug = kebab-case identifier):
```markdown
# <Title>

## Scope
<bug | small-change | feature>

## Decisions

- **<decision area>**: <what was decided>
- **<decision area>**: <what was decided>

## Acceptance Criteria

1. <observable, testable criterion>
2. <criterion>

## Out of Scope

- <explicitly not covered>

## Open Questions

- <anything still uncertain, or "none">
```

**Rules:**
- For features: this plan feeds `vertical-slice` — slices map to acceptance criteria, and the plan path becomes `plan_ref` in `.groundwork/run.json`.
- For small changes: this plan IS the spec for `implement`.
- For bugs: skip this step — bugs go directly to `diagnose`.
- Respect the project's commit policy for plans (groundwork's `.groundwork/` default is not committed).

**Seed the ledger at plan time (features only).** After writing the plan file, run `node ${CLAUDE_PLUGIN_ROOT}/hooks/ledger.mjs init` (using the write token surfaced at SessionStart) and then add a `plan`-kind entry: `ledger.mjs add planning --kind plan --desc "Plan written: <plan-path>"`. This creates the run before `vertical-slice` touches it, so vertical-slice's subsequent `add` calls append impl slices to the same run rather than creating a late-born ledger. If `vertical-slice` finds no existing run it will `init` its own; seeding here simply makes the ledger exist from the planning phase forward.

## Domain Glossary (CONTEXT.md)

Lazy-created at project root when interviewing resolves terminology ambiguity:

**Rules:**
- **Lazy creation** — only create when there's genuinely useful terminology to capture.
- **Glossary only** — pure language definitions. No implementation details, no specs, no scratchpad.
- **Grows only through interviews** — terms are added when sessions resolve ambiguities, not proactively.
- **Challenge contradictions** — if user or code uses a term differently from the glossary, flag it immediately.

**Format:**
```markdown
# Domain Glossary

## <Category>

- **Term** — One-sentence definition.
- _Avoid_: alternative names that should not be used.

## Relationships

- Term A relates to Term B via...
```

## Architecture Decision Records (docs/adr/)

Only create an ADR during interviewing when ALL THREE criteria are met:

1. **Hard to reverse** — changing this decision later would be costly
2. **Surprising without context** — someone reading the code later would ask "why?"
3. **Genuine trade-off** — real alternatives existed, not just one obvious choice

**Format:** `docs/adr/NNNN-<slug>.md` (sequential numbering). Minimalist — 1-3 sentences is fine. Optional sections: Considered Options, Consequences.

## What NOT to Do

- Do NOT write a PRD, spec, or any artifact during interviewing — understanding only (CONTEXT.md and ADRs are lightweight references, not specs)
- Do NOT ask more than one question at a time
- Do NOT skip the recommended answer for any question
- Do NOT interview indefinitely — respect the question cap
- Do NOT add implementation details to `CONTEXT.md`
- Do NOT create `CONTEXT.md` unless interviewing actually resolved terminology ambiguity
- Do NOT create ADRs for obvious or easily-reversible decisions
