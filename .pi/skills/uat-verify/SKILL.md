---
name: uat-verify
description: MANDATORY user acceptance testing before advisor-gate. Enforces real end-user testing — TUI via tmux/expect, API via real HTTP calls in docker-compose, web apps via Playwright browser. Unit/integration tests are INSUFFICIENT unless they exercise the system exactly as end-users experience it. No exceptions.
---

# UAT Verify

IF THIS SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

**This skill is MANDATORY between implementation and advisor-gate.** No work reaches advisor-gate without passing through UAT verification first. This is non-negotiable.

## Core Principle

**"The more your tests resemble the way your software is used, the more confidence they give you."** — Testing Library

Unit tests and mocked integration tests are INSUFFICIENT for UAT verification. They test implementation details, not user experience. UAT must exercise the system **exactly as the end-user experiences it**:

- A **TUI app** must be tested via real terminal interaction (tmux, expect, pexpect)
- An **API** must receive real HTTP calls in a docker-compose environment with seeded data
- A **web app** must be visited by a real browser (Playwright, Puppeteer)
- A **CLI tool** must be invoked as a user would invoke it, with real flags and real I/O
- A **library/package** must be imported and called from a consumer script

**If your "test" doesn't interact with the system the way a user would, it is not UAT.**

## When to Use

**MANDATORY** — invoke this skill in these cases:

1. **Before `advisor-gate`** — every path through `implement` or `diagnose` MUST pass through `uat-verify` before reaching `advisor-gate`
2. **After any implementation** that changes observable behavior
3. **After bug fixes** from `diagnose` — verify the fix works as the user would experience it

**The ONLY exception:** Docs-only changes with zero code changes. Everything else goes through UAT.

## Artifact Classification

Before running UAT, classify what was built:

| Artifact Type | How to Identify | UAT Method |
|---|---|---|
| **TUI / Terminal App** | Renders in terminal, accepts keyboard input, uses ncurses/bubbletea/ratatui/ink | tmux + expect/pexpect |
| **Web App (Frontend)** | Renders in browser, HTML/CSS/JS output | Playwright browser automation |
| **API / Backend Service** | Exposes HTTP endpoints, gRPC, or WebSocket | Real HTTP calls against running service |
| **CLI Tool** | Command-line binary with flags and positional args | Shell invocation with real I/O |
| **Library / Package** | Consumed by other code via import/require | Consumer script that imports and exercises it |
| **Config / Infra** | Changes to deployment, CI, or environment | Deploy to test environment, verify behavior |
| **Database Migration** | Schema changes, data migrations | Run migration, verify data integrity |

**Mixed artifacts:** If work spans multiple types, run UAT for EACH type. A full-stack feature with API + frontend needs both API UAT and browser UAT.

## UAT Execution by Artifact Type

### TUI / Terminal Application

**The ONLY acceptable UAT for TUI is real terminal interaction.**

**Required tools:**
- `tmux` for session management
- `expect` or `pexpect` for scripted interaction
- Shell pipes for input/output verification

**Mandatory UAT steps:**

1. **Start the TUI in a tmux session:**
   ```bash
   tmux new-session -d -s uat 'python tui_app.py'
   ```

2. **Send keystrokes and verify output:**
   ```bash
   # Send input
   tmux send-keys -t uat 'search query' Enter
   # Capture and verify screen content
   tmux capture-pane -t uat -p
   ```

3. **Or use expect for scripted interaction:**
   ```bash
   expect <<'EOF'
   spawn python tui_app.py
   expect "Search:"
   send "test query\r"
   expect "Results:"
   expect "3 items found"
   EOF
   ```

4. **Verify real user-facing behavior:**
   - Does the UI render correctly?
   - Do keyboard shortcuts work?
   - Does navigation work as expected?
   - Does scrolling work?
   - Does the app handle resize?

**UNACCEPTABLE:** Importing a render function in a unit test and checking its output. That tests the renderer, not the TUI.

**UNACCEPTABLE:** Checking that a function returns correct data. That tests logic, not the TUI experience.

### Web App (Frontend)

**The ONLY acceptable UAT for web apps is real browser automation.**

**Required tools:**
- Playwright (preferred) or Puppeteer
- Real browser (Chromium, Firefox, or WebKit)

**Mandatory UAT steps:**

1. **Start the dev server:**
   ```bash
   npm run dev &  # or equivalent
   # Wait for server to be ready
   curl --retry 5 --retry-delay 1 http://localhost:3000 > /dev/null
   ```

2. **Run Playwright against real browser:**
   ```typescript
   import { test, expect } from '@playwright/test';
   
   test('user can complete the primary flow', async ({ page }) => {
     await page.goto('http://localhost:3000');
     // Interact as a user would
     await page.getByRole('button', { name: 'Login' }).click();
     await page.getByLabel('Email').fill('test@example.com');
     await page.getByLabel('Password').fill('testpass123');
     await page.getByRole('button', { name: 'Submit' }).click();
     // Verify user-visible outcome
     await expect(page.getByText('Welcome')).toBeVisible();
   });
   ```

3. **Verify real user-facing behavior:**
   - Can users navigate to the page?
   - Can users interact with all controls?
   - Are visual states correct (loading, error, success)?
   - Does responsive design work?
   - Are accessibility requirements met?

**UNACCEPTABLE:** `shallowRender` or `mount` in a unit test checking component output.
**UNACCEPTABLE:** Testing that `useState` was called with the right value.
**UNACCEPTABLE:** Snapshot testing the virtual DOM.

### API / Backend Service

**The ONLY acceptable UAT for APIs is real HTTP calls against a running service.**

**Required tools:**
- `curl`, `httpie`, or HTTP client library
- `docker-compose` for multi-service environments
- Real database with seeded data

**Mandatory UAT steps:**

1. **Start the full stack with docker-compose:**
   ```bash
   docker-compose -f docker-compose.test.yml up -d
   # Wait for health checks
   docker-compose -f docker-compose.test.yml exec app wget --spider http://localhost:8080/health
   ```

2. **Seed realistic data:**
   ```bash
   docker-compose -f docker-compose.test.yml exec db psql -U app -c "
     INSERT INTO users (email, name) VALUES 
       ('test@example.com', 'Test User'),
       ('admin@example.com', 'Admin User');
   "
   ```

3. **Make real HTTP calls and verify responses:**
   ```bash
   # Test the actual endpoint
   RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:8080/api/users)
   STATUS=$(echo "$RESPONSE" | tail -1)
   BODY=$(echo "$RESPONSE" | head -n -1)
   
   # Verify
   [ "$STATUS" = "200" ] || { echo "FAIL: expected 200, got $STATUS"; exit 1; }
   echo "$BODY" | jq '.users | length' | grep -q "2" || { echo "FAIL: expected 2 users"; exit 1; }
   ```

4. **Verify real user-facing behavior:**
   - Do endpoints return correct status codes?
   - Do responses match the expected schema?
   - Does pagination work correctly?
   - Does authentication/authorization work end-to-end?
   - Does error handling return user-friendly messages?
   - Do database changes persist correctly?

**UNACCEPTABLE:** Calling a handler function directly in a unit test.
**UNACCEPTABLE:** Mocking the database and testing the query builder.
**UNACCEPTABLE:** Testing that a middleware function was called.

### CLI Tool

**The ONLY acceptable UAT for CLI tools is real shell invocation.**

**Mandatory UAT steps:**

1. **Build/install the tool:**
   ```bash
   go build -o mytool .  # or npm install -g . or cargo build
   ```

2. **Invoke as a user would:**
   ```bash
   # Test with real flags and real I/O
   echo "test input" | ./mytool --flag value > output.txt 2>&1
   diff expected.txt output.txt
   
   # Test error case
   ./mytool --invalid-flag 2>&1 | grep -q "unknown flag" || { echo "FAIL: no error for invalid flag"; exit 1; }
   ```

3. **Verify real user-facing behavior:**
   - Does the binary execute without errors?
   - Do flags and arguments work as documented?
   - Does stdin/stdout/stderr work correctly?
   - Does exit code reflect success/failure?
   - Does help text render correctly?

**UNACCEPTABLE:** Unit testing the argument parser in isolation.

### Library / Package

**The ONLY acceptable UAT for libraries is a consumer script.**

**Mandatory UAT steps:**

1. **Create a consumer script:**
   ```javascript
   // test-uat-consumer.mjs
   import { feature } from './src/index.js';
   
   const result = feature({ input: 'test' });
   if (result.status !== 'success') {
     console.error('FAIL: expected success, got', result.status);
     process.exit(1);
   }
   console.log('PASS: library works from consumer perspective');
   ```

2. **Run it:**
   ```bash
   node test-uat-consumer.mjs
   ```

3. **Verify the consumer can:**
   - Import the library without errors
   - Use the public API as documented
   - Handle edge cases as specified
   - Get correct return values

**UNACCEPTABLE:** Testing internal functions directly.

## Evidence Capture

**Every UAT must produce concrete evidence.** The evidence is passed to advisor-gate as verification output.

### Required Evidence

| Artifact Type | Evidence Format |
|---|---|
| TUI | tmux capture-pane output, expect transcript |
| Web App | Playwright trace/screenshot, console output |
| API | curl response bodies, status codes, docker-compose logs |
| CLI | stdout/stderr captures, exit codes, diff output |
| Library | Consumer script output, return value logs |

### Evidence Quality

**Good evidence (APPROVE):**
- Full interaction transcript showing input AND output
- Status codes, response bodies, timing data
- Screenshots of UI states
- Before/after comparisons

**Bad evidence (CORRECTION):**
- "I ran the test and it passed" — no, show the output
- "The component renders correctly" — show the screenshot
- "The API returns 200" — show the response body
- "Looks correct to me" — prove it with output

## Quality Convergence Loop

Inspired by babysitter's evidence-driven completion: **"If you don't have evidence, you don't have completion."**

A single UAT pass is often insufficient. Real systems need iterative verification across multiple quality dimensions until a target is met.

### When to Use Convergence

- **Any non-trivial implementation** (features, multi-system bug fixes, refactors)
- **When initial UAT reveals partial failures** — iterate, don't waive
- **When acceptance criteria span multiple dimensions** (functional + performance + security)

For trivial single-file fixes with obvious outcomes, a single UAT pass suffices. Skip convergence only when the change is truly one-dimensional.

### Convergence Protocol

```
Iteration 1:
  UAT runs → 60% scenarios pass → failures documented → return to implementation
Iteration 2:
  UAT runs → 85% scenarios pass → remaining failures analyzed → return to implementation
Iteration 3:
  UAT runs → 100% scenarios pass → PASS → proceed to advisor-gate
```

**Maximum 5 iterations.** If quality hasn't converged after 5 attempts, surface to user — the implementation may need fundamental rework.

### Multi-Dimensional Quality Gates

UAT should verify across multiple dimensions, not just functional correctness:

| Dimension | What to Verify | Weight |
|-----------|---------------|--------|
| **Functional** | Acceptance criteria met, user flows work | 40% |
| **Error Handling** | Invalid inputs, edge cases, error messages | 20% |
| **Integration** | Cross-system boundaries, data flow end-to-end | 20% |
| **Performance** | Response times, resource usage within bounds | 10% |
| **Security** | Auth, input sanitization, no data leaks | 10% |

**Minimum quality target: 80/100.** Adjust weights per artifact type:
- API: increase Integration weight to 30%, reduce Performance to 5%
- Web App: increase Functional to 50%, reduce Integration to 10%
- CLI Tool: increase Error Handling to 30%, reduce Security to 5%

### Convergence Loop Implementation

For each iteration:

1. **Run all UAT scenarios** against the real environment
2. **Score each dimension** (0-100) based on scenario results
3. **Calculate weighted quality score**: sum of (dimension_score × weight)
4. **Generate prioritized improvements**: sort dimensions by gap (target − current)
5. **Decision**:
   - Score ≥ target → PASS → proceed to advisor-gate
   - Score < target but improving → document failures → return to implementation with specific fixes
   - Score < target and plateaued (no improvement for 2 iterations) → surface to user

### Plateau Detection

If the quality score fails to improve by at least 5 points across 2 consecutive iterations, the convergence has plateaued. Do NOT keep iterating. Instead:

1. Document what's stuck and why
2. Surface to user with: "Quality plateaued at X/Y. Remaining gaps: [list]. Recommend: [replan fundamental approach or adjust acceptance criteria]"
3. Let the user decide — don't silently accept low quality

### Evidence Per Iteration

Each iteration must produce a structured evidence record:

```
## Convergence Iteration N
Quality score: XX/YY (target: YY)
Dimension scores:
  Functional: XX (weight 40%) → contributes XX
  Error Handling: XX (weight 20%) → contributes XX
  Integration: XX (weight 20%) → contributes XX
  Performance: XX (weight 10%) → contributes XX
  Security: XX (weight 10%) → contributes XX
Scenarios tested: N
  PASS: X scenarios
  FAIL: Y scenarios (list each with actual vs expected)
Prioritized improvements for next iteration:
  1. [highest-gap dimension]: [specific fix needed]
  2. [next-gap dimension]: [specific fix needed]
Decision: CONTINUE | PASS | PLATEAUED
```

This record is passed to advisor-gate as UAT evidence.

## UAT Gate Decision

After running UAT, produce a structured gate decision:

```
## UAT Verification Result
Artifact type: <TUI | Web | API | CLI | Library | Config>
UAT method: <tmux+expect | Playwright | curl+docker-compose | shell invocation | consumer script>
Environment: <how was the system started?>
Evidence captured: <list evidence files/outputs>
Test scenarios: <list each scenario tested>
Pass/fail per scenario: <PASS/FAIL for each>
Overall: PASS | FAIL
```

### PASS Criteria

- All scenarios produce expected user-visible outcomes
- Evidence captured and concrete
- No unexpected behaviors observed
- Edge cases tested where applicable

### FAIL Criteria

- Any scenario produces wrong output or error
- Missing evidence (no output captured)
- Environment failed to start (investigate before waiving)
- Unexpected behavior observed

### On FAIL

1. Document the failure with exact output
2. Return to implementation — fix the issue
3. Re-run UAT from scratch
4. Do NOT proceed to advisor-gate with a FAIL

## Integration with Workflow

### Position in Skill Chain

```
interview → vertical-slice → fan out coders → [UAT VERIFY] → advisor-gate → done
interview → diagnose → [UAT VERIFY] → advisor-gate → done
trivial change → implement → [UAT VERIFY] → advisor-gate → done
```

**UAT verify sits BETWEEN implementation and advisor-gate. Always.**

### For Orchestrator

After all implementation waves complete:

1. Load this skill (`uat-verify`) 
2. Delegate UAT execution to a `coder` agent with explicit instructions:
   - What artifact type was built
   - What UAT method to use
   - What scenarios to test (from acceptance criteria / bug report)
   - What evidence to capture
3. Review UAT results
4. Only if UAT PASSES → proceed to `advisor-gate`
5. If UAT FAILS → route back to implementation

### For Coder Agent

When you receive a UAT verification task:

1. Read this skill's instructions
2. Set up the real environment (start servers, docker-compose, tmux)
3. Execute each test scenario
4. Capture evidence (output, screenshots, response bodies)
5. Report the structured UAT result

### Advisor-Gate Integration

The completion gate request MUST include:

```
UAT verification: <PASS | FAIL>
UAT method: <what was used>
UAT evidence: <summary of evidence captured>
UAT scenarios: <list tested scenarios>
```

If UAT was skipped or waived, the advisor MUST respond with CORRECTION (not APPROVE). See advisor-gate verification pushback rules.

## What NOT to Do

- Do NOT skip UAT and go straight to advisor-gate — this is the most common quality failure
- Do NOT substitute unit tests for UAT — they test different things
- Do NOT claim "testing was done" without showing concrete evidence
- Do NOT mock the entire system and call it UAT — real environments only
- Do NOT waive UAT because "the change is small" — if it changes behavior, it needs UAT
- Do NOT test implementation details (internal state, function calls, mock interactions) — test what users see and do
- Do NOT skip UAT for bug fixes — verify the fix works as the user would experience it

## Anti-Pattern Examples

### Anti-Pattern 1: Mock Testing as UAT
```
# WRONG — this is a unit test, not UAT
test('API returns users', () => {
  const mockDb = { query: jest.fn().mockResolvedValue([{id: 1}]) };
  const result = await handler(mockDb);
  expect(result).toEqual([{id: 1}]);
});

# RIGHT — real HTTP call against real service
curl -s http://localhost:8080/api/users | jq '.users | length'
# Output: 2
```

### Anti-Pattern 2: Shallow Rendering as UAT
```
# WRONG — this tests the component class, not the user experience
const wrapper = shallow(<App />);
expect(wrapper.find('Header')).toHaveLength(1);

# RIGHT — real browser interaction
await page.goto('http://localhost:3000');
await expect(page.getByRole('banner')).toBeVisible();
```

### Anti-Pattern 3: Direct Function Call as UAT
```
# WRONG — users don't call internal functions
const result = parseInput("test");
expect(result.valid).toBe(true);

# RIGHT — invoke the CLI as a user would
echo "test" | ./myapp parse
# Output: ✓ Valid input processed
```
