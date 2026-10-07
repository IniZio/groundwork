import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dir, "../..");
const CACHE = path.join(os.homedir(), ".claude", "plugins", "cache", "mattpocock", "mattpocock-skills");

function latestPluginJson(): string | null {
  if (!statSync(CACHE, { throwIfNoEntry: false })?.isDirectory()) return null;
  const versions = readdirSync(CACHE).filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => {
    const [am, an, ap] = a.split(".").map(Number);
    const [bm, bn, bp] = b.split(".").map(Number);
    return bm - am || bn - an || bp - ap;
  });
  for (const v of versions) {
    const f = path.join(CACHE, v, ".claude-plugin", "plugin.json");
    if (statSync(f, { throwIfNoEntry: false })?.isFile()) return f;
  }
  return null;
}

const PLUGIN_JSON = latestPluginJson();

const INSTALLED_FILE = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
function installedEntry(): { version: string; gitCommitSha: string } | null {
  try {
    return JSON.parse(readFileSync(INSTALLED_FILE, "utf8")).plugins?.["mattpocock-skills@mattpocock"]?.[0] ?? null;
  } catch {
    return null;
  }
}
const INSTALLED = installedEntry();

describe("doc/upstream.md recorded SHA", () => {
  it.skipIf(INSTALLED === null)("equals installed gitCommitSha at lines 3 and 11", () => {
    const lines = readFileSync(path.join(ROOT, "doc/upstream.md"), "utf8").split("\n");
    const sha = (l: string) => l.match(/mattpocock-skills[^;]*?\b(?:commit )?([0-9a-f]{40})/)?.[1];
    expect(sha(lines[2])).toBe(INSTALLED!.gitCommitSha);
    expect(sha(lines[10])).toBe(INSTALLED!.gitCommitSha);
  });
});

describe("doc/upstream.md mattpocock table", () => {
  it.skipIf(PLUGIN_JSON === null)("rows equal cached plugin.json skills[]", () => {
    const cached = new Set<string>(
      (JSON.parse(readFileSync(PLUGIN_JSON!, "utf8")).skills as string[]).map(s => path.basename(s)),
    );
    const doc = readFileSync(path.join(ROOT, "doc/upstream.md"), "utf8");
    const rows = new Set<string>();
    for (const m of doc.matchAll(/^\|[^|]*\|\s*`mattpocock-skills:([a-z0-9-]+)`/gm)) rows.add(m[1]);
    expect(cached.size).toBeGreaterThan(0);
    expect([...rows].sort()).toEqual([...cached].sort());
  });
});
