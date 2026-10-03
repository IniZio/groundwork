import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Git toplevel of `start`; `start` itself when it is not inside a git repo. */
export function resolveRepoBase(start: string): string {
  const r = spawnSync("git", ["-C", start, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5000 });
  const top = r.status === 0 ? r.stdout.trim() : "";
  return top || start;
}

/** Work-store path: GROUNDWORK_DB, else <repo root of cwd>/.groundwork/work.db when it exists. */
export function resolveDbPath(cwd: string | undefined, env: Record<string, string | undefined>): string | null {
  if (env.GROUNDWORK_DB) return env.GROUNDWORK_DB;
  const base = resolveRepoBase(cwd ?? env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const p = path.join(base, ".groundwork", "work.db");
  return existsSync(p) ? p : null;
}
