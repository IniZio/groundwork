/**
 * Parity: the human-doc checker and the doc-size-guard hook share one
 * .groundwork link detector (findGroundworkLinks). Both are spawned the way
 * they are deployed and must flag exactly the same fixtures.
 */

import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..");

const FIXTURES: { name: string; text: string; flagged: boolean }[] = [
  { name: "bare relative link", text: "[x](.groundwork/a.md)\n", flagged: true },
  { name: "dot-slash link", text: "[x](./.groundwork/a.md)\n", flagged: true },
  { name: "parent-dir link", text: "[x](../../.groundwork/a)\n", flagged: true },
  { name: "nested dir link", text: "[x](docs/.groundwork/a)\n", flagged: true },
  { name: "plain mention", text: "State is kept in .groundwork/ locally.\n", flagged: false },
  { name: "inline code", text: "See `.groundwork/` for state.\n", flagged: false },
  { name: "link inside fenced block", text: "```md\n[x](.groundwork/a.md)\n```\n", flagged: false },
  // Existing behaviour kept: the "/.groundwork/" substring test has no URL exemption.
  { name: "https URL containing /.groundwork/", text: "[x](https://example.com/.groundwork/)\n", flagged: true },
];

const hookCommand: string = (
  JSON.parse(readFileSync(path.join(REPO_ROOT, ".claude-plugin", "plugin.json"), "utf8")).hooks.PostToolUse as {
    hooks: { command: string }[];
  }[]
)
  .flatMap((g) => g.hooks.map((h) => h.command))
  .find((c) => c.includes("doc-size-guard"))!
  .replace("${CLAUDE_PLUGIN_ROOT}", REPO_ROOT);

const env = { ...process.env, CLAUDE_CODE_ENTRYPOINT: "cli" };

function checkerFlags(file: string): boolean {
  const r = spawnSync("bun", [path.join(REPO_ROOT, "src/review/human-doc-check.ts"), file], { encoding: "utf8", env });
  return r.stdout.includes("link into .groundwork/");
}

function hookFlags(dir: string, file: string): boolean {
  const payload = JSON.stringify({ tool_name: "Write", tool_input: { file_path: file } });
  const r = spawnSync("sh", ["-c", hookCommand], { encoding: "utf8", input: payload, cwd: dir, env });
  expect(r.status).toBe(0);
  return r.stdout.includes("links into .groundwork/");
}

describe("groundwork link parity (checker vs doc-size-guard)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "gw-link-parity-"));
  for (const [i, f] of FIXTURES.entries()) {
    it(`${f.name}: both ${f.flagged ? "flag" : "pass"}`, () => {
      const sub = path.join(dir, String(i));
      require("node:fs").mkdirSync(sub);
      const file = path.join(sub, "CLAUDE.md");
      writeFileSync(file, f.text);
      expect({ checker: checkerFlags(file), hook: hookFlags(sub, file) }).toEqual({ checker: f.flagged, hook: f.flagged });
    });
  }
  it("cleanup", () => rmSync(dir, { recursive: true, force: true }));
});
