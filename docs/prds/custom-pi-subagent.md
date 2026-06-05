# Custom Pi-Subagent System PRD

**Date:** 2026-06-05  
**Author:** Groundwork Team  
**Status:** Proposed  
**Replaces:** pi-subagents runtime/user-installed dependency

---

## 1. Problem Statement

The groundwork plugin currently depends on the external `pi-subagents` npm package for subagent execution. This dependency has a critical limitation: **model selection is baked into agent `.md` frontmatter with NO runtime model override capability**. Users cannot specify custom models at invocation time, forcing them to edit agent files or maintain duplicate agents for different models.

Additionally, maintaining an external dependency creates:
- Version coupling and breaking change risks
- Limited ability to customize or extend functionality
- Blocking issues when upstream changes are needed
- Reduced control over execution flow and error handling

---

## 2. Goals & Non-Goals

### Goals

1. **Custom Model Support**: Enable runtime model string specification at subagent invocation time, bypassing the Pi model registry
2. **MVP + Staged Parity**: Implement MVP (single/parallel/chain execution) with explicit later phases for async/background/artifacts
3. **In-Process Execution**: Use Pi SDK (`createAgentSession`) directly instead of CLI subprocess for better control and streaming
4. **Reduce Dependencies**: Eliminate the external pi-subagents runtime/user-installed dependency
5. **Clean Architecture**: Remove opencode background-task system code that's no longer needed
6. **Staged Migration**: Implement feature flags for safe cutover without disrupting existing workflows

### Non-Goals

1. **Reimplementing Pi SDK**: We use the SDK as-is, not rebuild it
2. **Supporting All Providers Initially**: Focus on OpenAI and Anthropic first, extend later
3. **Full TUI Components**: Defer terminal UI components to a later phase
4. **Async/Background Mode**: Initial implementation focuses on synchronous execution
5. **Artifacts System**: Deferred to Phase 6+ (post-MVP)

---

## 3. Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Groundwork Plugin                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Custom Subagent Tool                     │   │
│  │  (src/tools/subagent.ts)                              │   │
│  │                                                       │   │
│  │  - Accepts: agent, task, model?, thinking?, opts     │   │
│  │  - Creates: Pi SDK session with custom Model object  │   │
│  │  - Streams: Events via session.subscribe()           │   │
│  │  - Returns: Structured response with outputs          │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                                │
│                              ▼                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Agent Setup & Discovery                  │   │
│  │  (src/lib/agent-setup.ts - retained)                  │   │
│  │                                                       │   │
│  │  - Loads agent .md files from standard locations     │   │
│  │  - Parses frontmatter (model, thinking, tools, etc.) │   │
│  │  - Provides default model/thinking if not overridden │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                                │
│                              ▼                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Pi SDK (createAgentSession)              │   │
│  │                                                       │   │
│  │  - Accepts custom Model<"openai-completions">        │   │
│  │  - No registry validation at creation time           │   │
│  │  - Resolves API keys via <PROVIDER>_API_KEY env      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Model Resolution Precedence

```
1. Runtime override (model param in tool call)
         ↓
2. Config mapping (user settings.json)
         ↓
3. Agent .md frontmatter default
         ↓
4. Embedded fallback (from pi-subagents audit)
```

### Execution Flow

```
User Request → Subagent Tool → Agent Discovery → Model Resolution
      ↓
Create Session (custom Model object) → Subscribe to Events
      ↓
Execute Prompt → Stream Updates → Handle Tool Calls
      ↓
Return Result → Parse Outputs → Format Response
```

---

## 4. Feature Specification

### 4.1 Core Execution Modes

#### Single Agent Execution
- **Input**: agent name, task string, optional model/thinking overrides
- **Output**: response text, structured outputs (if defined), execution metadata
- **Streaming**: text_delta, tool_call_start/end, progress updates
- **Error Handling**: graceful failures with retry logic

#### Parallel Execution
- **Concurrency Limits**: Configurable max parallel agents (default: 3)
- **Worktree Isolation**: Each parallel agent gets isolated context
- **Aggregation**: Combine results with source attribution
- **Failure Isolation**: One agent failure doesn't block others

#### Chain Execution
- **Sequential Steps**: Define ordered agent invocations
- **Template Variables**:
  - `{previous}`: Output from previous step
  - `{task}`: Original task string
  - `{outputs.<name>}`: Named outputs from previous steps
- **Dynamic Fanout**: Structured output can trigger parallel branches
- **Early Termination**: Stop chain on criteria met (stopRules)

### 4.2 Model Configuration

#### Custom Model Strings
- **Format**: `provider/model-id` (e.g., `openai/gpt-4o`, `anthropic/claude-sonnet-4-20250514`)
- **Provider Mapping**:
  - `openai` → `api: "openai-completions"`, `provider: "openai"`
  - `anthropic` → `api: "anthropic-messages"`, `provider: "anthropic"`
- **Env Key Resolution**: `<PROVIDER>_API_KEY` (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`)

#### Fallback Chains
- **Primary Model**: Specified in call or agent frontmatter
- **Fallback Array**: `fallbackModels: ["anthropic/claude-sonnet-4-20250514", "openai/gpt-4o-mini"]`
- **Retry Detection**: Identify retryable failures (rate limits, timeouts) vs permanent errors
- **Automatic Fallback**: On retryable failure, try next model in chain

### 4.3 Agent Discovery & Configuration

#### Discovery Locations
1. **Builtin**: `@pi/agent` package agents
2. **User**: `~/.pi/agent/agents/`
3. **Project**: `.pi/agents/` (relative to project root)

#### Frontmatter Support
- `model`: Default model string
- `thinking`: Thinking mode config (budget, style)
- `tools`: Tool enablement list
- `skills`: Skill references
- `systemPromptMode`: System prompt handling
- `fallbackModels`: Array of fallback model strings
- `completionGuard`: Safety checks
- `maxSubagentDepth`: Nested execution limit
- `context`: `fresh` or `fork` mode

#### Settings Overrides
- Load from `~/.pi/agent/settings.json`
- Override frontmatter defaults
- Per-agent or global settings

### 4.4 Execution Control

#### Abort & Timeout
- **AbortSignal**: Standard JS AbortSignal support
- **SIGUSR2**: Graceful interrupt handling
- **HTTP Timeout**: Per-task `--http-timeout` (inherited from Pi SDK)
- **Cleanup**: Proper session termination on abort

#### Depth Limiting
- **Max Depth Config**: `maxSubagentDepth` (default: 3)
- **Tracking**: Pass current depth in context
- **Enforcement**: Reject nested calls exceeding limit

#### Activity States
- `needs_attention`: User input required
- `active_long_running`: Still executing, no output recently
- `done`: Completed successfully
- `error`: Failed with error

### 4.5 Streaming & Updates

#### Event Types (via session.subscribe)
- `text_delta`: Incremental text output
- `toolcall_start`: Tool invocation beginning
- `toolcall_end`: Tool completion with result
- `progress`: Structured progress updates
- `done`: Final completion
- `error`: Error with details
- `auto_retry`: Retry initiated (for fallback models)

#### onUpdate Callback
```typescript
interface UpdateEvent {
  type: 'text_delta' | 'tool_call' | 'progress' | 'done' | 'error';
  agent: string;
  content: string | ToolCall | ProgressData | Result | Error;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
```

### 4.6 Acceptance & Verification

#### Acceptance Contracts
- **criteria**: List of acceptance criteria strings
- **verify**: Verification command or script
- **review**: Reviewer assignment
- **stopRules**: Conditions to halt execution

#### Output Validation
- Schema validation for structured outputs
- Contract satisfaction checking
- Automated verification execution

### 4.7 Management Actions

- `list`: Available agents with metadata
- `get <name>`: Single agent details
- `create <name>`: New agent scaffold
- `update <name>`: Modify agent config
- `delete <name>`: Remove agent
- `status <id>`: Check execution state (future async support)
- `interrupt <id>`: Stop running agent (future async support)
- `resume <id>`: Resume interrupted agent (future async support)
- `doctor`: Diagnostic and health check

---

## 5. File Plan

### 5.1 New Files

| File | Purpose |
|------|---------|
| `src/tools/subagent.ts` | Main subagent tool implementation |
| `src/lib/model-resolver.ts` | Model string parsing and resolution |
| `src/lib/execution-modes.ts` | Single/parallel/chain execution logic |
| `src/lib/fallback-handler.ts` | Model fallback chain management |
| `src/lib/streaming.ts` | Event subscription and streaming |
| `src/lib/chain-engine.ts` | Chain execution with template variables |
| `src/lib/parallel-executor.ts` | Concurrent agent execution |
| `src/types/subagent.ts` | TypeScript types and interfaces |
| `src/lib/acceptance.ts` | Acceptance contract validation |
| `config/subagent.json` | Feature flag and configuration |

### 5.2 Modified Files

| File | Changes |
|------|---------|
| `.opencode/plugins/groundwork.js` | Remove background tools, add subagent tool registration |
| `skills/groundwork/using-workflow/SKILL.md` | Rewrite for custom subagent system |
| `src/lib/helpers.ts` | Keep shared utils, remove background-specific helpers |
| `src/lib/snapshot.ts` | Keep snapshot logic, update imports |
| `commands/using-workflow.md` | Update documentation |
| `README.md` | Remove pi-subagents runtime dependency reference |
| `src/pi.ts` | Update Pi tool registration and imports |
| `src/index.ts` | Update main entry point exports |
| `src/lib/agent-setup.ts` | Retain and update agent discovery logic |

### 5.3 Deleted Files

| File | Reason |
|------|--------|
| `src/tools/background-task.ts` | Replaced by custom subagent system |
| `src/tools/background-cancel.ts` | Obsolete |
| `src/tools/background-output.ts` | Obsolete |
| `src/tools/background-list.ts` | Obsolete |
| `src/tools/background-wait.ts` | Obsolete |
| `src/tools/background-input.ts` | Obsolete |
| `src/tools/background-status.ts` | Obsolete |
| `src/tools/background-stream.ts` | Obsolete |
| `src/lib/background-manager.ts` | Replaced by custom subagent system |
| `src/lib/persistence.ts` | Opencode background persistence not needed |
| `src/lib/concurrency.ts` | Replaced by parallel-executor.ts |
| `src/lib/preamble.ts` | Opencode-specific, not needed |
| `src/lib/task-formatting.ts` | Replaced by streaming.ts |
| `src/lib/singletons.ts` | Opencode background singletons |
| `tests/concurrency-persistence.test.ts` | Obsolete tests |

### 5.4 Unaffected Files (~35+)

All other files remain unchanged, including:
- Agent definition files
- Most command files
- Test files (except background-*.test.ts)
- Documentation (except using-workflow)
- Assets

---

## 6. Implementation Phases

### Phase 1: Foundation (Week 1)

**Deliverables:**
- [ ] `src/lib/model-resolver.ts` - Parse model strings, create Model objects
- [ ] `src/lib/streaming.ts` - Event subscription and handling
- [ ] `src/tools/subagent.ts` - Basic single-agent execution
- [ ] `src/types/subagent.ts` - Type definitions
- [ ] `config/subagent.json` - Feature flag setup
- **Migration Scope**: `src/lib/agent-setup.ts`, `src/pi.ts`

**Acceptance Criteria:**
- Can invoke single agent with custom model string
- Streaming events captured and logged
- Model fallback works for retryable errors

### Phase 2: Execution Modes (Week 2)

**Deliverables:**
- [ ] `src/lib/parallel-executor.ts` - Concurrent execution with limits
- [ ] `src/lib/chain-engine.ts` - Sequential chain with template variables
- [ ] Enhanced `src/tools/subagent.ts` - Mode switching
- [ ] `src/lib/acceptance.ts` - Contract validation

**Acceptance Criteria:**
- Parallel execution respects concurrency limits
- Chain execution passes context between steps
- Acceptance contracts validated post-execution

### Phase 3: Control & Management (Week 3)

**Deliverables:**
- [ ] Abort/timeout handling in all execution modes
- [ ] Depth tracking and limiting
- [ ] Activity state machine
- [ ] Management tool actions (list, get, status, etc.)

**Acceptance Criteria:**
- Can abort running agents gracefully
- Nested depth limited correctly
- Activity states reported accurately

### Phase 4: Cleanup & Migration (Week 4)

**Deliverables:**
- [ ] Delete background-* files (see Deleted Files section)
- [ ] Modify `.opencode/plugins/groundwork.js`, `src/pi.ts`, `src/index.ts`, `helpers.ts`
- [ ] Update using-workflow documentation
- [ ] Remove pi-subagents from README (not in package.json - runtime dep)
- [ ] Migration guide in docs/

**Acceptance Criteria:**
- No references to old background system remain
- All imports resolved correctly
- Documentation updated

### Phase 5: Testing & Polish (Week 5)

**Deliverables:**
- [ ] Comprehensive test suite
- [ ] Error handling improvements
- [ ] Performance optimization
- [ ] User feedback integration

**Acceptance Criteria:**
- All tests pass
- Error messages are helpful
- Performance matches or exceeds pi-subagents

---

## 7. Test Plan

### Unit Tests

| Module | Test Cases |
|--------|-----------|
| `model-resolver.ts` | Parse valid strings, reject invalid, provider mapping, env key resolution |
| `fallback-handler.ts` | Retry detection, fallback chain traversal, success/failure tracking |
| `streaming.ts` | Event subscription, event type handling, error propagation |
| `chain-engine.ts` | Template variable substitution, dynamic fanout, early termination |
| `parallel-executor.ts` | Concurrency limiting, result aggregation, failure isolation |
| `acceptance.ts` | Criteria validation, contract satisfaction, stopRules evaluation |

### Integration Tests

| Scenario | Verification |
|----------|--------------|
| Single agent with custom model | Correct model used, response returned |
| Model fallback on rate limit | Falls back to secondary model, succeeds |
| Parallel execution (n=3) | All 3 execute concurrently, results aggregated |
| Chain with 3 steps | Context flows correctly, outputs available |
| Abort mid-execution | Session terminated, cleanup completed |
| Depth limit exceeded | Error returned, no execution |

### End-to-End Tests

1. **Basic Subagent Call**: User invokes subagent → custom model → response
2. **Parallel Research**: Split task across 3 agents → combined result
3. **Chain Workflow**: Research → Outline → Write → Review chain
4. **Fallback Scenario**: Primary model fails → fallback succeeds
5. **Interrupt & Resume**: Start agent → interrupt → check status (future)

### Performance Tests

- **Concurrency**: Measure throughput with varying parallel agent counts
- **Latency**: Time from invocation to first token
- **Memory**: Session memory usage over time
- **Fallback Overhead**: Time penalty for fallback chain traversal

---

## 8. Migration Plan

### Step 1: Feature Flag (Day 1)
- Add `subagent.enabled` flag to config
- Default: `false` (uses pi-subagents)
- Users can opt-in to test custom implementation

### Step 2: Parallel Testing (Week 2-3)
- Run both systems side-by-side internally
- Compare outputs, performance, reliability
- Gather feedback from beta testers

### Step 3: Documentation Update (Week 4)
- Update `commands/using-workflow.md`
- Create migration guide in `docs/migration-subagent.md`
- Document new model string format and capabilities

### Step 4: Deprecation Notice (Week 4)
- Add deprecation warning to pi-subagents usage
- Point users to new custom subagent tool
- Set timeline for removal (2 weeks notice)

### Step 5: Cleanup (Week 4)
- Remove pi-subagents from README.md (runtime dependency, not in package.json)
- Delete background-* files (see Deleted Files section)
- Update all imports and references

### Step 6: Enable by Default (Week 5)
- Flip feature flag to `true`
- Monitor for issues
- Keep opt-out available for 1 week

### Rollback Plan
If critical issues arise:
1. Flip feature flag back to `false`
2. pi-subagents remains as fallback
3. Debug and fix issues
4. Re-enable when resolved

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Model API key resolution fails** | Medium | High | Clear error messages, env var validation, fallback to default provider |
| **Streaming events lost or delayed** | Low | Medium | Buffer events, implement acknowledgment, add timeout recovery |
| **Parallel execution causes race conditions** | Medium | Medium | Use async/await properly, isolate contexts, test concurrent scenarios |
| **Chain template variables undefined** | Low | Medium | Validate before execution, provide defaults, clear error messages |
| **Fallback chain infinite loop** | Low | High | Track attempted models, max attempts limit, circular reference detection |
| **Depth limit not enforced correctly** | Low | Medium | Pass depth in immutable context, validate at entry point |
| **pi-subagents removal breaks existing workflows** | Medium | High | Feature flag, deprecation period, migration guide, rollback plan |
| **Custom model strings incompatible with Pi SDK** | Low | High | Validate against known providers, test with real API calls, maintain compatibility layer |
| **Abandoned sessions leak resources** | Medium | Medium | Implement cleanup on abort/timeout, periodic orphan detection, memory profiling |

### Risk Monitoring
- Weekly review of error logs during rollout
- User feedback channel for issues
- Performance metrics dashboard
- Automated alerts for high error rates

---

## 10. Success Criteria

### Functional Success
- [ ] All core pi-subagents features matched or exceeded
- [ ] Custom model strings work with OpenAI and Anthropic
- [ ] Single, parallel, and chain execution modes functional
- [ ] Model fallback chains operate correctly
- [ ] Streaming events captured and processed
- [ ] Abort and timeout handling works reliably

### Performance Success
- [ ] Latency ≤ pi-subagents baseline (p50, p95, p99)
- [ ] Memory usage ≤ pi-subagents baseline
- [ ] Concurrent execution scales linearly to configured limit
- [ ] No resource leaks after 100+ invocations

### User Success
- [ ] Users can specify any model at invocation time
- [ ] Clear documentation and examples provided
- [ ] Migration from pi-subagents completed without data loss
- [ ] User satisfaction ≥ 4.5/5 in feedback survey
- [ ] Support tickets related to subagents decrease by 50%

### Code Quality Success
- [ ] 90%+ test coverage on new code
- [ ] All existing tests pass after migration
- [ ] No TypeScript errors or linting issues
- [ ] Code review approval from 2+ team members
- [ ] Documentation complete and accurate

### Business Success
- [ ] Eliminate external pi-subagents dependency
- [ ] Reduce dependency count in package.json
- [ ] Enable future feature development (blocked by external dep)
- [ ] Improve troubleshooting and debugging capability
- [ ] Establish pattern for future native implementations

---

## Appendix A: Model String Examples

```
# OpenAI Models
openai/gpt-4o
openai/gpt-4o-mini
openai/o1-preview
openai/o1-mini

# Anthropic Models
anthropic/claude-sonnet-4-20250514
anthropic/claude-opus-4-20250514
anthropic/claude-3-5-sonnet-20241022

# With Config Override (settings.json)
{
  "modelAliases": {
    "fast": "openai/gpt-4o-mini",
    "smart": "anthropic/claude-opus-4-20250514"
  }
}

# Invocation
@subagent agent=researcher task="..." model="smart"
```

## Appendix B: Tool Invocation Examples

```typescript
// Single agent with custom model
await tools.subagent({
  agent: 'researcher',
  task: 'Research emerging AI trends',
  model: 'anthropic/claude-sonnet-4-20250514',
  thinking: { budget: 2000 }
});

// Parallel execution
await tools.subagent({
  mode: 'parallel',
  agents: ['researcher', 'analyst', 'writer'],
  task: 'Create comprehensive market analysis',
  concurrency: 3
});

// Chain execution
await tools.subagent({
  mode: 'chain',
  steps: [
    { agent: 'researcher', task: 'Gather data on {topic}' },
    { agent: 'analyst', task: 'Analyze findings from {previous}' },
    { agent: 'writer', task: 'Write report using {outputs.analysis}' }
  ],
  variables: { topic: 'quantum computing' }
});
```

## Appendix C: Environment Variables

```bash
# Required for custom model support
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional configuration
PI_SUBAGENT_MAX_DEPTH=3
PI_SUBAGENT_CONCURRENCY=3
PI_SUBAGENT_TIMEOUT=300
```

---

**End of PRD**
