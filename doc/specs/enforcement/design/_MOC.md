# Enforcement Hooks — Design

> Map of content for the enforcement concept design folder. Start here.

---

## Start here: reading path

1. **Concepts** — understand the architecture before the mechanics
   - [[concepts/hook-architecture]] — how hooks are registered, when they fire, and how orchestrator vs. subagent identity is detected
2. **Flows** — decision paths and state machines
   - [[flows/stop-gate-decision-path]] — how the Stop hook decides whether to block, release, or emit a directive
3. **Components** — concrete artefacts
   - [[components/orchestrator-impl-guard]] — the impl-guard hook: permit list, advisory warning on non-permitted paths, fail-open variants
4. **Recipes** — how-to guides
   - [[recipes/authorize-autopilot-grant]] — how to authorize an autopilot grant when pacing budget is exhausted
5. **Reference**
   - [[reference/enforcement-hooks-reference]] — all enforcement hooks, their trigger events, and enforcement mode (hard-block vs. fail-open)

---

## Concepts — explanations

| Note | Summary |
|------|---------|
| [[concepts/hook-architecture]] | Registration model, event bus, identity detection, fail-open vs. fail-closed modes |

---

## Flows — decision paths

| Note | Summary |
|------|---------|
| [[flows/stop-gate-decision-path]] | Stop hook decision tree: incomplete slices, pacing exhaustion, awaiting_human, advisor gate |

---

## Components — design-system pages for concrete artefacts

| Note | Summary |
|------|---------|
| [[components/orchestrator-impl-guard]] | Orchestrator impl-guard hook: permit path shape, advisory warning structure, subagent pass-through |

---

## Recipes — how-to guides

| Note | Summary |
|------|---------|
| [[recipes/authorize-autopilot-grant]] | Operator-mediated autopilot grant: when to use, how to authorize, what the ledger records |

---

## Reference

| Note | Summary |
|------|---------|
| [[reference/enforcement-hooks-reference]] | All hooks, trigger events, enforcement mode, gated paths/actions, and associated requirements |

---

## Requirements (out-of-folder, same concept)

| Id | Title |
|----|-------|
| [[../requirements/enforcement-r-001-impl-guard-blocks-orchestrator-direct-edits\|ENFORCEMENT-R-001]] | Impl-guard blocks orchestrator direct edits |
| [[../requirements/pacing-r-001-wave-default-pace-policy\|PACING-R-001]] | Wave-default pace policy |
| [[../requirements/pacing-r-002-start-time-hard-block-with-exact-reason-messaging\|PACING-R-002]] | Start-time hard block |
| [[../requirements/pacing-r-003-ledger-complete-never-blocked-by-pacing\|PACING-R-003]] | `ledger complete` never blocked |
| [[../requirements/pacing-r-004-autopilot-grant-token-gated-recorded-run-scoped\|PACING-R-004]] | Autopilot grant token-gated |
| [[../requirements/pacing-r-005-pacing-exhaustion-stop-gate-release-directive-handoff\|PACING-R-005]] | Pacing exhaustion releases stop-gate |
| [[../requirements/pacing-r-006-autopilot-grant-requires-nonempty-reason\|PACING-R-006]] | HITL routing for autopilot |
| [[../requirements/pacing-r-007-milestone-policy-gates-on-human-verified-shippable\|PACING-R-007]] | Milestone policy |
| [[../requirements/pacing-r-008-milestone-signoff-requires-write-token-authority\|PACING-R-008]] | Milestone sign-off requires write_token |
| [[../requirements/pacing-r-009-milestone-artifacts-hook-validatable-staleness\|PACING-R-009]] | Milestone artifact staleness |
| [[../requirements/pacing-r-010-milestone-signoff-composes-with-awaiting-human\|PACING-R-010]] | Milestone composes with awaiting_human |
| [[../requirements/pacing-r-011-evidence-artifacts-under-groundwork-never-committed\|PACING-R-011]] | Evidence artifacts never committed |
| [[../requirements/seal-r-001-accepted-residual-ace-same-os-user\|SEAL-R-001]] | Accepted residual: ACE same OS user |
