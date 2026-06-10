import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectClaudeMd } from "../../src/lib/claude-md-inject.js";

const MARKER_START = "<!-- GW:START -->";
const MARKER_END = "<!-- GW:END -->";

describe("injectClaudeMd", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(pathJoin(tmpdir(), "gw-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fresh insert — creates file with bounded block when file does not exist", () => {
    injectClaudeMd(tmpDir, "# Groundwork\nSome instructions.");

    const content = readFileSync(pathJoin(tmpDir, "CLAUDE.md"), "utf8");
    expect(content).toBe(
      `${MARKER_START}\n# Groundwork\nSome instructions.\n${MARKER_END}\n`
    );
  });

  it("in-place update — replaces content between existing markers", () => {
    const initial = `${MARKER_START}\nold content\n${MARKER_END}\n`;
    writeFileSync(pathJoin(tmpDir, "CLAUDE.md"), initial, "utf8");

    injectClaudeMd(tmpDir, "new content");

    const content = readFileSync(pathJoin(tmpDir, "CLAUDE.md"), "utf8");
    expect(content).toBe(`${MARKER_START}\nnew content\n${MARKER_END}\n`);
    expect(content).not.toContain("old content");
  });

  it("outside-marker preservation — content before and after markers is unchanged", () => {
    const before = "# My Project\n\nSome existing docs.\n\n";
    const after = "\n## Additional notes\nMore content here.\n";
    const initial = `${before}${MARKER_START}\noriginal\n${MARKER_END}${after}`;
    writeFileSync(pathJoin(tmpDir, "CLAUDE.md"), initial, "utf8");

    injectClaudeMd(tmpDir, "replaced");

    const content = readFileSync(pathJoin(tmpDir, "CLAUDE.md"), "utf8");
    expect(content.startsWith(before)).toBe(true);
    expect(content.endsWith(after)).toBe(true);
    expect(content).toContain(`${MARKER_START}\nreplaced\n${MARKER_END}`);
    expect(content).not.toContain("original");
  });

  it("append when no markers — appends bounded block to existing file", () => {
    const existing = "# Existing CLAUDE.md\n\nSome content.\n";
    writeFileSync(pathJoin(tmpDir, "CLAUDE.md"), existing, "utf8");

    injectClaudeMd(tmpDir, "appended content");

    const content = readFileSync(pathJoin(tmpDir, "CLAUDE.md"), "utf8");
    expect(content.startsWith(existing)).toBe(true);
    expect(content).toContain(
      `${MARKER_START}\nappended content\n${MARKER_END}\n`
    );
  });

  it("idempotent — calling inject twice with same content yields same result", () => {
    injectClaudeMd(tmpDir, "idempotent content");
    const after1 = readFileSync(pathJoin(tmpDir, "CLAUDE.md"), "utf8");

    injectClaudeMd(tmpDir, "idempotent content");
    const after2 = readFileSync(pathJoin(tmpDir, "CLAUDE.md"), "utf8");

    expect(after1).toBe(after2);
  });
});
