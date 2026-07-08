# Rejection KB — `.groundwork/out-of-scope/<concept-slug>.md`

When a **concept** is rejected as out of scope (by the advisor gate or at triage), record it
as a durable knowledge-base entry — **one markdown file per concept**, keyed by a stable
kebab-case slug (e.g. `realtime-collab.md`, `multi-tenant-billing.md`). This is the dedup
store: at triage, scan this directory and match an incoming request **by concept, not
keyword** ("night theme" matches `dark-mode.md`). On a match, append to *Prior requests* and
decline rather than re-planning work already rejected.

Record a concept here **only when it is genuinely rejected** — never for features already
implemented (that would poison the dedup check with false rejections). Keep the reasoning
**durable**: explain the lasting why (architecture fit, product direction, cost), not the
circumstances of one request — those are deferrals, not rejections.

## Template

```markdown
# Out of scope: <Concept name>

**Slug:** <concept-slug>
**Status:** REJECTED
**First rejected:** <YYYY-MM-DD>

## Why this is out of scope

<Durable, evergreen rationale that should survive across sessions.>

## What would change this

<Concrete conditions that would make it in-scope later, or "none".>

## Prior requests

- <YYYY-MM-DD> — <who/where it was raised> — <one-line context / outcome>
```
