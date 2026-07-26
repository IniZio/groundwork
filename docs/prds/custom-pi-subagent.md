> ⚠️ **OBSOLETE (2026-07-25).** This PRD documents the vanilla-pi custom-subagent feature, which was removed in commit `624ce2d` (`pi/pi-commands/agents.ts` stripped; omp supersedes it via generated `agents-pi/` + `model-registry.json`). The `src/pi.ts` path references below are historical — the pi extension now lives at `pi/pi.ts`. Retained as a historical artifact; do not implement from this spec.

# Custom Pi-Subagent Model Support PRD

**Date:** 2026-06-05  
**Author:** Groundwork Team  
**Status:** Proposed  
**Complements:** pi-subagents (runtime dependency, unchanged)

---

## 1. Problem Statement

The groundwork plugin uses `pi-subagents` for subagent execution. pi-subagents already supports `model` and `thinking` params in its tool schema — these flow through to the `--model` CLI flag on `pi` invocations. However, **custom model strings like `neuralwatt/glm-5.1-fast` fail at the CLI level** because `neuralwatt` is not in Pi's built-in model registry.

The blocker is not a missing feature in pi-subagents — it's that Pi's model registry doesn't know about custom/third-party providers. Once the registry is aware of a provider, the existing `model` param in pi-subagents works end-to-end.

---

## 2. Goals & Non-Goals

### Goals

1. **Custom Provider Resolution**: Register custom model providers via `pi.registerProvider()` so that custom model strings resolve correctly at the CLI level
2. **Zero Forking**: No forking, patching, or replacing pi-subagents — the existing tool schema already supports `model` and `thinking`
3. **Config-Driven Providers**: Allow users to declare custom providers in config (optional), with sensible defaults for known providers
4. **Clean Architecture**: Remove opencode background-task system code that's no longer needed
5. **Staged Rollout**: Register built-in providers first, then add user-configurable provider file

### Non-Goals

1. **Replacing pi-subagents**: We are NOT building a custom subagent tool — pi-subagents stays as-is
2. **In-Process SDK Execution**: No `createAgentSession` — we continue using CLI-based execution via pi-subagents
3. **Custom Execution Modes**: No parallel/chain engine — those belong in pi-subagents if needed
4. **Full Provider Shimming**: We only register providers; we don't shim or override API call behavior
5. **Artifacts System**: Deferred entirely

---

## 3. Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                    Groundwork Plugin                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Provider Registry                         │   │
│  │  (src/lib/provider-registry.ts)                       │   │
│  │                                                       │   │
│  │  - Calls pi.registerProvider() at extension load time │   │
│  │  - Maps provider names → api, baseURL, envKey        │   │
│  │  - Loads optional user config from providers.json     │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                                │
│                              ▼                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Pi Extension Load (src/pi.ts)             │   │
│  │                                                       │   │
│  │  - On activate: call registerAllProviders()           │   │
│  │  - Providers become known to Pi's model registry      │   │
│  └──────────────────────────────────────────────────────┘   │
│                              │                                │
│                              ▼                                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              pi-subagents (unchanged)                  │   │
│  │                                                       │   │
│  │  - Tool schema already has model + thinking params    │   │
│  │  - model param flows to --model CLI flag              │   │
│  │  - Now resolves because provider is in registry       │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### How It Works End-to-End

1. Groundwork extension loads → calls `pi.registerProvider("neuralwatt", { api, baseURL, envKey })` 
2. Pi's model registry now knows that `neuralwatt/*` model strings are valid
3. User calls `subagent({ agent: "coder", model: "neuralwatt/glm-5.1-fast" })`
4. pi-subagents passes `--model neuralwatt/glm-5.1-fast` to the CLI
5. Pi resolves the model string using the registered provider → success

### Model Resolution Precedence (unchanged)

```
1. Runtime override (model param in tool call)       ← NOW WORKS with custom providers
         ↓
2. Config mapping (user settings.json)
         ↓
3. Agent .md frontmatter default
         ↓
4. Embedded fallback (from pi-subagents audit)
```

---

## 4. Feature Specification

### 4.1 Provider Registration

#### Built-In Providers
The extension registers commonly-used providers at load time so they resolve without any user configuration:

| Provider | API | Base URL | Env Key |
|----------|-----|----------|---------|
| `neuralwatt` | `openai-completions` | `https://api.neuralwatt.com/v1` | `NEURALWATT_API_KEY` |
| `openrouter` | `openai-completions` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` |
| `groq` | `openai-completions` | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` |

These are registered via `pi.registerProvider()` in the extension's `activate()` hook.

#### User-Configurable Providers (Optional — Phase 2)
Users can declare additional providers in a config file:

```json
// ~/.pi/providers.json
{
  "my-custom": {
    "api": "openai-completions",
    "baseURL": "https://my-llm-gateway.example.com/v1",
    "envKey": "MY_CUSTOM_API_KEY"
  }
}
```

On load, the registry reads this file and calls `pi.registerProvider()` for each entry.

### 4.2 Registration Call Format

```typescript
pi.registerProvider("neuralwatt", {
  api: "openai-completions",   // API protocol to use
  baseURL: "https://api.neuralwatt.com/v1",
  envKey: "NEURALWATT_API_KEY"  // Env var for API key
});
```

### 4.3 Validation

- Provider names must match `/^[a-z0-9-]+$/`
- API must be one of: `openai-completions`, `anthropic-messages`
- `baseURL` must be a valid HTTPS URL
- `envKey` must be set in environment (warn at load time if missing, do not block)

### 4.4 Background-Task Cleanup

The existing opencode background-task system (`src/tools/background-*.ts`, `src/lib/background-manager.ts`, etc.) is still planned for removal. This cleanup is independent of the provider registry work:

- **Remove**: `src/tools/background-*.ts` (8 files), `src/lib/background-manager.ts`, `src/lib/persistence.ts`, `src/lib/concurrency.ts`, `src/lib/preamble.ts`, `src/lib/task-formatting.ts`, `src/lib/singletons.ts`
- **Retain**: All pi-subagents tooling, agent discovery, snapshot logic

---

## 5. File Plan

### 5.1 New Files

| File | Purpose |
|------|---------|
| `src/lib/provider-registry.ts` | Provider registration logic: built-ins + optional user config loading |
| `config/providers.json` (optional) | User-configurable provider definitions |

### 5.2 Modified Files

| File | Changes |
|------|---------|
| `src/pi.ts` | Call `registerAllProviders()` in extension activate hook |
| `README.md` | Document custom provider support, clarify pi-subagents is still used |

### 5.3 Deleted Files (Background-Task Cleanup — separate phase)

| File | Reason |
|------|--------|
| `src/tools/background-task.ts` | Obsolete opencode background system |
| `src/tools/background-cancel.ts` | Obsolete |
| `src/tools/background-output.ts` | Obsolete |
| `src/tools/background-list.ts` | Obsolete |
| `src/tools/background-wait.ts` | Obsolete |
| `src/tools/background-input.ts` | Obsolete |
| `src/tools/background-status.ts` | Obsolete |
| `src/tools/background-stream.ts` | Obsolete |
| `src/lib/background-manager.ts` | Obsolete |
| `src/lib/persistence.ts` | Obsolete |
| `src/lib/concurrency.ts` | Obsolete |
| `src/lib/preamble.ts` | Obsolete |
| `src/lib/task-formatting.ts` | Obsolete |
| `src/lib/singletons.ts` | Obsolete |
| `tests/concurrency-persistence.test.ts` | Obsolete tests |

### 5.4 Unaffected Files

All other files remain unchanged, including:
- pi-subagents integration code (no changes needed)
- Agent definition files
- Command files
- Most test files
- Documentation (except README)
- Assets

---

## 6. Implementation Phases

### Phase 1: Built-In Provider Registration (Day 1-2)

**Deliverables:**
- [ ] `src/lib/provider-registry.ts` — `registerAllProviders()` with built-in provider table
- [ ] `src/pi.ts` — Call `registerAllProviders()` in extension activate hook
- [ ] Validation logic for provider names, API types, URLs
- [ ] Warning logs for missing API keys (non-blocking)

**Acceptance Criteria:**
- `subagent({ agent: "coder", model: "neuralwatt/glm-5.1-fast" })` resolves and executes
- `subagent({ agent: "coder", model: "openrouter/anthropic/claude-sonnet-4-20250514" })` resolves and executes
- Missing API key produces a clear warning, not a crash
- Built-in providers listed above are registered and functional

### Phase 2: User-Configurable Providers + Cleanup (Day 3-5)

**Deliverables:**
- [ ] `config/providers.json` loading from `~/.pi/providers.json`
- [ ] Merge user providers with built-ins (user overrides built-in on conflict)
- [ ] Delete background-task files (see section 5.3)
- [ ] Update README.md

**Acceptance Criteria:**
- Custom provider in `~/.pi/providers.json` is registered and resolves
- User provider with same name as built-in takes precedence
- Background-task files removed, no dangling imports
- Documentation updated

---

## 7. Test Plan

### Unit Tests

| Module | Test Cases |
|--------|-----------|
| `provider-registry.ts` | Built-in providers register correctly, user config loads and merges, validation rejects invalid entries, missing env key produces warning |

### Integration Tests

| Scenario | Verification |
|----------|--------------|
| Built-in provider resolves via pi-subagents | `model: "neuralwatt/glm-5.1-fast"` works end-to-end |
| Custom provider from config resolves | User-declared provider string works |
| Missing API key warning | Warning logged, execution fails with clear error at API call time |
| Duplicate provider name | User config overrides built-in |

### End-to-End Tests

1. **Basic Custom Model**: Invoke subagent with `neuralwatt/glm-5.1-fast` → receives response
2. **OpenRouter Model**: Invoke subagent with `openrouter/anthropic/claude-sonnet-4-20250514` → receives response
3. **User Custom Provider**: Add provider to `~/.pi/providers.json` → invoke with that model string → works
4. **Missing Provider**: Use unregistered provider string → clear error about unknown provider

---

## 8. Migration Plan

This is additive — no migration needed. Existing pi-subagents usage continues unchanged. Users gain the ability to use custom model strings.

### Rollback Plan
If issues arise:
1. Comment out `registerAllProviders()` call in `src/pi.ts`
2. All custom model strings fail gracefully (same as before this PRD)
3. Debug and re-enable

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **`pi.registerProvider()` API differs from assumed** | Medium | High | Verify API signature before implementation, check Pi docs/source |
| **Provider registered but API key missing** | High | Medium | Warn at load time, let runtime produce clear error |
| **Built-in provider list becomes stale** | Low | Low | Make list configurable, accept PRs for new providers |
| **Background-task removal breaks something** | Medium | Medium | Separate PR, full test coverage, verify no dangling imports |
| **User config file malformed** | Medium | Low | Validate JSON, skip invalid entries, log warnings |

---

## 10. Success Criteria

### Functional Success
- [ ] `subagent({ agent, model: "neuralwatt/glm-5.1-fast" })` works end-to-end
- [ ] Built-in providers (neuralwatt, openrouter, groq) resolve correctly
- [ ] User-configurable providers load from `~/.pi/providers.json`
- [ ] pi-subagents requires zero modifications

### Code Quality Success
- [ ] All existing tests pass
- [ ] New provider-registry tests pass
- [ ] No TypeScript errors or linting issues
- [ ] Documentation updated

### Simplicity Success
- [ ] Only 1 new source file (`provider-registry.ts`)
- [ ] Only 1 modified source file (`src/pi.ts`)
- [ ] No forked dependencies, no custom tool implementations
- [ ] Total implementation ≤ 100 lines of new code

---

## Appendix A: Provider Registration Example

```typescript
// src/lib/provider-registry.ts

const BUILT_IN_PROVIDERS = {
  neuralwatt: {
    api: "openai-completions",
    baseURL: "https://api.neuralwatt.com/v1",
    envKey: "NEURALWATT_API_KEY",
  },
  openrouter: {
    api: "openai-completions",
    baseURL: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
  },
  groq: {
    api: "openai-completions",
    baseURL: "https://api.groq.com/openai/v1",
    envKey: "GROQ_API_KEY",
  },
} as const;

export function registerAllProviders(pi: Pi): void {
  for (const [name, config] of Object.entries(BUILT_IN_PROVIDERS)) {
    pi.registerProvider(name, config);
    if (!process.env[config.envKey]) {
      console.warn(`[groundwork] Provider "${name}" registered but ${config.envKey} is not set`);
    }
  }
}
```

## Appendix B: End-to-End Flow

```
1. Extension loads
   └→ src/pi.ts activate() calls registerAllProviders(pi)
      └→ pi.registerProvider("neuralwatt", {...})
      └→ pi.registerProvider("openrouter", {...})
      └→ pi.registerProvider("groq", {...})

2. User invokes subagent
   └→ subagent({ agent: "coder", model: "neuralwatt/glm-5.1-fast" })

3. pi-subagents processes the call
   └→ Passes --model neuralwatt/glm-5.1-fast to pi CLI

4. Pi CLI resolves model string
   └→ Looks up "neuralwatt" in registry → FOUND (registered in step 1)
   └→ Uses api: "openai-completions", baseURL from registration
   └→ Resolves API key from NEURALWATT_API_KEY env var

5. Execution proceeds normally
   └→ Response returned to user
```

---

**End of PRD**
