import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const SCRIPT = path.join(ROOT, "src/review/human-doc-check.ts");
const DOC = path.join(ROOT, "doc");

const env = { ...process.env } as Record<string, string>;
delete env.CLAUDE_PROJECT_DIR;

const docs = (readdirSync(DOC, { recursive: true }) as string[])
  .map((p) => p.split(path.sep).join("/"))
  .filter((p) => p.endsWith(".md") && !p.startsWith("agents/"))
  .sort();

describe("doc/ human-doc-check", () => {
  test("enumerates the doc/ markdown files", () => {
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.length).toBeGreaterThanOrEqual(11);
    expect(docs.filter((p) => p.startsWith("agents/"))).toEqual([]);
  });

  for (const rel of docs) {
    test(`doc passes human-doc-check: doc/${rel}`, () => {
      const r = spawnSync("bun", [SCRIPT, path.join(DOC, rel)], { encoding: "utf8", env });
      expect({ status: r.status, stdout: r.stdout.trim() }).toEqual({
        status: 0,
        stdout: "PASS",
      });
    });
  }
});
