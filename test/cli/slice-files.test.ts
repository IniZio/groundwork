import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "../../src/cli/main.ts");

function run(args: string[], cwd: string, env?: Record<string, string>) {
  const result = Bun.spawnSync(["bun", CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
  });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    exitCode: result.exitCode ?? 0,
  };
}

let dir: string;
let tok: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gw-slice-files-"));
  const r = run(["init"], dir);
  const m = r.stdout.match(/token: (\S+)/);
  if (!m) throw new Error(`init produced no token: ${r.stdout} ${r.stderr}`);
  tok = m[1];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("slice add --files", () => {
  it("stores files list and shows it in slice status", () => {
    const add = run(
      ["slice", "add", "S-files-1", "--files", "src/a.ts,src/b.ts,src/c.ts", "--token", tok],
      dir,
    );
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain("S-files-1 added");

    const status = run(["slice", "status"], dir);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("files=[src/a.ts,src/b.ts,src/c.ts]");
  });

  it("slice without --files shows no files entry in status", () => {
    run(["slice", "add", "S-nofiles", "--token", tok], dir);
    const status = run(["slice", "status"], dir);
    expect(status.stdout).not.toContain("files=");
  });

  it("trimming: comma-separated list trims whitespace", () => {
    const add = run(
      ["slice", "add", "S-trim", "--files", "a.ts, b.ts , c.ts", "--token", tok],
      dir,
    );
    expect(add.exitCode).toBe(0);
    const status = run(["slice", "status"], dir);
    expect(status.stdout).toContain("files=[a.ts,b.ts,c.ts]");
  });
});
