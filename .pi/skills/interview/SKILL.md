---
name: interview
description: Interview-based planning skill. Ask one question at a time with recommended answers, cross-reference codebase, actively update CONTEXT.md and ADRs inline. Use BEFORE create-prd for features, or standalone for small changes and bug scoping.
---

# Interview

## Core Principle

**Understanding before synthesis.** Relentlessly interview about every aspect of a plan, resolving dependencies between decisions one-by-one. Each question comes with a recommended answer. Codebase exploration replaces questions when possible.

Interviewing is separate from PRD creation. When embedded in PRD creation, the agent conflates "understanding the problem" with "writing the spec" and does both poorly. Separation forces genuine Q&A before synthesis.

## When to Use

- **Before `create-prd`** for features — mandatory interview phase
- **Before `diagnose`** for complex bugs — scope before debugging
- **Standalone for small changes** — interview output serves as the lightweight spec
- **Anytime understanding is incomplete before action** — when the approach is unclear, user says "help me plan", etc.

**Do NOT use for:**
- **Trivial tasks** (<1h, fully specified, ≤2 files) — default to direct implementation. Load skills only when routing names them; don't force a heavy classification phase before every action.

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

1. **Ask EXACTLY one question at a time.** Formulate the question, provide your recommended answer, then STOP and wait for the user's response. Do NOT ask a second question in the same message. This is the most important rule.
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

### 1. Determine Scope

Ask: is this a bug, a small change (<1 day), or a feature (≥1 day)?

This determines what follows:
- **Bug** → hand off to `diagnose` (interview output is the bug scope)
- **Small change** → proceed to `bdd-implement` (interview spec IS the spec)
- **Feature** → proceed to `create-prd` (interview spec feeds the PRD)

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
2. **Propose next steps** — which skill follows (`diagnose`, `create-prd`, `bdd-implement`).
3. **Present via `question` tool** — user confirms next steps or requests more interviewing.

### 4. Persist Interview Spec

After synthesis and user confirmation, save the interview spec to a durable file:

**Path:** `docs/prds/interview/<slug>.md`
**Slug:** kebab-case identifier for the feature/change (e.g., `inline-todo-editing`, `auth-flow`)

**Format:**
```markdown
# <Title>

## Scope
<bug | small-change | feature>

## Decisions

- **<decision area>**: <what was decided>
- **<decision area>**: <what was decided>

## Acceptance Criteria

1. <criterion>
2. <criterion>

## Open Questions

- <anything still uncertain, or "none">
```

**Rules:**
- File is never committed to git (lives in `docs/prds/` which is gitignored)
- For features: this file feeds `create-prd` — the PRD is synthesized from it
- For small changes: this file IS the spec for `bdd-implement`
- For bugs: skip this step — bugs go directly to `diagnose`

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
