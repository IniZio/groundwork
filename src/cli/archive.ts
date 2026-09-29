import { existsSync, statSync, readFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type ArchiveResult = { ok: true; dest: string } | { ok: false; err: string };

// Line parser rather than YAML.parse: YAML turns bare dates into Date objects.
function frontmatter(file: string): Record<string, string> | null {
  if (!existsSync(file)) return null;
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(readFileSync(file, "utf8"));
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, "$2").trim();
  }
  return out;
}

function gitOut(root: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

/** Validates, then moves work/<slug> to archive/<yyyy-mm>/<slug> and drops evidence/. No mutation on failure. */
export function runArchive(root: string, slug: string): ArchiveResult {
  const fail = (err: string): ArchiveResult => ({ ok: false, err });
  if (slug.includes("/") || slug.includes("..") || slug === ".") return fail(`invalid slug '${slug}'`);

  const src = path.join(root, ".groundwork", "work", slug);
  if (!existsSync(src) || !statSync(src).isDirectory()) return fail(`no work unit '${slug}'`);

  const created = frontmatter(path.join(src, "motive.md"))?.created;
  if (!created || !/^\d{4}-\d{2}-\d{2}$/.test(created)) {
    return fail(`${slug}/motive.md has no created: date (add created: YYYY-MM-DD)`);
  }

  const specFm = existsSync(path.join(src, "spec.md")) ? (frontmatter(path.join(src, "spec.md")) ?? {}) : null;
  if (specFm) {
    const folds = specFm.folds_into;
    if (!folds) return fail(`${slug}/spec.md has no folds_into: (a path, or none with reason:)`);
    if (folds === "none") {
      if (!specFm.reason) return fail(`${slug}/spec.md folds_into: none requires reason:`);
    } else {
      const committed = gitOut(root, ["log", "-1", `--since=${created}`, "--format=%H", "--", folds]);
      const staged = gitOut(root, ["diff", "--cached", "--name-only", "--", folds]);
      if (!committed && !staged) {
        return fail(`${slug} spec not folded: ${folds} has no commit since ${created} and no staged change`);
      }
    }
  }

  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rel = `.groundwork/archive/${ym}/${slug}`;
  const dest = path.join(root, rel);
  if (existsSync(dest)) return fail(`archive target exists: ${rel}`);

  mkdirSync(path.dirname(dest), { recursive: true });
  renameSync(src, dest);
  rmSync(path.join(dest, "evidence"), { recursive: true, force: true });
  return { ok: true, dest: rel };
}
