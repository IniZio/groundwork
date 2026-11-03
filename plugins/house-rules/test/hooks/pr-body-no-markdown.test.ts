import { describe, test, expect, beforeAll } from "bun:test";
import { copyFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { check } from "../../src/hooks/pr-body-guard.js";
import { runProse } from "../../src/cli/prose.js";
import { makeRepo } from "./commit-sandbox.js";

const DENSE = resolve(import.meta.dir, "../fixtures/pr-body/moor-956-dense.md");
const NOTICE = "house-rules pr-body: check skipped, this bun has no Bun.markdown (needs bun >= 1.3.14)";
const NO_MARKDOWN = {};

let repo: string;
beforeAll(() => {
  repo = makeRepo({ rules: { "pr-body": "error" } });
  copyFileSync(DENSE, join(repo, "dense.md"));
});

const payload = (command: string) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: repo });

describe("pr-body without Bun.markdown", () => {
  test("the guard allows the dense body and says the check was skipped", async () => {
    const r = await check(payload("gh pr create --body-file dense.md"), NO_MARKDOWN);
    expect(r.exit).toBe(0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBeUndefined();
    expect(out.hookEventName).toBe("PreToolUse");
    expect(out.additionalContext).toBe(NOTICE);
  });

  test("the guard still denies the same body when Bun.markdown exists", async () => {
    const r = await check(payload("gh pr create --body-file dense.md"));
    expect(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
  });

  test("the guard stays silent for a command that carries no body", async () => {
    expect((await check(payload("gh pr view 3"), NO_MARKDOWN)).stdout).toBe("");
  });

  test("the CLI prints the line to stderr and exits 2", () => {
    const errs: string[] = [];
    const outs: string[] = [];
    const file = join(repo, "plain.md");
    writeFileSync(file, "## Why\n\nA.\n\n## Scope\n\nB.\n");
    expect(runProse(file, true, NO_MARKDOWN, { out: (s) => outs.push(s), err: (s) => errs.push(s) })).toBe(2);
    expect(errs.join("")).toBe(NOTICE + "\n");
    expect(outs).toEqual([]);
  });
});
