import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../..");
const BUN_DIR = path.dirname(process.execPath);

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function nodeModulesAbove(dir: string): string | null {
  for (let d = dir; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, "node_modules"))) return d;
    if (path.dirname(d) === d) return null;
  }
}

/** Copies groundwork's tracked and unignored files minus plugins/, the set an install ships, with no node_modules. */
function extractInstall(): string {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "gw-install-")));
  roots.push(root);
  const ls = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: REPO_ROOT, encoding: "utf8" });
  expect(ls.status, ls.stderr).toBe(0);
  for (const rel of ls.stdout.split("\0").filter(Boolean)) {
    if (rel.startsWith("plugins/")) continue;
    const src = path.join(REPO_ROOT, rel);
    if (!existsSync(src)) continue;
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    copyFileSync(src, path.join(root, rel));
  }
  expect(nodeModulesAbove(root)).toBeNull();
  return root;
}

describe("installed monitor shape: runs with no node_modules and no auto-install", () => {
  it("reports a newly conflicted PR under bun --no-install", () => {
    const root = extractInstall();
    const bin = path.join(root, "bin");
    const repo = path.join(root, "repo");
    mkdirSync(bin);
    mkdirSync(repo);
    expect(spawnSync("git", ["init", "-q"], { cwd: repo }).status).toBe(0);
    symlinkSync(Bun.which("git")!, path.join(bin, "git"));

    const pr = (mergeable: string) => ({
      number: 7, title: "Add thing", mergeable, baseRefName: "main", headRefName: "feat", url: "https://github.com/o/r/pull/7",
    });
    writeFileSync(path.join(root, "poll1.json"), JSON.stringify([pr("MERGEABLE")]));
    writeFileSync(path.join(root, "poll2.json"), JSON.stringify([pr("CONFLICTING")]));
    writeFileSync(path.join(root, "count"), "0");
    writeFileSync(path.join(bin, "gh"), `#!/bin/sh
[ "$1" = pr ] || exit 0
read -r n < "${root}/count"
echo $((n + 1)) > "${root}/count"
if [ "$n" = 0 ]; then f=poll1; else f=poll2; fi
exec bun -e 'process.stdout.write(require("fs").readFileSync(process.argv[1], "utf8"))' "${root}/$f.json"
`);
    chmodSync(path.join(bin, "gh"), 0o755);

    const r = spawnSync("bun", ["--no-install", path.join(root, "src/monitors/pr-conflict-watch.ts"), repo], {
      cwd: repo, encoding: "utf8", timeout: 30_000,
      env: { HOME: repo, PATH: `${bin}:${BUN_DIR}`, GW_PRS_POLL_MS: "20", GW_PRS_MAX_POLLS: "2" },
    });

    expect(r.stderr).not.toContain("Cannot find package");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.split("\n").filter(Boolean)).toEqual([
      "gw-prs: #7 CONFLICTING against main: Add thing https://github.com/o/r/pull/7",
    ]);
  });
});
