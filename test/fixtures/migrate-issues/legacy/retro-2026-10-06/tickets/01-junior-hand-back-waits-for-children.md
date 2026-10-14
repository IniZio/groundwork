# 01: Junior-orchestrator hand-back waits for its children

**What to build:** a junior-orchestrator never returns its final report to the parent while implementers it spawned are still running. The parent receives one report, after every child has finished and been verified.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Parent

Retro of session ce8fea42 (mattpocock-skills 1.3.1 upgrade), 2026-10-06. Junior handed back with "MP-01, MP-02 and MP-03 are each running as a background implementer" and had to be resumed.

- [ ] Mechanism chosen against prior-art research, with token cost per hand-back compared (sync dispatch vs blocking SubagentStop vs parent-side wait)
- [ ] Early hand-back with a live child is impossible or rejected, proven by a test that sees both cases (child running: blocked or deferred; no child: allowed)
- [ ] No busy-loop: a blocked junior costs at most one extra turn per child completion, not one per poll

## Comments

Open question from user: a blocking hook may waste tokens by re-prompting the junior. Research on how other agent frameworks prevent early return is in flight; set `Status: ready-for-agent` once the mechanism is picked.

Research (2026-10-07):
- Prior art avoids the race structurally. LangGraph runs parallel `Send` nodes in one super-step and halts only when all are inactive. The OpenAI Agents SDK has agents-as-tools: a synchronous call where the caller keeps control. mattpocock implement-spec runs its orchestrator top-level only, so it has no sub-orchestrator hand-back. None uses a stop-hook block.
- Claude Code: the Agent tool can run synchronously with `run_in_background: false`. Whether a depth-1 subagent may do that is unverified. Blocking a SubagentStop costs one full-context turn per block, capped at 8 consecutive blocks, but the count resets on any tool call, so a block can loop without bound.
- groundwork's Stop path already treats a non-empty `background_tasks` as a yield without a block (stop-gate.ts:110-129). SubagentStop has no equivalent.
- Cheapest first: (a) the junior dispatches implementers synchronously, giving one turn after all return. (d) As a backstop, SubagentStop reports a hand-back with live `background_tasks` to the parent as pending rather than final, with no block. (b) A blocking SubagentStop is last resort.
- Spike needed: confirm `run_in_background: false` works from a depth-1 subagent, and compare the token counts in the transcript.

User decision (2026-10-07): reject foreground dispatch, since background is the officially recommended mode. Reject a blocking hook because of its token cost. Remaining direction, with zero extra junior turns: the parent treats a junior's hand-back as final only once the harness `task-notification` arrives with `status: completed`, which fires only when the junior has no live background children. A hand-back without one is pending. Optionally the junior marks such a report `status: PENDING`. Needs user confirmation before `ready-for-agent`.
