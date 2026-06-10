import { describe, test, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";

let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CLAUDE_CONFIG_DIR;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR;
  } else {
    process.env.CLAUDE_CONFIG_DIR = originalEnv;
  }
});

describe("getClaudeConfigDir", () => {
  test("returns ~/.claude when CLAUDE_CONFIG_DIR is not set", async () => {
    const { getClaudeConfigDir } = await import("../../src/lib/config-dir.js");
    expect(getClaudeConfigDir()).toBe(`${os.homedir()}/.claude`);
  });

  test("returns CLAUDE_CONFIG_DIR when set", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/custom/path";
    const { getClaudeConfigDir } = await import("../../src/lib/config-dir.js");
    expect(getClaudeConfigDir()).toBe("/custom/path");
  });

  test("expands ~ prefix to home directory", async () => {
    process.env.CLAUDE_CONFIG_DIR = "~/foo";
    const { getClaudeConfigDir } = await import("../../src/lib/config-dir.js");
    expect(getClaudeConfigDir()).toBe(`${os.homedir()}/foo`);
  });

  test("strips trailing slash", async () => {
    process.env.CLAUDE_CONFIG_DIR = "/foo/bar/";
    const { getClaudeConfigDir } = await import("../../src/lib/config-dir.js");
    expect(getClaudeConfigDir()).toBe("/foo/bar");
  });
});

describe("getGroundworkStateDir", () => {
  test("appends /.groundwork to getClaudeConfigDir()", async () => {
    const { getClaudeConfigDir, getGroundworkStateDir } = await import(
      "../../src/lib/config-dir.js"
    );
    expect(getGroundworkStateDir()).toBe(`${getClaudeConfigDir()}/.groundwork`);
  });
});
