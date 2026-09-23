/**
 * upstream-record parity test
 *
 * Every `mattpocock-skills:<x>` route found anywhere in rules/, agents/,
 * skills/ must appear in doc/upstream.md as ACCEPTED or ALTERED (i.e. the
 * string `mattpocock-skills:<x>` must be present in the record).
 *
 * A route to an upstream skill missing from the record → test failure.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const UPSTREAM_DOC = path.join(ROOT, "doc", "upstream.md");

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

function walkMd(dir: string): string[] {
  const results: string[] = [];
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkMd(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(full);
  }
  return results;
}

function extractMpRoutes(content: string): string[] {
  const routes: string[] = [];
  const re = /`mattpocock-skills:([a-z][a-z0-9-]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) routes.push(m[1]);
  return routes;
}

// ---------------------------------------------------------------------------
// Collect all mattpocock-skills routes from source dirs
// ---------------------------------------------------------------------------

function collectSourceRoutes(): Map<string, string[]> {
  // skill name → list of files that reference it
  const routeToFiles = new Map<string, string[]>();

  const dirsToScan = [
    path.join(ROOT, "rules"),
    path.join(ROOT, "agents"),
    path.join(ROOT, "skills"),
  ];

  for (const dir of dirsToScan) {
    for (const file of walkMd(dir)) {
      const content = readFileSync(file, "utf8");
      const names = extractMpRoutes(content);
      for (const name of names) {
        if (!routeToFiles.has(name)) routeToFiles.set(name, []);
        routeToFiles.get(name)!.push(path.relative(ROOT, file));
      }
    }
  }

  return routeToFiles;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("upstream-record — every routed mattpocock-skills skill is recorded", () => {
  it("doc/upstream.md exists", () => {
    expect(existsSync(UPSTREAM_DOC), "doc/upstream.md not found").toBe(true);
  });

  const upstreamContent = existsSync(UPSTREAM_DOC)
    ? readFileSync(UPSTREAM_DOC, "utf8")
    : "";

  const routeToFiles = collectSourceRoutes();

  it("at least one mattpocock-skills route found in source dirs", () => {
    expect(routeToFiles.size).toBeGreaterThan(0);
  });

  for (const [skill, files] of routeToFiles) {
    it(`mattpocock-skills:${skill} (found in ${files[0]}) is recorded in doc/upstream.md`, () => {
      expect(
        upstreamContent,
        `mattpocock-skills:${skill} is routed in ${files.join(", ")} but absent from doc/upstream.md`,
      ).toContain(`mattpocock-skills:${skill}`);
    });
  }
});
