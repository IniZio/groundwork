# Advisor Gate Reference

## Decision Escalation Template

```markdown
## Advisor Request
Goal: <target outcome>
Current status: <what has been tried, with specific file references>
Constraints: <time/risk/perf/security requirements>
Options considered: <A/B and why unresolved>
Decision needed: <single concrete question>
```

## Examples

### Decision — Architecture with Insight

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

### Completion Gate — APPROVE

1. Executor finishes feature, runs tests (all pass), verifies screenshots before/after.
2. Sends completion gate with all requirements listed, each marked met.
3. Advisor returns APPROVE with effort summary.
4. Executor tells user: "Done."

### Completion Gate — GAPS

1. Executor believes feature is done.
2. Sends completion gate; spec had 4 requirements, executor only addressed 3.
3. Advisor returns GAPS: "Requirement 4 (error state UI) not addressed."
4. Executor resumes, implements error state, re-runs completion gate.

### Decision — Scope Discipline

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

### Stop Signal

1. Executor detects destructive migration risk without rollback.
2. Escalates for decision.
3. Advisor returns STOP with requirement: define rollback and data backup procedure first.
4. Executor halts execution and asks user for approval/constraints.

### Completion Gate — Pushback on Waived Verification

1. Executor completes feature but skips e2e tests, noting "dev server not running."
2. Sends completion gate with "e2e tests: skipped (server not up)" under uncertain/skipped.
3. Advisor returns CORRECTION:
   - "Dev server not running is not an acceptable reason to skip e2e. Investigate how to start it."
   - Suggests: `npm run dev` or `docker compose up`, check README for setup instructions.
   - "Re-run completion gate after starting the server and running e2e."
4. Executor investigates server startup, starts the server, runs e2e tests, re-submits completion gate.

### Completion Gate — Acceptable Waiver (Rare)

1. Executor completes feature. E2e test requires staging environment with valid API key.
2. Executor attempted: tried `npm run staging`, got auth error. Checked README for key setup. Documented the attempt with error output.
3. Advisor confirms: staging API key is genuinely external (user must provision it).
4. Advisor returns APPROVE with note: "E2e against staging waived — API key requires user provisioning. All other verification passed. Flag to user."
5. Executor tells user: "Done. Note: e2e against staging could not run — needs API key. See <error output>."
