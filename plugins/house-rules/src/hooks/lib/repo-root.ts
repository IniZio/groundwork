import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Toplevel for the file's own dir; reuses the cwd toplevel only when no nested .git lies between.
export function fileDirRoot(filePath: string, cwdRoot: string | null): string | null {
  const dir = path.dirname(filePath);
  if (cwdRoot !== null && !process.env.GIT_DIR && !process.env.GIT_WORK_TREE && existsSync(dir)) {
    try {
      let d = realpathSync(dir);
      const rel = path.relative(cwdRoot, d);
      if (rel.split(path.sep).includes(".git")) throw new Error("inside .git");
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
        let nested = false;
        while (d !== cwdRoot && d !== path.dirname(d)) {
          if (existsSync(path.join(d, ".git"))) { nested = true; break; }
          d = path.dirname(d);
        }
        if (!nested) return cwdRoot;
      }
    } catch { }
  }
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function policyDir(fileRoot: string, outerRoot: string): string {
  return existsSync(path.join(fileRoot, ".house-rules.json")) ? fileRoot : outerRoot;
}
