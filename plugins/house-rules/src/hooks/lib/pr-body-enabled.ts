import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveConfig, type ResolvedConfig } from "../../config/resolve.mjs";

/** The pr-body config of the repo containing `dir`, or null outside any git repo. A directory not yet created is resolved from its nearest existing parent. */
function prBodyConfig(dir: string): ResolvedConfig["rules"]["pr-body"] | null {
  let at = dir;
  while (!existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: at, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  if (top.status !== 0) return null;
  return resolveConfig(top.stdout.trim()).rules["pr-body"];
}

/** True unless the repo containing `dir` sets rules["pr-body"] to "off". A directory outside any git repo reads as off. */
export function prBodyEnabled(dir: string): boolean {
  try {
    return prBodyConfig(dir)?.severity === "error";
  } catch {
    return false;
  }
}

/** The comment markers allowed in the repo containing `dir`: its commentMarkers option plus the comma-separated HOUSE_RULES_PR_COMMENT_MARKERS, which only the Claude process's own env can set. */
export function commentMarkers(dir: string, env: Record<string, string | undefined> = process.env): string[] {
  const fromEnv = (env.HOUSE_RULES_PR_COMMENT_MARKERS ?? "").split(",").map((m) => m.trim());
  let fromConfig: readonly string[] = [];
  try {
    fromConfig = prBodyConfig(dir)?.options.commentMarkers ?? [];
  } catch {
    fromConfig = [];
  }
  return [...fromConfig, ...fromEnv].filter((m) => m !== "");
}
