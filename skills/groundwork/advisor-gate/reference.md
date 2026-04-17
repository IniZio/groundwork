# Advisor Gate Reference

## 1% Chance Escalation Rule

If there is even a 1% chance the next decision is high-impact, ambiguous, or hard to reverse — invoke `advisor`. Prefer one early checkpoint over late-stage rework.

## Decision Escalation Template

```markdown
## Advisor Request
Goal: <target outcome>
Current status: <what has been tried, with specific file references>
Constraints: <time/risk/perf/security requirements>
Options considered: <A/B and why unresolved>
Decision needed: <single concrete question>
```

## Completion Gate Template

```markdown
## Completion Gate Request
Task: <what was asked>
What was done: <summary of changes>
Verification run: <commands run and their output>
Requirements from spec/PRD: <list each requirement>
Each requirement met: <yes/no per item>
Anything uncertain or skipped: <list or "none">
Question: Is this complete and correct?
```

## Advisor Response Template (Decision)

```markdown
Type: PLAN | CORRECTION | STOP
Decision: <2-3 sentence bottom line recommendation>
Rationale: <why, anchored to specific code at file:line>
Actions:
1. <concrete step>
2. <concrete step>
Risks to watch:
- <specific risk with mitigation>
Effort: Quick | Short | Medium | Large
```

## Advisor Response Template (Completion Gate)

```markdown
Type: APPROVE | GAPS | CORRECTION | STOP
Decision: <2-3 sentence assessment>
Rationale: <why, referencing specific requirements>
Actions:
1. <what to do next — empty if APPROVE>
Risks to watch:
- <unresolved risk or caveat>
Effort: Quick | Short | Medium | Large
```

## Expanded Tier Template (for complex decisions)

```markdown
Why this approach:
- <trade-off bullet 1>
- <trade-off bullet 2>
Escalation triggers:
- <condition requiring more complex solution>
Alternative sketch:
- <high-level outline of a different path>
```

## Invocation Record (append per escalation)

```markdown
## Advisor Invocation Record
Timestamp: <YYYY-MM-DD HH:MM:SS>
Type: DECISION | COMPLETION_GATE
Trigger: <why invoked>
Decision requested: <question>
Advisor result type: PLAN | CORRECTION | STOP | APPROVE | GAPS
Effort estimate: Quick | Short | Medium | Large
Executor follow-up: <next action taken>
```

## Example: Decision — Architecture with Insight

1. Executor uncertain between two caching strategies.
2. Escalates with constraints (latency target, memory cap).
3. Advisor returns:
   ```
   Type: PLAN
   Decision: Use in-memory LRU cache behind an interface boundary in `cache.ts`. The existing
     `ConfigStore` class already has the right abstraction shape — extend it rather than
     introducing a new dependency.
   Rationale: The latency target (<50ms p99 at `api/handler.ts:23`) rules out network calls.
     Memory cap (512MB) allows ~50K cached entries assuming average payload size from
     `DataModel` schema.
   Actions:
   1. Create `CacheProvider` interface in `src/cache/provider.ts` with `get`/`set`/`invalidate`
   2. Implement `LRUProvider` using the existing `Map` in `ConfigStore` (extend at line 45)
   3. Wire into `api/handler.ts:23` via dependency injection
   Risks to watch:
   - Cache invalidation on write-through — need to verify `DataModel.update()` clears cache
   Effort: Short (2-3h)
   ```
4. Executor implements the single clear path.

## Example: Completion Gate — APPROVE

1. Executor finishes feature, runs tests (all pass), verifies screenshots before/after.
2. Sends completion gate with all requirements listed, each marked met.
3. Advisor returns APPROVE with effort summary.
4. Executor tells user: "Done."

## Example: Completion Gate — GAPS

1. Executor believes feature is done.
2. Sends completion gate; spec had 4 requirements, executor only addressed 3.
3. Advisor returns GAPS: "Requirement 4 (error state UI) not addressed."
4. Executor resumes, implements error state, re-runs completion gate.

## Example: Decision — Scope Discipline

1. Executor asks advisor about adding WebSocket support to the caching layer "while we're here."
2. Advisor returns:
   ```
   Type: CORRECTION
   Decision: Do not add WebSocket support. The requirement only asks for HTTP cache
     invalidation. WebSocket is a separate feature requiring its own connection management,
     reconnection logic, and error handling — easily 1-2 days of additional work.
   Rationale: Scope discipline. The PRD at `docs/prds/2026-04-17-cache/PRD.md` only mentions
     HTTP endpoints. Adding WebSocket here violates "recommend only what was asked."
   Actions:
   1. Implement HTTP cache invalidation as specified
   2. If WebSocket is needed later, create a separate PRD
   Risks to watch:
   - None for this path — the risk is in scope creep, not the implementation
   Effort: N/A (preventing unnecessary Large effort)
   ```

## Example: Stop Signal

1. Executor detects destructive migration risk without rollback.
2. Escalates for decision.
3. Advisor returns STOP with requirement: define rollback and data backup procedure first.
4. Executor halts execution and asks user for approval/constraints.

## Example: Completion Gate — Pushback on Waived Verification

1. Executor completes feature but skips e2e tests, noting "dev server not running."
2. Sends completion gate with "e2e tests: skipped (server not up)" under uncertain/skipped.
3. Advisor returns CORRECTION:
   - "Dev server not running is not an acceptable reason to skip e2e. Investigate how to start it."
   - Suggests: `npm run dev` or `docker compose up`, check README for setup instructions.
   - "Re-run completion gate after starting the server and running e2e."
4. Executor investigates server startup, starts the server, runs e2e tests, re-submits completion gate.

## Example: Completion Gate — Acceptable Waiver (Rare)

1. Executor completes feature. E2e test requires staging environment with valid API key.
2. Executor attempted: tried `npm run staging`, got auth error. Checked README for key setup. Documented the attempt with error output.
3. Advisor confirms: staging API key is genuinely external (user must provision it).
4. Advisor returns APPROVE with note: "E2e against staging waived — API key requires user provisioning. All other verification passed. Flag to user."
5. Executor tells user: "Done. Note: e2e against staging could not run — needs API key. See <error output>."
