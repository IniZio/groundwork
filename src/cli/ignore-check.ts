import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * True when a COMMITTED (tracked) .gitignore rule ignores .groundwork/.
 * info/exclude and core.excludesFile matches do not count: they live only in
 * this clone. Outside a git repository there is nothing to cover, so true.
 */
export function hasCommittedGroundworkIgnore(root: string): boolean {
  const inRepo = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: root, encoding: "utf8", timeout: 3000 });
  if (inRepo.status !== 0) return true;
  const r = spawnSync("git", ["check-ignore", "-v", "--no-index", ".groundwork/x"], { cwd: root, encoding: "utf8", timeout: 3000 });
  if (r.status !== 0) return false;
  const m = /^(.*?):(\d+):([^\t]*)\t/.exec(r.stdout ?? "");
  if (!m) return false;
  const [, source, , pattern] = m;
  if (pattern.startsWith("!")) return false;
  if (path.basename(source) !== ".gitignore") return false;
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", "--", source], { cwd: root, encoding: "utf8", timeout: 3000 });
  return tracked.status === 0;
}
