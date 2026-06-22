# Groundwork → Pi Adoption Plan

**Goal:** Port the `groundwork` OpenCode plugin to a first-class Pi extension that coexists smoothly with `@gotgenes/pi-subagents`, with a development and verification experience as ergonomic as the existing OpenCode ACP harness.

**Decisions:**
- Repo stays at `git@github.com:IniZio/groundwork.git` — we adapt in-place (no monorepo migration).
- `fast_edit` / `fast_write` tools are **not** migrated — Pi's built-in `edit`/`write` tools are sufficient.
- `LoopMonitor` is **dropped** — Pi handles loop detection natively or it is not needed.
- Handoff auto-session-creation will be investigated via Pi's UI/SDK APIs.

---

## 1. Architecture Decision: In-Place Adaptation

We keep the existing `groundwork` repo and adapt it to publish a Pi-native extension.

**Installation:**

```bash
# Required for agent spawning, background execution, and widget
pi install npm:@gotgenes/pi-subagents

# Workflow skills, bootstrap, goals, and agent definitions
pi install npm:groundwork   # or git:github.com/IniZio/groundwork
```

**Layout changes:**
- `src/` migrates from `@opencode-ai/plugin` APIs to `@earendil-works/pi-coding-agent` APIs.
- `agents/*.md` migrate to `.pi/agents/*.md` with Pi frontmatter.
- `skills/groundwork/*/` migrate to `.pi/skills/<name>/SKILL.md`.
- Tests migrate from `bun:test` to `vitest` with Pi mock patterns.
- OpenCode-specific artifacts (`.cursor-plugin/`, `.opencode/`) are either removed or co-located.

**Coexistence with `pi-subagents`:**
- `pi-subagents` (installed separately by the user) handles spawning, background execution, and lifecycle.
- `groundwork` provides workflow skills, bootstrap injection, agent definitions, and tools.
- `groundwork` does NOT reimplement subagent spawning — it relies on `pi-subagents` for that.
- On `session_start`, `groundwork` writes its agent `.md` definitions into `.pi/agents/`, which `pi-subagents` auto-discovers.

---

## 2. Component Mapping (OpenCode → Pi)

### 2.1 Extension Entry Point

| OpenCode (`@opencode-ai/plugin`) | Pi (`@earendil-works/pi-coding-agent`) |
|---|---|
| `export const GroundworkPlugin = async (input: PluginInput) => { … }` | `export default function (pi: ExtensionAPI) { … }` |
| `input.client` | `pi` + `pi.events` + `pi.sendMessage()` |
| `input.directory` | `process.cwd()` (or `ctx.cwd` from `session_start`) |
| `config()` hook mutates `config.skills.paths`, `config.agent`, `config.command` | **Removed entirely** — Pi auto-discovers `.pi/skills/` and `.pi/agents/` |
| `tool: { handoff_session: …, set_goal: … }` | `pi.registerTool(defineTool({ name: "handoff_session", … }))` |
| `command: { handoff: …, goal: … }` | `pi.registerCommand("handoff", { handler: … })` |
| `experimental.chat.messages.transform` | `pi.on("context", (event, ctx) => { … })` |
| `event: ({ event }) => { … }` | `pi.on("session_start", …)`, `pi.on("turn_end", …)`, `pi.on("session_shutdown", …)` |
| `chat.message` hook | `pi.on("message_end", …)` or handled inside `context` event |

### 2.2 Tools

| Tool | OpenCode Implementation | Pi Implementation |
|---|---|---|
| `handoff_session` | `@opencode-ai/plugin` `tool()` with Zod args | `defineTool()` with `@sinclair/typebox` params |
| `set_goal` | Same | Same |
| `fast_edit` / `fast_write` | Custom file-mutation tools | **Dropped** — Pi native `edit`/`write` are sufficient |

**Key change:** Pi tools receive `(toolCallId, params, signal, onUpdate, ctx)` instead of `(args, context)`. The `ctx.ui` object replaces `client.tui` for toasts/prompts.

### 2.3 Commands

| Command | OpenCode | Pi |
|---|---|---|
| `/handoff` | `config.command['handoff'] = { template: HANDOFF_COMMAND }` | `pi.registerCommand("handoff", { description: "…", handler: async (args, ctx) => { … } })` |
| `/goal` | Same | Same |

In Pi, commands are interactive handlers, not static templates. The `/handoff` handler will:
1. Build the handoff prompt via LLM (same as today).
2. Call `handoff_session` tool internally or prompt the user to confirm.

### 2.4 Agents — Plugin-Managed with Auto-Updates

To keep the plugin self-contained (no manual file copying), agent definitions are **embedded in the plugin as code** and written to `.pi/agents/*.md` at runtime. This ensures `pi install npm:groundwork` works out of the box.

**Supported frontmatter mapping (`pi-subagents` ≥ 13.x):**

| Groundwork Field | Pi Frontmatter | Notes |
|---|---|---|
| `description` | `description` | ✅ Direct mapping |
| `model` | `model` | ✅ Direct mapping |
| `thinking` | `thinking` | ✅ Direct mapping |
| `temperature` | — | ❌ **Dropped** — not supported by `pi-subagents` frontmatter parser |
| `permission` | `permission` | ✅ Consumed by `@gotgenes/pi-permission-system` if installed |
| (tools restriction) | `tools` | ✅ CSV list e.g. `tools: read, bash, grep, find, ls` |
| (prompt mode) | `prompt_mode` | ✅ `replace` or `append` |
| `enabled` | `enabled` | ✅ `false` to hide/disable an agent |

**Disabling builtin subagents:**

`pi-subagents` ships with 3 builtin agents: `general-purpose`, `Explore`, `Plan`. To disable them and make **orchestrator** the default:

1. **Override `general-purpose`** with orchestrator content (must stay enabled because `pi-subagents` hardcodes it as the fallback in `resolveAgentConfig`)
2. **Disable `Explore`** with `enabled: false`
3. **Disable `Plan`** with `enabled: false`

#### Runtime Agent Installation

Agent definitions are embedded as string constants in `src/lib/agent-setup.ts`. On every `session_start`, the plugin calls `ensureAgentsInstalled(cwd)` which:

1. Checks `.pi/agents/<name>.md` for each embedded agent
2. Decides whether to write, skip, or update

**Update strategy:**

```typescript
// src/lib/agent-setup.ts
interface AgentDefinition {
  name: string;
  content: string;
  version: string; // e.g. "1.0.0" — bumps when content changes
}

function ensureAgentsInstalled(cwd: string) {
  const agentsDir = join(cwd, '.pi', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  
  for (const agent of EMBEDDED_AGENTS) {
    const path = join(agentsDir, `${agent.name}.md`);
    const shouldWrite = !existsSync(path) || isOutdated(path, agent.version);
    if (shouldWrite) {
      writeFileSync(path, agent.content, 'utf8');
    }
  }
}

function isOutdated(path: string, pluginVersion: string): boolean {
  const content = readFileSync(path, 'utf8');
  const { frontmatter } = parseFrontmatter(content);
  
  // Only update files that are managed by us
  if (frontmatter.managed_by !== 'groundwork') return false;
  
  // Compare version
  const fileVersion = frontmatter.groundwork_version ?? '0.0.0';
  return semver.lt(fileVersion, pluginVersion);
}
```

**Frontmatter markers:**

Every plugin-managed agent file includes these markers:

```markdown
---
description: Orchestrator — main workflow coordinator
model: openai/gpt-5.4
managed_by: groundwork
groundwork_version: "1.0.0"
---
```

**User customization flow:**
- User edits a plugin-managed agent → they should remove `managed_by: groundwork` to prevent their changes from being overwritten on the next update
- User wants the latest plugin version → keep the marker, and the file auto-updates when the plugin bumps the version

**Manifest file:**

For performance (avoid re-parsing all files), a `.pi/agents/.groundwork-manifest.json` tracks which agents are installed and their versions:

```json
{
  "version": "1.0.0",
  "agents": {
    "general-purpose": "1.0.0",
    "advisor": "1.0.0",
    "general-purpose": "1.0.0"
  }
}
```

This manifest is updated after every `ensureAgentsInstalled()` call.

#### Agent Definitions

| Embedded Name | Purpose | Replaces Builtin? |
|---|---|---|
| `general-purpose` | Orchestrator — main workflow coordinator | ✅ Overrides builtin |
| `Explore` | Disabled placeholder | ✅ Disables builtin |
| `Plan` | Disabled placeholder | ✅ Disables builtin |
| `advisor` | Strategic decisions, architecture, code review | — New |
| `general-purpose` | Fast implementation, tests, build verification | — New |
| `designer` | UI/UX, styling, responsive design | — New |
| `explorer` | Fast codebase exploration (read-only) | — New (renamed from `explore`) |

All definitions live in `src/lib/agent-definitions.ts` as exported string constants.

### 2.5 Skills

Groundwork's `skills/groundwork/*/` directories move to `.pi/skills/` following the Pi skill layout (`<name>/SKILL.md`).

| Skill | Trigger in OpenCode | Trigger in Pi |
|---|---|---|
| `use-groundwork` | Injected via `experimental.chat.messages.transform` | Injected via `pi.on("context", …)` event |
| `interview` | Skill tool | Skill tool (unchanged) |
| `diagnose` | Skill tool | Skill tool (unchanged) |
| `create-prd` | Skill tool | Skill tool (unchanged) |
| `advisor-gate` | Skill tool | Skill tool (unchanged) |
| `bdd-implement` | Skill tool | Skill tool (unchanged) |
| `prototype` | Skill tool | Skill tool (unchanged) |
| `goal` | Skill tool | Skill tool (unchanged) |
| `opencode-acp` | Skill tool | **Renamed** to `pi-test-harness` or similar |

### 2.6 Bootstrap / Goal Injection

OpenCode uses `experimental.chat.messages.transform` to mutate the message array before the LLM sees it.

Pi equivalent: the `context` event.

```typescript
pi.on("context", (event, _ctx) => {
  const messages = event.messages;
  const sessionID = /* derive from ctx or event */;
  const bootstrap = getBootstrapForAgent(ctx.agent);  // from skills.ts
  const goal = readGoal(cwd, sessionID);
  injectGoalAndBootstrap(messages, { bootstrap, goalReminder: goal ? goalReminder(goal) : null });
});
```

**Critical difference:** Pi's `context` event fires **before every LLM call**, not just at conversation start. The idempotency guards (`EXTREMELY_IMPORTANT`, `ACTIVE_GOAL`) already in `injectGoalAndBootstrap` handle this correctly.

### 2.7 Handoff Mechanism

**OpenCode approach:**
```typescript
await client.tui.executeCommand({ body: { command: "session_new" } })
await client.tui.appendPrompt({ body: { text: fullPrompt } })
```

**Pi investigation findings:**
- `ExtensionAPI` does **not** expose a `session_new` or `createSession` method.
- The SDK's `SessionManager` (from `@earendil-works/pi-coding-agent`) has `newSession()`, but it is typically used internally for subagent sessions.
- `ctx.ui` exposes `select`, `input`, `confirm`, `editor`, `notify`, `custom` — none of which create sessions.

**Pi implementation strategy (Option A — investigated):**
1. **Attempt programmatic session creation** via importing `SessionManager` from `@earendil-works/pi-coding-agent` and calling `SessionManager.create(cwd, sessionDir).newSession()` to create a new session file.
2. If the session file is created successfully, use `pi.sendMessage()` to notify the user with a clickable prompt or instruction to switch to the new session.
3. If programmatic creation is not viable, fall back to outputting the handoff prompt as formatted text that the user can copy into a new session.

**Handoff file refs (synthetic injection):**
OpenCode's `chat.message` hook detects "Continuing work from session" and appends synthetic file parts. In Pi, this is handled via the `context` event on the next turn:

```typescript
pi.on("context", async (event, ctx) => {
  const lastMessage = /* derive from session entries or state */;
  if (!lastMessage?.includes("Continuing work from session")) return;
  const refs = parseFileReferences(lastMessage);
  if (refs.length === 0) return;
  const fileParts = await buildSyntheticFileParts(directory, refs);
  // Inject into event.messages before the LLM call
  event.messages.push(...fileParts);
});
```

---

## 3. Coexistence with `pi-subagents`

### 3.1 Division of Responsibilities

| Concern | Owned by `pi-subagents` | Owned by `pi-groundwork` |
|---|---|---|
| Spawn subagents | ✅ `subagent` tool | ❌ |
| Background execution / queuing | ✅ ConcurrencyQueue | ❌ |
| Steering / resume | ✅ `steer_subagent`, `get_subagent_result` | ❌ |
| Agent widget / UI | ✅ AgentWidget | ❌ |
| Custom agent types | ✅ Registry (discovers `.pi/agents/*.md`) | ✅ Provides the `.md` files |
| Workflow bootstrap injection | ❌ | ✅ `context` event handler |
| Goal management | ❌ | ✅ `set_goal` tool |
| Handoff sessions | ❌ | ✅ `handoff_session` tool |
| Advisor gate | ❌ | ✅ `advisor-gate` skill |
| PRD / BDD workflow | ❌ | ✅ `create-prd`, `bdd-implement` skills |

### 3.2 Integration Point: Agent Types

`pi-groundwork` installs agent definitions into `.pi/agents/`:
- `advisor.md`
- `general-purpose.md`
- `designer.md`
- `explore.md`

`pi-subagents` auto-discovers these. A user can then run:

```text
subagent({ subagent_type: "advisor", prompt: "Review this plan", description: "Plan review" })
```

This means **groundwork does not need to implement any subagent spawning logic** — it purely provides the agent definitions and workflow orchestration skills.

### 3.3 Integration Point: Events

`pi-groundwork` can listen to `pi-subagents` lifecycle events to implement workflow gates:

```typescript
pi.on("subagents:completed", (event) => {
  // After an advisor subagent completes, remind the parent to check advisor-gate
});
```

---

## 4. File Structure

```
groundwork/                    # existing repo, adapted for Pi
  package.json                 # add @earendil-works/pi-coding-agent peer dep
  vitest.config.ts             # replace bun:test with vitest
  tsconfig.json
  src/
    index.ts                   # Extension entry point (Pi ExtensionAPI)
    runtime.ts                 # Mutable extension state
    types.ts                   # Shared types
    lib/
      goal.ts                  # Goal persistence (pure, file-backed)
      handoff.ts               # File ref parsing, synthetic parts builder
      skills.ts                # Bootstrap content loading, PTY detection
      prompt-resolver.ts       # resolvePromptAppend export
      agent-setup.ts           # Runtime agent installation + version tracking
      agent-definitions.ts     # Embedded agent .md content as string constants
      # loop-monitor.ts        # REMOVED — Pi handles this natively
    tools/
      handoff-session.ts       # handoff_session tool definition
      set-goal.ts              # set_goal tool definition
    commands/
      handoff.ts               # /handoff command handler
      goal.ts                  # /goal command handler
  test/                        # migrate from bun:test to vitest
    helpers/
      stub-ctx.ts              # Stub ExtensionContext
      make-deps.ts             # Tool fixture factories
    lib/
      goal.test.ts
      handoff.test.ts
      skills.test.ts
    tools/
      handoff-session.test.ts
      set-goal.test.ts
    commands/
      handoff.test.ts
      goal.test.ts
    runtime.test.ts
    extension.test.ts          # Smoke test for the exported default function
  .pi/                         # NEW — Pi discovery layout
    agents/
      advisor.md
      general-purpose.md
      designer.md
      explore.md
    skills/
      use-groundwork/
        SKILL.md
        bootstrap-universal.md
        bootstrap-orchestrator.md
        bootstrap-general-purpose.md
      interview/
        SKILL.md
      diagnose/
        SKILL.md
      create-prd/
        SKILL.md
      advisor-gate/
        SKILL.md
      bdd-implement/
        SKILL.md
      prototype/
        SKILL.md
      goal/
        SKILL.md
      pi-test-harness/
        SKILL.md
  skills/groundwork/            # DEPRECATED — migrate contents to .pi/skills/
  agents/                       # DEPRECATED — migrate contents to .pi/agents/
```

---

## 5. Development Workflow

### 5.1 Local Dev Loop

1. **Install deps:** `pnpm install` (or `bun install` if keeping bun)
2. **Start Pi from the repo root:** `pi`
   - Ensure `.pi/settings.json` (or `~/.pi/settings.json`) loads the local extension: `"groundwork@./src/index.ts"`
3. **Edit → Test:** Changes to `src/index.ts` are picked up on the next Pi restart (or via `pi -e ./src/index.ts` for rapid iteration).

### 5.2 Agentic Development

Use your preferred agentic workflow, or adopt the `pi-packages` style:

| Stage | Command |
|---|---|
| Discover | `/plan-improvements` |
| Plan | `/plan-issue #N` |
| Implement | `/tdd-plan` |
| Ship | `/ship-issue #N` |
| Retro | `/retro` |

---

## 6. Testing & Verification Strategy

The OpenCode ACP harness provides **end-to-end acceptance testing** of skill routing by spawning an isolated OpenCode instance, sending prompts, and asserting on the JSON event stream.

For Pi, we replicate this with a **three-layer testing pyramid**:

### 6.1 Layer 1: Unit Tests (Fast, Deterministic)

**Migrate existing tests** from `bun:test` → `vitest`.

| Existing Test | New Location | Notes |
|---|---|---|
| `goal.test.ts` | `test/lib/goal.test.ts` | Pure functions, no SDK needed |
| `handoff-session.test.ts` | `test/tools/handoff-session.test.ts` | Mock `ExtensionContext` |
| `loop-detector.test.ts` | Optional | Pi may handle loops natively; evaluate need |
| `plugin-config-merge.test.ts` | Drop | No config merging in Pi |
| `pure-functions.test.ts` | Keep | Always valuable |
| `skills.test.ts` | `test/lib/skills.test.ts` | Mock `fs` reads |
| `snapshot-handoff.test.ts` | Keep | Handoff formatting logic |

**Pi mocking patterns** (borrowed from `pi-subagents/test/helpers/`):

```typescript
// test/helpers/stub-ctx.ts
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
export const STUB_CTX = {} as unknown as ExtensionContext;

// test/helpers/make-deps.ts
import { vi } from "vitest";
export function createHandoffDeps(overrides = {}) {
  return {
    client: { ui: { showToast: vi.fn(), appendPrompt: vi.fn() } },
    directory: "/tmp/test",
    ...overrides,
  };
}
```

### 6.2 Layer 2: Extension Smoke Tests

Test that the extension registers tools, commands, and event handlers without crashing.

```typescript
// test/extension.test.ts
import { describe, it, expect, vi } from "vitest";
import extension from "#src/index";

describe("pi-groundwork extension", () => {
  it("registers tools and commands without throwing", () => {
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn(),
      events: { emit: vi.fn() },
      sendMessage: vi.fn(),
    };
    expect(() => extension(pi as any)).not.toThrow();
    expect(pi.registerTool).toHaveBeenCalledTimes(2); // handoff_session, set_goal
    expect(pi.registerCommand).toHaveBeenCalledTimes(2); // handoff, goal
  });
});
```

### 6.3 Layer 3: Acceptance / Routing Tests (The "ACP Smooth" Equivalent)

This is the critical layer. OpenCode ACP gives us an isolated agent we can prompt and observe. Pi does not have a built-in ACP server, but we have **three viable alternatives**:

#### Option A: Subagent-Based Harness (Recommended)

Use `pi-subagents` itself to test `pi-groundwork`.

**Mechanism:**
1. A test script spawns a `general-purpose` subagent with a specific prompt.
2. The subagent runs in a fresh project directory that has `pi-groundwork` loaded.
3. After completion, we inspect the subagent's conversation transcript to assert:
   - Which skills were loaded (search transcript for skill invocation markers)
   - Which tools were used
   - That forbidden skills/tools were NOT used

**Implementation:**

```typescript
// test/acceptance/routing.test.ts
import { describe, it, expect } from "vitest";
import { spawnSubagentForTest } from "./harness";

const TEST_CASES = [
  {
    name: "trivial-bug",
    prompt: 'Fix the typo where it says "backgroud" instead of "background"',
    expectSkills: [],
    forbidSkills: ["diagnose", "create-prd", "bdd-implement"],
  },
  {
    name: "standard-bug",
    prompt: "The filters don't work. Debug and fix.",
    expectSkills: ["diagnose"],
    forbidSkills: ["create-prd", "bdd-implement"],
  },
  {
    name: "feature",
    prompt: "Build a workflow engine with triggers, conditions, and actions.",
    expectSkills: ["interview", "create-prd"],
    forbidSkills: ["diagnose"],
  },
];

for (const tc of TEST_CASES) {
  it(`routes "${tc.name}" correctly`, async () => {
    const result = await spawnSubagentForTest({
      prompt: tc.prompt,
      subagent_type: "general-purpose",
      max_turns: 15,
    });

    const transcript = result.transcript.toLowerCase();
    for (const skill of tc.expectSkills) {
      expect(transcript).toContain(`skill: ${skill}`);
    }
    for (const skill of tc.forbidSkills) {
      expect(transcript).not.toContain(`skill: ${skill}`);
    }
  }, 120_000);
}
```

**Why this works:**
- It exercises the real extension code, real event handlers, and real skill discovery.
- It runs in a subprocess, so crashes don't kill the test runner.
- It reuses the existing `pi-subagents` infrastructure we already depend on.

#### Option B: Pi CLI Harness

If Pi exposes a `pi run` or `pi eval` CLI command (similar to `opencode run`), we can shell out to it:

```typescript
const result = await execa("pi", [
  "run", prompt,
  "--dir", testProjectDir,
  "--agent", "general-purpose",
  "--format", "json",
]);
```

**Status:** Unverified — need to check if Pi has a headless run mode. If it does, this is the cleanest option.

#### Option C: Mock ExtensionAPI Integration Tests

Build a fake `ExtensionAPI` that drives the extension through its lifecycle:

```typescript
const fakePi = createFakeExtensionAPI();
extension(fakePi);
fakePi.emit("session_start", { cwd: "/tmp/test" });
fakePi.emit("context", { messages: [userMessage("Build a feature")] });
// Assert on mutated messages
```

**Pros:** Fast, no subprocess, no LLM calls.
**Cons:** Does not test actual skill routing (which depends on the LLM choosing to load skills).

**Recommendation:** Use **Option A (Subagent-Based Harness)** as the primary acceptance test strategy. It most closely mirrors the OpenCode ACP approach: an isolated agent, a prompt, and assertions on behavior. If Pi adds a headless `run` CLI later, we can migrate to Option B.

### 6.4 The `pi-test-harness` Skill

Replace `opencode-acp` with a Pi-native testing skill that documents how to run the acceptance harness:

```markdown
---
name: pi-test-harness
description: Run the pi-groundwork acceptance test harness using pi-subagents.
---

# Testing pi-groundwork

## Unit tests
pnpm exec vitest run

## Acceptance tests
pnpm exec vitest run test/acceptance

## Manual smoke test
1. Start Pi in a test project with groundwork installed.
2. Prompt: "Fix the typo where it says 'recieve' instead of 'receive'"
3. Verify: no PRD created, no interview triggered, direct edit made.
```

---

## 7. Implementation Phases

### Phase 0: Scaffold (1 session)
- [ ] Update `package.json` to add `@earendil-works/pi-coding-agent` as a peer/dev dependency
- [ ] Replace `bun:test` with `vitest` in `package.json` scripts and add `vitest.config.ts`
- [ ] Update `tsconfig.json` with path aliases (`#src/*`, `#test/*`) if needed
- [ ] Ensure `.pi/settings.json` loads the local extension for dev
- [ ] Run `pnpm install` (or `bun install`) and verify dependencies resolve
- [ ] Write `src/index.ts` stub that exports a no-op Pi extension
- [ ] Commit

### Phase 1: Pure Libraries (1–2 sessions)
- [ ] Port `src/lib/goal.ts` → unchanged logic, update imports
- [ ] Port `src/lib/handoff.ts` → unchanged logic
- [ ] Port `src/lib/skills.ts` → update path resolution for `.pi/skills/` layout
- [ ] Port `src/lib/prompt-resolver.ts` → unchanged
- [ ] **Delete `src/lib/loop-monitor.ts` and `src/lib/loop-detector.ts`** (dropped per decision)
- [ ] Write unit tests for all four modules
- [ ] Commit

### Phase 2: Tools (1 session)
- [ ] Port `handoff_session` tool to `defineTool()` pattern
- [ ] Port `set_goal` tool to `defineTool()` pattern
- [ ] Write unit tests with mocked `ExtensionContext`
- [ ] Commit

### Phase 3: Commands & Events (1 session)
- [ ] Port `/handoff` command handler
- [ ] Port `/goal` command handler
- [ ] Implement `context` event handler for bootstrap + goal injection
- [ ] Implement `session_start` / `session_shutdown` handlers for goal lifecycle
- [ ] Implement `message_end` handler for handoff file refs (or defer to `context`)
- [ ] Write smoke tests
- [ ] Commit

### Phase 4: Agents & Skills (1 session)
- [ ] Create `src/lib/agent-definitions.ts` with embedded agent content for:
  - `general-purpose` (orchestrator override)
  - `Explore` (disabled placeholder)
  - `Plan` (disabled placeholder)
  - `advisor`, `general-purpose`, `designer`, `explorer`
- [ ] Create `src/lib/agent-setup.ts` with `ensureAgentsInstalled()` + version tracking
  - Read/write `.pi/agents/.groundwork-manifest.json`
  - Parse frontmatter to check `managed_by` / `groundwork_version`
  - Only update files marked as plugin-managed
- [ ] Wire `ensureAgentsInstalled()` into `session_start` event handler
- [ ] Migrate `skills/groundwork/*/` → `.pi/skills/<name>/SKILL.md`
- [ ] Update skill content to reference Pi-native patterns
- [ ] Verify agents appear in `pi-subagents` `/agents` menu after session start
- [ ] Commit

### Phase 5: Acceptance Harness (1–2 sessions)
- [ ] Implement `test/acceptance/routing.test.ts` using subagent-based harness
- [ ] Port test cases from `acp-routing.test.ts`
- [ ] Create `test/acceptance/harness.ts` with `spawnSubagentForTest()` helper
- [ ] Run harness and verify all routing cases pass
- [ ] Write `pi-test-harness` skill documenting the test commands
- [ ] Commit

### Phase 6: Polish & Ship (1 session)
- [ ] Write `README.md` with install instructions
- [ ] Write `AGENTS.md` with package conventions
- [ ] Run full test suite: `pnpm run check && pnpm run test`
- [ ] Run lint: `pnpm run lint`
- [ ] Open PR, verify CI passes
- [ ] Ship via release-please

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pi `context` event semantics differ from OpenCode transform | Bootstrap injected at wrong time, or double-injected | Existing idempotency guards (`EXTREMELY_IMPORTANT`, `ACTIVE_GOAL`) already handle this. Add unit tests for repeated `context` events. |
| `pi-subagents` frontmatter format changes | Agent `.md` files break | `pi-subagents` is stable; frontmatter is versioned via the package. We pin to a peer dep range. |
| No headless Pi CLI for acceptance tests | Harness is harder to build | Use subagent-based harness (Option A). It exercises the real code path without needing a headless CLI. |
| Tool `execute` signature differences (Zod vs TypeBox) | Type errors or runtime validation failures | Use `@sinclair/typebox` per Pi convention. Write a thin wrapper if we want to keep Zod schemas internally. |
| `handoff_session` needs to create new Pi sessions | Pi may not expose `session_new` via `ctx.ui` | Research Pi's UI API (`ctx.ui` has `select`, `input`, `confirm`, etc.). If `session_new` is unavailable, implement handoff as a steering message or command output instead. |
| Loop monitor from OpenCode may conflict with Pi's native loop detection | Duplicate or conflicting behavior | **Dropped** per decision — Pi handles loop detection natively. |

---

## 9. Open Questions

1. **Does Pi expose a `session_new` equivalent on `ctx.ui`?** If not, the `/handoff` command may need to output a copy-pasteable prompt instead of auto-creating a session.
2. **Does Pi have a headless `run` or `eval` CLI?** This would unlock Option B for acceptance tests.
3. **Should `pi-groundwork` depend on `pi-subagents` as a peer dependency?** If we use the subagent-based harness internally, or if skills reference `subagent` tool patterns, a peer dep makes sense.
4. **What happens to the original OpenCode plugin?** Options: (a) archive it, (b) keep dual maintenance, (c) convert this repo to a monorepo with both `opencode-groundwork` and `pi-groundwork`. **Recommendation:** Archive the OpenCode version once Pi adoption is complete; maintenance bandwidth is better spent on one platform.

---

## 10. Success Criteria

- [ ] `pi install npm:@gotgenes/pi-subagents` + `pi install npm:groundwork` works and loads without errors.
- [ ] `pi-subagents` `/agents` menu shows all 5 groundwork agent types.
- [ ] Starting a Pi session injects the `use-groundwork` bootstrap.
- [ ] `set_goal` tool creates a goal that persists across turns.
- [ ] `handoff_session` tool creates a handoff prompt in a new session.
- [ ] Acceptance test suite passes with ≥ 90% of routing cases matching OpenCode behavior.
- [ ] Full CI passes (typecheck, tests, lint) in the `groundwork` repo.
