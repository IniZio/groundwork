import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveConfig } from "../../config/resolve.mjs";

/** True when the repo containing `dir` sets rules["pr-body"] to "error". A missing repo or config reads as off, and a directory not yet created is resolved from its nearest existing parent. */
export function prBodyEnabled(dir: string): boolean {
  try {
    let at = dir;
    while (!existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
    const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: at, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    if (top.status !== 0) return false;
    return resolveConfig(top.stdout.trim()).rules["pr-body"].severity === "error";
  } catch {
    return false;
  }
}
