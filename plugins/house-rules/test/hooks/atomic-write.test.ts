import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWrite, sha256 } from "../../src/hooks/lib/atomic-write.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "atomic-write-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// Invalid UTF-8 bytes: "package p\n// \xe9\n" — \xe9 is a Latin-1 byte, not valid UTF-8.
const INVALID_UTF8 = Buffer.from([0x70, 0x61, 0x63, 0x6b, 0x61, 0x67, 0x65, 0x20, 0x70, 0x0a, 0x2f, 0x2f, 0x20, 0xe9, 0x0a]);

describe("atomicWrite — invalid UTF-8 target", () => {
  it("refuses write and leaves file bytes unchanged", () => {
    const fp = path.join(tmpDir, "bad.go");
    writeFileSync(fp, INVALID_UTF8);
    const before = readFileSync(fp);

    const decoded = INVALID_UTF8.toString("utf8");
    const hash = sha256(decoded);
    const result = atomicWrite(fp, decoded + "// added\n", hash);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("not valid UTF-8");
    }
    expect(readFileSync(fp)).toEqual(before);
  });
});

describe("atomicWrite — valid UTF-8 target", () => {
  it("writes successfully when content and hash match", () => {
    const original = "package p\n// comment\n";
    const fp = path.join(tmpDir, "ok.go");
    writeFileSync(fp, original);
    const hash = sha256(original);
    const updated = "package p\n";

    const result = atomicWrite(fp, updated, hash);

    expect(result.ok).toBe(true);
    expect(readFileSync(fp, "utf8")).toBe(updated);
  });
});

describe("atomicWrite — UTF-8 BOM target", () => {
  it("allows write on a UTF-8 BOM file", () => {
    const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
    const body = Buffer.from("package p\n// comment\n");
    const withBOM = Buffer.concat([BOM, body]);
    const fp = path.join(tmpDir, "bom.go");
    writeFileSync(fp, withBOM);

    const original = readFileSync(fp, "utf8");
    const hash = sha256(original);
    const updated = original.replace("// comment\n", "");

    const result = atomicWrite(fp, updated, hash);

    expect(result.ok).toBe(true);
    const written = readFileSync(fp);
    expect(written.subarray(0, 3)).toEqual(BOM);
  });
});
