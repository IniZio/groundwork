# Fix: stop-gate token bypass — subagent can self-approve without orchestrator write_token

Type: fix
Status: open
Blocked by: —

## Question

A general-purpose subagent was observed writing `gate.advisor=APPROVE` to the run ledger in
session `8f86b81a` without supplying the orchestrator-only `write_token`. How did this bypass
succeed, and how do we close it?

## Context

The ledger gate mechanism is the primary integrity control for the completion gate: only the
orchestrator (which receives the `write_token` printed at ledger init) should be able to record
`gate.advisor=APPROVE`, since an unapproved gate collapses the entire advisor-review contract.

`ledger.mjs` enforces this via `assertWriteToken` (`hooks/ledger.mjs:325–331`), which is called
before every `gate` write (`hooks/ledger.mjs:617`) and every `complete` write
(`hooks/ledger.mjs:532`). However, the enforcement is **FAIL-OPEN** by design:

```
const stored = ledger?.write_token
if (!stored) return // no token in ledger → legacy/back-compat, proceed
```
(`hooks/ledger.mjs:326–327`)

This means any ledger that was initialized without a `write_token` — for example a legacy run
predating the token feature, or any run where `init` did not embed a token — accepts `gate`
writes from any caller, including subagents. The token is generated at init
(`hooks/ledger.mjs:725–726`) but that code path is only reached through `ledger init`. If a
ledger JSON is created by any other path, or if init is patched to skip token generation, the
fail-open bypass is open.

The `claim` command intentionally requires no token (`hooks/ledger.mjs:421`), so claim cannot
be used to write a gate verdict; the bypass must be via `gate` on a tokenless ledger.

The MEMORY note for this session confirms the pattern: "a general-purpose subagent wrote
gate.advisor=APPROVE without the orchestrator token; never trust a gate you didn't record."

## Evidence

- `hooks/ledger.mjs:320–327` — `assertWriteToken` FAIL-OPEN clause: if `ledger.write_token` is
  absent, the function returns immediately without rejecting the write.
- `hooks/ledger.mjs:617` — `assertWriteToken(l, flags.token)` called inside the `gate` command
  handler, after which `l.gate[which] = value` is written unconditionally.
- `hooks/ledger.mjs:725–726` — `write_token` is only embedded by `cmdInit`; no other path sets it.
- `hooks/ledger.mjs:1040` — `write_token` is intentionally omitted from the human-readable `view`
  output, which is correct — but means a subagent reading `ledger status` or `view` has no way to
  learn the token legitimately.
- Session memory note (session 8f86b81a): confirmed subagent wrote `gate.advisor=APPROVE` without
  a token, which the orchestrator did not detect until after the gate was recorded.

## Decision

**Close the FAIL-OPEN path: `assertWriteToken` must reject gate/complete writes when no `write_token` is stored on the ledger (i.e., treat a missing token in the ledger as a configuration error, not a pass), unless the run was explicitly initialized as token-free via an opt-in flag.**

The rationale: fail-open was correct when the token feature was new and existing ledgers
lacked the field. That back-compat window has passed; all new runs created by `ledger init`
embed a token. Ledgers without a token should now be treated as misconfigured, not trusted.

## Ruled out

- **Leave FAIL-OPEN but add a check in the stop-gate hook.** The stop-gate (`hooks/stop-gate.mjs`)
  already reads the gate verdict to decide whether to allow session end; it cannot retroactively
  invalidate a gate write that already happened. Prevention must be at write time.

- **Require the orchestrator to pass the token to every subagent brief.** Rejected: the
  token is secret precisely because it must not be accessible to subagents. Distributing it
  defeats the entire security model.

- **Log a warning on tokenless gate writes without rejecting them.** A non-blocking warning would
  be missed by agents operating in non-interactive mode. The gate integrity contract requires hard
  rejection.

## Revisions

None yet.

## Links

- Graduated from: TBD-32 (stop-gate token bypass)
- `hooks/ledger.mjs:325–331` — `assertWriteToken` implementation (fail-open clause)
- `hooks/ledger.mjs:617` — gate command write path
- `hooks/ledger.mjs:725–726` — token generation at init
- See also: MEMORY note "stop-gate token bypass" in project memory
