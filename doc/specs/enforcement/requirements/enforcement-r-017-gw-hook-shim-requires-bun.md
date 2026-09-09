---
id: enforcement-r-017
type: requirement
concept: C-ENFORCEMENT
title: gw-hook shim requires bun, resolves it beyond PATH, and reports its absence legibly
status: implemented
verification: verified
criticality: must
design: "[[design/concepts/hook-architecture]]"
---

## ENFORCEMENT-R-017 — gw-hook shim requires bun, resolves it beyond PATH, and reports its absence legibly {#enforcement-r-017}

The `bin/gw-hook` shim **shall** resolve a bun executable in this order: `$GW_BUN` when set and executable, then `bun` on PATH, then the well-known locations `~/.bun/bin/bun`, `~/.local/share/mise/shims/bun`, `~/.local/share/mise/installs/bun/latest/bin/bun`, `~/.local/bin/bun`, `/usr/local/bin/bun`, `/opt/homebrew/bin/bun`. Having resolved one, the shim **shall** exec that bun against `dist/gw.mjs` when the bundle is present and against `src/gw/cli/main.ts` otherwise. If no bun is resolved, the shim **shall not** invoke node; it **shall** exit non-zero, emit nothing on stdout, and emit a stderr diagnostic that names bun, lists the searched locations, states the `$GW_BUN` override, and states that node cannot substitute.

Note: node is not a usable runtime for the gw source. `node --experimental-strip-types` does not remap the NodeNext `.js` import specifiers in `src/gw/**` to `.ts`, and `dist/gw.mjs` is a `--target=bun` bundle that node cannot execute. A node route would therefore always crash; it previously surfaced as a raw `ERR_MODULE_NOT_FOUND` resolver stack naming `src/gw/cli/router.js`, which named neither bun nor the operator's actual problem. The 8 hooks that route through `bin/gw-hook` (agent-model-guard, nesting-guard, ledger-guard, ledger-bash-guard, piped-exit-code-guard, orchestrator-impl-guard, struggle-detector, stop-gate) are bun-dependent. Operators **shall** ensure bun is installed before deploying the plugin.

- **Why** — Resolution beyond PATH matters because a launcher that inherits a non-login PATH (a terminal-multiplexer pane, a GUI-spawned editor) can miss a bun that a login shell resolves through a version manager, disabling all 8 hooks on a machine where bun is installed. Legibility matters because the previous node fallback reported Node's module resolver internals rather than the missing runtime, so the operator had no path from the message to the fix.
- **Fit criterion** — With bun reachable, `echo '{}' | bin/gw-hook hook nesting-guard` exits 0 and produces empty stdout. With bun absent from PATH but present at `$HOME/.bun/bin/bun`, the same command still exits 0. With bun unreachable everywhere, the command exits non-zero, stdout is empty, and stderr contains the word `bun` and no `ERR_MODULE_NOT_FOUND` or `internal/modules/esm/resolve` text.
- **Verification**: verified by `test/hooks/gw-hook-runtime-selection.test.ts` — spawns `bin/gw-hook` with a PATH containing node but no bun and a scratch `$HOME`, asserting the legible-diagnostic criterion; then repeats with a bun symlink under `$HOME/.bun/bin` asserting exit 0.
- **Criticality**: must
