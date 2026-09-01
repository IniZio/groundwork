---
id: enforcement-r-005
type: requirement
concept: C-ENFORCEMENT
title: Ledger-bash-guard blocks subagent bash manipulation of ledger and seal key
status: implemented
verification: unverified
criticality: must
design: "[[design/reference/enforcement-hooks-reference]]"
---

## ENFORCEMENT-R-005 — Ledger-bash-guard blocks subagent bash manipulation of ledger and seal key {#enforcement-r-005}

If a Bash command from a subagent contains filesystem mutation patterns targeting the run-ledger or seal-key path (shell redirect, `tee`, `sed -i`, `mv`, `cp`, `rm`, `chmod`, or `jq` redirect), then the enforcement hook **shall** deny it; if a Bash command from a subagent contains seal-key exfiltration patterns (`cat`, `head`, `tail`, `xxd`, or `od` on a `.seal.key` path), then the enforcement hook **shall** deny it; if a Bash command from a subagent invokes a mutating ledger CLI subcommand (`init`, `set`, `complete`, `gate`, `abandon`, `autopilot`, `rm`, `scope-token`) without a `sct_`-prefixed scoped token, then the enforcement hook **shall** deny it; read-only CLI subcommands (`status`, `view`, `show`, `help`) **shall** pass through.

- **Why** — Bash commands bypass the tool-level ledger-guard blocks. A subagent can construct `echo '{"gate":{"advisor":"APPROVE"}}' > .groundwork/runs/<id>.json` or `jq '.gate.advisor="APPROVE"' ... > .groundwork/runs/<id>.json` to write an APPROVE verdict without the orchestrator write token, releasing the stop-gate and bypassing the seal check. This attack is documented in the `stopgate-token-bypass` session memory note. The seal key exfiltration rules prevent a subagent from reading the key and using it to forge a valid seal.
- **Fit criterion** — Running the hook with a subagent Bash payload containing `jq '.gate.advisor="APPROVE"' .groundwork/runs/s.json > .groundwork/runs/s.json` returns deny. Running with a subagent Bash payload containing `bin/ledger status` returns passthrough. Running from the primary orchestrator (no `agent_type`/`agent_id`) returns passthrough for all commands.
- **Verification**: unverified — no dedicated test file exists yet; hook is implemented at `hooks/ledger-bash-guard.mjs`.
- **Criticality**: must
