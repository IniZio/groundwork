import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { intentGates, intentGatesApply } from "../../src/cli/gate-status.js";
import { resolveDocPath } from "../../src/hooks/doc-registry.js";

const slug = "seam-slug";
let tmp: string;
beforeEach(() => { tmp = realpathSync(mkdtempSync(path.join(tmpdir(), "seam-"))); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("pr-body path: gate and registry agree", () => {
  it("gate applies when pr-body exists at the registry-resolved path", () => {
    const p = path.join(tmp, resolveDocPath("pr-body", { slug }));
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, "## What changed\n");
    expect(intentGatesApply(tmp, slug)).toBe(true);
    expect(intentGates(tmp, slug, () => null).applies).toBe(true);
  });

  it("gate does not apply without the file", () => {
    expect(intentGatesApply(tmp, slug)).toBe(false);
    expect(intentGates(tmp, slug, () => null).applies).toBe(false);
  });
});
