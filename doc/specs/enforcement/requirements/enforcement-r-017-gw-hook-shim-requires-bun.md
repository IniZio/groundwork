---
id: enforcement-r-017
type: requirement
concept: C-ENFORCEMENT
title: gw-hook shim selects bun as primary runtime; node fallback fails for gw source
status: implemented
verification: unverified
criticality: must
design: "[[design/concepts/hook-architecture]]"
---

## ENFORCEMENT-R-017 — gw-hook shim selects bun as primary runtime; node fallback fails for gw source {#enforcement-r-017}

If `bun` is available on PATH, the `bin/gw-hook` shim **shall** exec into `bun run src/gw/cli/main.ts` without invoking node; if `bun` is not available and `node` is available, the shim **shall** attempt `node --experimental-strip-types src/gw/cli/main.ts`, which **shall** fail with a non-zero exit code and a diagnostic on stderr identifying the missing module (`ERR_MODULE_NOT_FOUND`), because the gw source uses `.js` extension specifiers that node cannot remap to `.ts` at runtime; if neither runtime is available, the shim **shall** exit non-zero with a message instructing the operator to install bun or Node.js 22+.

Note: the `node --experimental-strip-types` fallback is structurally broken for the gw source and is documented as a known limitation. The 8 hooks that route through `bin/gw-hook` (agent-model-guard, nesting-guard, ledger-guard, ledger-bash-guard, piped-exit-code-guard, orchestrator-impl-guard, struggle-detector, stop-gate) are therefore bun-dependent in practice. Operators **shall** ensure bun is installed before deploying the plugin.

- **Why** — If bun is absent, all 8 gw-hook PreToolUse and Stop hooks fail at startup with a non-zero exit. The Claude Code harness may treat a non-zero hook exit as a block (Stop hooks) or as an unhandled error (PreToolUse), which disrupts every session. The failure mode is loud (non-zero + stderr diagnostic), not silent, so operators can identify and fix it. Documenting this as a requirement makes the bun dependency explicit rather than implicit in the shim's runtime selection logic.
- **Fit criterion** — With bun available on PATH, `echo '{}' | bin/gw-hook hook nesting-guard` exits 0 and produces empty stdout (passthrough for unrecognized input). With bun absent (e.g. `PATH=/usr/bin:/bin bin/gw-hook hook nesting-guard`), the command exits non-zero; the node fallback either exits with `ERR_MODULE_NOT_FOUND` on stderr or the shim's "no usable runtime" message appears on stderr.
- **Verification**: unverified — run `which bun` to confirm bun is installed, then verify `bin/gw-hook hook nesting-guard` exits 0 on a passthrough payload. Simulate bun-absent by temporarily prepending a PATH that excludes bun and observe the non-zero exit.
- **Criticality**: must
