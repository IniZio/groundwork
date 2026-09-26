import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ledgerPath,
  appendFix,
  pendingNotices,
  markDelivered,
  removedTextsFor,
  normalizeCommentText,
  deliveryKey,
  formatNotice,
  sha256,
  type FixRecord,
} from "../../src/hooks/lib/autofix-ledger.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "autofix-ledger-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function opts() {
  return { dir: tmpDir };
}

describe("ledgerPath", () => {
  it("returns path ending with ledger.jsonl under opts.dir", () => {
    const p = ledgerPath(opts());
    expect(p).toBe(path.join(tmpDir, "ledger.jsonl"));
  });

  it("uses HOUSE_RULES_AUTOFIX_LEDGER_DIR env when no opts.dir", () => {
    const orig = process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR;
    process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR = tmpDir;
    try {
      const p = ledgerPath();
      expect(p).toBe(path.join(tmpDir, "ledger.jsonl"));
    } finally {
      if (orig === undefined) delete process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR;
      else process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR = orig;
    }
  });
});

describe("sha256", () => {
  it("returns hex string", () => {
    const h = sha256("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same input same output", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
  });
});

describe("appendFix + pendingNotices roundtrip", () => {
  it("appended fix appears as pending for a new deliveryKey", () => {
    const file = "/some/file.ts";
    appendFix(
      { file, fixedContent: "content-a", removed: ["// over budget"], reason: "density", source: "gate" },
      opts()
    );
    const key = deliveryKey("sess1", "agent1");
    const recs = pendingNotices(file, key, opts());
    expect(recs).toHaveLength(1);
    expect(recs[0].file).toBe(path.resolve(file));
    expect(recs[0].kind).toBe("fix");
    expect(recs[0].removed).toEqual(["// over budget"]);
    expect(recs[0].reason).toBe("density");
    expect(recs[0].source).toBe("gate");
    expect(recs[0].fixedHash).toBe(sha256("content-a"));
  });

  it("resolves file paths", () => {
    const rel = "relative/path.ts";
    appendFix(
      { file: rel, fixedContent: "x", removed: ["// a"], reason: "r", source: "housekeep" },
      opts()
    );
    const recs = pendingNotices(rel, deliveryKey(undefined, undefined), opts());
    expect(recs[0].file).toBe(path.resolve(rel));
  });

  it("multiple appends appear oldest first", () => {
    const file = "/abs/file.ts";
    appendFix({ file, fixedContent: "c1", removed: ["a"], reason: "r1", source: "gate" }, opts());
    appendFix({ file, fixedContent: "c2", removed: ["b"], reason: "r2", source: "gate" }, opts());
    const recs = pendingNotices(file, deliveryKey("s", "a"), opts());
    expect(recs).toHaveLength(2);
    expect(recs[0].fixedHash).toBe(sha256("c1"));
    expect(recs[1].fixedHash).toBe(sha256("c2"));
  });
});

describe("markDelivered + pendingNotices per key", () => {
  it("delivered to key A is not pending for key A but still pending for key B", () => {
    const file = "/file.ts";
    appendFix({ file, fixedContent: "content", removed: ["// c"], reason: "r", source: "gate" }, opts());
    const hash = sha256("content");
    const keyA = deliveryKey("sess", "agentA");
    const keyB = deliveryKey("sess", "agentB");

    markDelivered(file, keyA, [hash], opts());

    const pendingA = pendingNotices(file, keyA, opts());
    const pendingB = pendingNotices(file, keyB, opts());

    expect(pendingA).toHaveLength(0);
    expect(pendingB).toHaveLength(1);
    expect(pendingB[0].fixedHash).toBe(hash);
  });

  it("only marks the specified hashes as delivered", () => {
    const file = "/multi.ts";
    appendFix({ file, fixedContent: "c1", removed: ["a"], reason: "r", source: "gate" }, opts());
    appendFix({ file, fixedContent: "c2", removed: ["b"], reason: "r", source: "gate" }, opts());
    const h1 = sha256("c1");
    const h2 = sha256("c2");
    const key = deliveryKey("s", "a");

    markDelivered(file, key, [h1], opts());

    const recs = pendingNotices(file, key, opts());
    expect(recs).toHaveLength(1);
    expect(recs[0].fixedHash).toBe(h2);
  });
});

describe("removedTextsFor", () => {
  it("returns all removed texts across fix records for a file", () => {
    const file = "/rf.ts";
    appendFix({ file, fixedContent: "a", removed: ["// foo", "// bar"], reason: "r", source: "gate" }, opts());
    appendFix({ file, fixedContent: "b", removed: ["// baz"], reason: "r2", source: "housekeep" }, opts());
    const results = removedTextsFor(file, opts());
    expect(results).toHaveLength(3);
    const texts = results.map(r => r.text);
    expect(texts).toContain("// foo");
    expect(texts).toContain("// bar");
    expect(texts).toContain("// baz");
  });

  it("returns empty array when ledger missing", () => {
    const result = removedTextsFor("/nope.ts", { dir: path.join(tmpDir, "nonexistent") });
    expect(result).toEqual([]);
  });
});

describe("normalizeCommentText", () => {
  it("strips // prefix and collapses whitespace", () => {
    expect(normalizeCommentText("// foo  bar")).toBe("foo bar");
  });

  it("strips /* */ markers", () => {
    expect(normalizeCommentText("/* foo bar */")).toBe("foo bar");
  });

  it("strips # prefix", () => {
    expect(normalizeCommentText("# foo bar")).toBe("foo bar");
  });

  it("strips /// prefix", () => {
    expect(normalizeCommentText("/// doc comment")).toBe("doc comment");
  });

  it("strips -- prefix", () => {
    expect(normalizeCommentText("-- sql comment")).toBe("sql comment");
  });

  it("strips leading * on block lines", () => {
    expect(normalizeCommentText("  * inner block line")).toBe("inner block line");
  });

  it("handles extra whitespace", () => {
    expect(normalizeCommentText("//   lots   of   spaces  ")).toBe("lots of spaces");
  });

  it("returns same for all three equivalent forms", () => {
    const a = normalizeCommentText("// foo  bar");
    const b = normalizeCommentText("/* foo bar */");
    const c = normalizeCommentText("# foo bar");
    expect(a).toBe("foo bar");
    expect(b).toBe("foo bar");
    expect(c).toBe("foo bar");
  });
});

describe("deliveryKey", () => {
  it("uses nosession when sessionId undefined", () => {
    expect(deliveryKey(undefined, "agent1")).toBe("nosession:agent1");
  });

  it("uses main when agentId undefined", () => {
    expect(deliveryKey("sess1", undefined)).toBe("sess1:main");
  });

  it("combines both", () => {
    expect(deliveryKey("s", "a")).toBe("s:a");
  });
});

describe("formatNotice", () => {
  it("includes file, count, and ts in the notice", () => {
    const file = "/some/path.ts";
    const recs: FixRecord[] = [
      {
        kind: "fix",
        file,
        fixedHash: "abc",
        removed: ["// a", "// b"],
        reason: "density",
        source: "gate",
        ts: "2026-01-01T00:00:00.000Z",
      },
    ];
    const notice = formatNotice(file, recs);
    expect(notice).toContain("/some/path.ts");
    expect(notice).toContain("2");
    expect(notice).toContain("2026-01-01T00:00:00.000Z");
    expect(notice).toContain("house-rules autofix removed");
    expect(notice).toContain("automatic, not another agent");
  });

  it("uses latest ts when multiple recs", () => {
    const file = "/f.ts";
    const recs: FixRecord[] = [
      { kind: "fix", file, fixedHash: "h1", removed: ["a"], reason: "r", source: "gate", ts: "2026-01-01T00:00:00.000Z" },
      { kind: "fix", file, fixedHash: "h2", removed: ["b", "c"], reason: "r", source: "gate", ts: "2026-06-01T00:00:00.000Z" },
    ];
    const notice = formatNotice(file, recs);
    expect(notice).toContain("3");
    expect(notice).toContain("2026-06-01T00:00:00.000Z");
  });
});

describe("bounding — ledger trimmed when exceeds 500 lines", () => {
  // (a) after 501 appends: ≤300 lines, newest fix present by identity, oldest absent
  it("after 501 in-window appends file has ≤300 lines, newest fix present, oldest absent", () => {
    const file = "/bound.ts";
    const baseNow = Date.now();
    for (let i = 0; i < 501; i++) {
      appendFix(
        { file, fixedContent: `content-${i}`, removed: [`// c${i}`], reason: "r", source: "gate" },
        { dir: tmpDir, now: () => baseNow - (500 - i) * 1000 }
      );
    }
    const lp = ledgerPath(opts());
    const lines = readFileSync(lp, "utf8").trim().split("\n").filter(l => l.trim());
    expect(lines.length).toBeLessThanOrEqual(300);

    const records = lines.map(l => JSON.parse(l));
    // newest (i=500) must be present — check by file and removed identity
    const newest = records.find(
      (r: FixRecord) => r.kind === "fix" && Array.isArray(r.removed) && r.removed.includes("// c500")
    );
    expect(newest).toBeDefined();
    expect(newest.file).toBe(path.resolve(file));

    // oldest (i=0) must be absent
    const oldest = records.find(
      (r: FixRecord) => r.kind === "fix" && Array.isArray(r.removed) && r.removed.includes("// c0")
    );
    expect(oldest).toBeUndefined();
  });

  // (b) lines older than 24h dropped at trim even if among newest 300
  it("lines older than 24h are dropped at trim even if among newest 300", () => {
    const file = "/bound-old.ts";
    const baseNow = Date.now();
    // 201 old appends (>24h ago)
    for (let i = 0; i < 201; i++) {
      appendFix(
        { file, fixedContent: `old-${i}`, removed: [`// old${i}`], reason: "r", source: "gate" },
        { dir: tmpDir, now: () => baseNow - 25 * 60 * 60 * 1000 - (200 - i) * 1000 }
      );
    }
    // 300 recent appends (within 24h)
    for (let i = 0; i < 300; i++) {
      appendFix(
        { file, fixedContent: `new-${i}`, removed: [`// new${i}`], reason: "r", source: "gate" },
        { dir: tmpDir, now: () => baseNow - (299 - i) * 1000 }
      );
    }
    const lp = ledgerPath(opts());
    const lines = readFileSync(lp, "utf8").trim().split("\n").filter(l => l.trim());
    const records = lines.map(l => JSON.parse(l));

    const oldRecord = records.find(
      (r: FixRecord) => r.kind === "fix" && Array.isArray(r.removed) && r.removed.includes("// old0")
    );
    expect(oldRecord).toBeUndefined();

    const newRecord = records.find(
      (r: FixRecord) => r.kind === "fix" && Array.isArray(r.removed) && r.removed.includes("// new299")
    );
    expect(newRecord).toBeDefined();
  });

  it("600 in-window appends never exceed 500 lines after any append", () => {
    const file = "/bound-max.ts";
    const baseNow = Date.now();
    const lp = ledgerPath(opts());
    for (let i = 0; i < 600; i++) {
      appendFix(
        { file, fixedContent: `content-${i}`, removed: [`// c${i}`], reason: "r", source: "gate" },
        { dir: tmpDir, now: () => baseNow - (599 - i) * 1000 }
      );
      const lines = readFileSync(lp, "utf8").trim().split("\n").filter(l => l.trim());
      expect(lines.length).toBeLessThanOrEqual(500);
    }
  });

  it("delivered line for kept fix survives trim; delivered line for dropped fix is dropped", () => {
    const file = "/dbound.ts";
    const baseNow = Date.now();
    const key = deliveryKey("s", "a");

    appendFix(
      { file, fixedContent: "keep-this", removed: ["// k"], reason: "r", source: "gate" },
      { dir: tmpDir, now: () => baseNow - 100 * 1000 }
    );
    const keptHash = sha256("keep-this");

    appendFix(
      { file, fixedContent: "drop-this", removed: ["// d"], reason: "r", source: "gate" },
      { dir: tmpDir, now: () => baseNow - 25 * 60 * 60 * 1000 }
    );
    const droppedHash = sha256("drop-this");

    markDelivered(file, key, [keptHash, droppedHash], {
      dir: tmpDir,
      now: () => baseNow - 90 * 1000,
    });

    for (let i = 0; i < 497; i++) {
      appendFix(
        { file: `/filler${i}.ts`, fixedContent: `filler-${i}`, removed: [`// f${i}`], reason: "r", source: "gate" },
        { dir: tmpDir, now: () => baseNow - (496 - i) * 1000 }
      );
    }

    const lp = ledgerPath(opts());
    const raw = readFileSync(lp, "utf8").trim().split("\n").filter(l => l.trim());
    const records = raw.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    const keptDelivered = records.find(
      (r: { kind: string; fixedHash: string }) => r.kind === "delivered" && r.fixedHash === keptHash
    );
    const droppedDelivered = records.find(
      (r: { kind: string; fixedHash: string }) => r.kind === "delivered" && r.fixedHash === droppedHash
    );

    expect(keptDelivered).toBeDefined();
    expect(droppedDelivered).toBeUndefined();
  });
});

describe("malformed line tolerance", () => {
  it("skips malformed lines and still returns valid records", () => {
    const { appendFileSync, mkdirSync } = require("node:fs");
    mkdirSync(tmpDir, { recursive: true });
    const lp = ledgerPath(opts());
    appendFileSync(lp, "not-json\n");
    appendFileSync(lp, '{"broken": true}\n');

    const file = "/ok.ts";
    appendFix({ file, fixedContent: "x", removed: ["// a"], reason: "r", source: "gate" }, opts());

    const recs = pendingNotices(file, deliveryKey("s", "a"), opts());
    expect(recs).toHaveLength(1);
    expect(recs[0].kind).toBe("fix");
  });
});

describe("pendingNotices — missing ledger", () => {
  it("returns empty array when ledger file does not exist", () => {
    const recs = pendingNotices("/nope.ts", deliveryKey("s", "a"), { dir: path.join(tmpDir, "no-such-dir") });
    expect(recs).toEqual([]);
  });
});
