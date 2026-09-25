# Proof Harness

`scripts/proof-harness.sh` installs the groundwork plugin into a fresh, isolated HOME and verifies the `system`/`init` event before any behaviour is interpreted.

## Why `--plugin-dir` is unusable

`claude --plugin-dir` silently drops any plugin whose `plugin.json` declares a `dependencies` key. The groundwork plugin declares:

```json
"dependencies": [
  { "name": "mattpocock-skills", "marketplace": "claude-plugins-official" }
]
```

Differential evidence:

| condition | plugins in init event | groundwork present | agents |
|---|---|---|---|
| `--plugin-dir` with `dependencies` in manifest | 12 | no | none |
| `--plugin-dir` with `dependencies` removed | 13 | yes | advisor, implementer, orchestrator, qa |

`claude plugin validate .` exits 0 and `--debug` prints nothing in either case. The failure is invisible at validation time and silent at load time.

The harness avoids this by installing via the plugin registry: `claude plugin marketplace add` + `claude plugin install groundwork`. This is the path a user takes and is the only path that loads the plugin with its dependency chain intact.

## Usage

```
scripts/proof-harness.sh --repo <path> --prompt <text> [OPTIONS]

  --repo       <path>   throwaway git repo used as cwd for claude (required)
  --prompt     <text>   prompt passed to claude -p (required)
  --agent      <name>   forwarded as --agent to claude
  --model      <name>   model (default: sonnet)
  --out        <dir>    output directory; logs written here (default: temp dir)
  --settings   <file>   forwarded as --settings to claude
  --plugin     <path>   repo root containing .claude-plugin/ (default: this script's repo root)
  --check-log  <file>   skip install+run; run INIT CHECK only on an existing stdout.log
```

The `--check-log` flag is useful for re-checking a saved run or for fast testing without a live install.

## INIT CHECK

The check parses the first `{"type":"system","subtype":"init"}` line in `stdout.log` and asserts:

- **(a)** a plugin entry named `groundwork` with `version` exactly matching the version in `package.json` is present.
- **(b)** a plugin entry named `mattpocock-skills` is present.
- **(c)** no `groundwork` entry exists with any version other than the version in `package.json`.
- **(d)** all four agents are listed: `groundwork:advisor`, `groundwork:implementer`, `groundwork:orchestrator`, `groundwork:qa`.

The harness prints a `PASS/FAIL` block and exits non-zero on any failure before any behaviour from the run is interpreted.

After the init check, the harness reports `PRESENT` or `ABSENT` for the groundwork SessionStart marker — the text injected by `src/hooks/session-start.ts` as `additionalContext`. With `--plugin-dir`, the hook never fires; with a registry install, it appears in the verbose transcript.

## Auth caveat

A fresh `$HOME` has no credentials. The harness copies exactly two files from the caller's `~/.claude/` into the temp HOME's `.claude/` directory:

- `.credentials.json` — OAuth access/refresh tokens
- `.claude.json` — account identity (used by the CLI for session establishment)

No other `.claude/` content is copied. The installed-plugins database, user settings, MCP config, and hook registrations are intentionally left behind to produce a clean baseline. If neither file exists (e.g. CI with a service account), `claude` will prompt for login; the harness warns and continues so the error propagates naturally.

## CLAUDE_PLUGIN_ROOT path and the GW= line

`src/hooks/session-start.ts` reads `CLAUDE_PLUGIN_ROOT` at runtime and interpolates the absolute path into the injected `GW="bun <path>/src/cli/main.ts"` line.

In a harness run the local marketplace points at the worktree directly (`--plugin /path/to/groundwork`), so `CLAUDE_PLUGIN_ROOT` resolves to that worktree path (e.g. `/home/newman/.local/share/groundwork`). **This path is not representative of a real install.**

When a user installs via `claude plugin install groundwork` from the public marketplace, the plugin is extracted into a versioned install cache (e.g. `~/.claude/plugins/cache/groundwork/<version>/`). `CLAUDE_PLUGIN_ROOT` will be that cache path, and the `GW=` line will contain the correct absolute path for that install — no manual PATH step needed.

The harness path confirms the mechanism works; the actual path an end user sees will be the install-cache path.
