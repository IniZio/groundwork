# Platform Contract

The ultrawork protocol is platform-neutral; enforcement is not.

**Claude Code / OpenCode:** The Stop-gate hook (registered in `hooks/hooks.json`) may enforce the run ledger at session end. Where the host supplies this hook, ending the session without an APPROVE verdict is mechanically blocked. Use native delegation surfaces only when the host documents them.

**Codex:** No Stop-gate guarantee from a skill alone. Use native Codex subagent/delegation tools only when they are available in the current session; otherwise execute slices sequentially. Fan-out, ledger tracking, and completion gating are advisory. Do not claim that ending the session is mechanically blocked.

**Pi:** Ledger operations are advisory. Track slice state in the plan or handoff artifact. Do not invent plugin-root paths or claim hook enforcement.
