---
name: interview
description: Capture intent relentlessly, one question at a time; produce a motive charter when the frontier is empty.
---

# Interview

A model-invoked questioning primitive. Ask one question per message with a recommended answer; run five concurrent activities throughout; stop when the frontier is empty and the user confirms shared understanding. Callers declare the entry condition and what to do with the output.

## Protocol

One question per message. Always attach a recommended answer grounded in codebase knowledge when possible. Wait for the response before asking another.

When the answer to a question is discoverable by exploring the codebase — read source, check conventions, locate ADRs — do that instead of asking. Facts are yours to find; decisions belong to the user.

Challenge fuzzy language and propose canonical terms. Invent concrete edge-case scenarios to test stated boundaries.

## Five Concurrent Activities

Run throughout every session:

1. **Glossary challenge** — when a term conflicts with `CONTEXT.md`, call it out immediately and propose the canonical form.
2. **Sharpen language** — convert vague quantifiers ("fast", "sometimes", "most") to measurable or enumerable forms.
3. **Scenarios** — invent concrete edge cases that force precision about concept boundaries.
4. **Cross-reference code** — for each stated requirement, locate the nearest existing code and surface contradictions or prior art.
5. **Inline document** — update or create `CONTEXT.md` when the session resolves terminology (pure language definitions only, no implementation details). Record ADRs using the project's existing convention when ALL THREE hold: (a) hard to reverse, (b) surprising without context, (c) result of a genuine trade-off.

## Workflow

**0. Detect conventions** — Before the first question, read the project's planning conventions: existing `CONTEXT.md`, any ADR directory, `CLAUDE.md` for motive/ticket patterns, any project planning skill in `skills/` or `.claude/commands/`.

**1. Question loop** — Ask the frontier one question at a time. The frontier is every open decision whose prerequisites are already settled. A question whose answer depends on an unsettled answer belongs to a later message. Cap at 8–10 questions; synthesize after the cap or when the frontier is empty.

**2. Synthesize** — Summarise what was decided, what was explicitly left open (TBD), and what was ruled out. Confirm with the user that understanding is shared before proceeding.

**3. Produce charter** — Write the motive charter with agreed scope, acceptance criteria, and open items, following the convention detected in Step 0. The charter is the output of this primitive; the caller decides what to do with it next.

## Named Failure Modes

**Interview conflated with plan-writing** — synthesising before the frontier is empty produces a half-understood, half-specified charter. Understanding must precede synthesis; the frontier must be empty and confirmed before Step 2 begins.

**Compound question accepting a surface yes** — a question with two sub-questions joined by "and" lets the user answer the surface and leave one sub-question unasked. Ask one thing; split any compound into sequential messages.

## Completion

Complete when: frontier is empty, user has confirmed shared understanding, and the charter is written.
