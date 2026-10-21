/**
 * SessionStart: installs the house-rules commit-msg hook into the repo's effective hooks dir.
 * Rewrites only a hook house-rules owns, so each session repoints it at the current plugin version.
 * A repo without .house-rules.json has nothing to lint, so it gets no hook and loses a stale owned one.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const MARKER = "# HOUSE-RULES-COMMIT-MSG";
const LEGACY_MARKER = "# GROUNDWORK-COMMIT-MSG";
const PLUGIN_ROOT = path.resolve(import.meta.dir, "../..");
const HOOK_MANAGER = /husky|lefthook|pre-commit/i;

const shQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

function renderHook(pluginRoot: string): string {
  const cli = shQuote(path.join(pluginRoot, "src/cli/lint-commit-msg.mjs"));
  return `#!/bin/sh
${MARKER}
# house-rules rewrites this file every session; configure the rule in .house-rules.json.
cli=${cli}
if [ ! -f "$cli" ]; then
  echo "house-rules commit-msg: $cli no longer exists, commit message not checked" >&2
  exit 0
fi
if command -v bun >/dev/null 2>&1; then exec bun "$cli" "$1"; fi
if command -v node >/dev/null 2>&1; then exec node "$cli" "$1"; fi
echo "house-rules commit-msg: neither bun nor node is on PATH, commit message not checked" >&2
exit 0
`;
}

function ownedBy(text: string): boolean {
  return text.split("\n").some(l => l === MARKER || l.startsWith(LEGACY_MARKER));
}

function git(cwd: string, args: string[]): string | null {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Returns the one line to show the session, or "" when there is nothing to say. */
function install(cwd: string): string {
  const hooksDir = git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "hooks"]);
  if (hooksDir === null) return "";
  const hook = path.join(hooksDir, "commit-msg");
  const current = existsSync(hook) ? readFileSync(hook, "utf8") : null;
  const root = git(cwd, ["rev-parse", "--show-toplevel"]);
  if (root === null || !existsSync(path.join(root, ".house-rules.json"))) {
    if (current === null || !ownedBy(current)) return "";
    unlinkSync(hook);
    return `house-rules: removed the commit-msg hook at ${hook}; this repo has no .house-rules.json`;
  }
  const wiring = `to check commit messages, call \`house-rules lint-commit-msg "$1"\` from it (house-rules is ${path.join(PLUGIN_ROOT, "bin/house-rules")}).`;

  if (HOOK_MANAGER.test(git(cwd, ["config", "--get", "core.hooksPath"]) ?? "")) {
    return `house-rules: core.hooksPath points at a hook manager (${hooksDir}), so the commit-msg hook is not installed; ${wiring}`;
  }
  if (current !== null && !ownedBy(current)) {
    return `house-rules: ${hook} is not managed by house-rules and is left alone; ${wiring}`;
  }
  const next = renderHook(PLUGIN_ROOT);
  if (current === next) return "";

  mkdirSync(hooksDir, { recursive: true });
  const tmp = `${hook}.house-rules-${process.pid}`;
  writeFileSync(tmp, next, { mode: 0o755 });
  renameSync(tmp, hook);
  return `house-rules: ${current === null ? "installed" : "updated"} the commit-msg hook at ${hook}`;
}

if (import.meta.main) {
  try {
    let payloadCwd: unknown;
    try { payloadCwd = JSON.parse(await Bun.stdin.text()).cwd; } catch { /* no payload */ }
    const cwd = typeof payloadCwd === "string" ? payloadCwd : process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const line = install(cwd);
    if (line) process.stdout.write(line + "\n");
  } catch { /* never block a session */ }
  process.exit(0);
}
