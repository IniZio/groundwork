/**
 * Spec tests for the comment-density decoration changes:
 *   - divider-only lines exempt with reason "divider"
 *   - bare `//` spacers exempt with reason "spacer"
 *   - divider matching whole-line only (prose after dashes: not exempt)
 *   - block comments exempt only if every non-blank line is exempt
 *   - note-continuation and paragraph protection unchanged
 */
import { describe, it, expect } from "bun:test";
import {
  findComments,
  density,
  autoFix,
  type GetParserFn,
} from "../../src/hooks/lib/comment-density.js";
import { parserForPath } from "../../src/hooks/languages/parse.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";

const TS = parserForPath(getParser, "sample.ts");

// Stub that forces density() to return ok:false (grammar-load failure).
const failParser: GetParserFn = async (_lang) => ({ ok: false, reason: "forced-load-failure-for-decoration-test" });

// ── AC1: findComments decoration reasons ─────────────────────────────────────

describe("AC1: findComments decoration reasons", () => {
  describe("TypeScript", () => {
    it("AC1: // ---------- is exempt with reason 'divider'", async () => {
      const text = "// ----------\nconst x = 1;";
      const r = await findComments(text, "typescript", TS);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const c = r.comments.find(c => c.startRow === 0);
      expect(c).toBeDefined();
      expect(c!.exempt).toBe(true);
      expect(c!.exemptReason).toBe("divider");
    });

    it("AC1: // ───── (box-drawing dashes) is exempt with reason 'divider'", async () => {
      const text = "// ─────\nconst x = 1;";
      const r = await findComments(text, "typescript", TS);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const c = r.comments.find(c => c.startRow === 0);
      expect(c).toBeDefined();
      expect(c!.exempt).toBe(true);
      expect(c!.exemptReason).toBe("divider");
    });

    it("AC1: // ---- Section prose is NOT exempt (prose follows dashes, not whole-line divider)", async () => {
      const text = "// ---- Section prose\nconst x = 1;";
      const r = await findComments(text, "typescript", TS);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const c = r.comments.find(c => c.startRow === 0);
      expect(c).toBeDefined();
      expect(c!.exempt).toBe(false);
    });

    it("AC1: // (bare spacer) is exempt with reason 'spacer'", async () => {
      const text = "//\nconst x = 1;";
      const r = await findComments(text, "typescript", TS);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const c = r.comments.find(c => c.startRow === 0);
      expect(c).toBeDefined();
      expect(c!.exempt).toBe(true);
      expect(c!.exemptReason).toBe("spacer");
    });
  });

  describe("Go", () => {
    it("AC1: Go // ---------- is exempt with reason 'divider'", async () => {
      const text = "package main\n// ----------\nfunc F() {}";
      const r = await findComments(text, "go");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const c = r.comments.find(c => c.startRow === 1);
      expect(c).toBeDefined();
      expect(c!.exempt).toBe(true);
      expect(c!.exemptReason).toBe("divider");
    });
  });
});

// ── AC2: density invariance with dividers and spacers ────────────────────────

describe("AC2: density invariance — inserting dividers and spacers changes nothing", () => {
  // TypeScript fixture F: two real prose comments
  const F_ts = [
    "const a = 1;",
    "// real comment one",
    "const b = 2;",
    "// real comment two",
    "function f() {}",
  ].join("\n");

  // F' with divider lines and bare `//` spacers inserted between existing lines
  const F_ts_prime = [
    "const a = 1;",
    "// ----------",
    "// real comment one",
    "//",
    "const b = 2;",
    "// ─────────────────────────────────────────────────────────────────────────────",
    "// real comment two",
    "//",
    "function f() {}",
  ].join("\n");

  // Go fixture F: two real prose comments
  const F_go = [
    "package main",
    "",
    "// real comment one",
    "",
    "// real comment two",
    "",
    "func F() {}",
  ].join("\n");

  // F' with dividers and spacers inserted
  const F_go_prime = [
    "package main",
    "",
    "// ─────────────────────────────────────────────────────────────────────────────",
    "// real comment one",
    "//",
    "// ─────────────────────────────────────────────────────────────────────────────",
    "",
    "// ----------",
    "// real comment two",
    "//",
    "",
    "func F() {}",
  ].join("\n");

  it("AC2 TS tree-sitter: F.effective === F'.effective", async () => {
    const rF = await density(F_ts, "typescript", undefined, TS);
    const rF2 = await density(F_ts_prime, "typescript", undefined, TS);
    expect(rF.ok).toBe(true);
    expect(rF2.ok).toBe(true);
    if (!rF.ok) throw new Error(rF.reason);
    if (!rF2.ok) throw new Error(rF2.reason);
    // Prose rows must count (not vacuous)
    expect(rF.effective).toBeGreaterThan(0);
    expect(rF.effective).toBe(rF2.effective);
  });

  it("AC2 TS grammar-load failure: density reports ok:false for F and F'", async () => {
    const rF = await density(F_ts, "typescript", undefined, failParser);
    const rF2 = await density(F_ts_prime, "typescript", undefined, failParser);
    expect(rF.ok).toBe(false);
    expect(rF2.ok).toBe(false);
    if (rF.ok) throw new Error("expected ok:false");
    if (rF2.ok) throw new Error("expected ok:false");
    expect(rF.reason).toBe("forced-load-failure-for-decoration-test");
    expect(rF2.reason).toBe("forced-load-failure-for-decoration-test");
  });

  it("AC2 Go tree-sitter: F.effective === F'.effective", async () => {
    const rF = await density(F_go, "go");
    const rF2 = await density(F_go_prime, "go");
    expect(rF.ok).toBe(true);
    expect(rF2.ok).toBe(true);
    if (!rF.ok) throw new Error(rF.reason);
    if (!rF2.ok) throw new Error(rF2.reason);
    expect(rF.effective).toBeGreaterThan(0);
    expect(rF.effective).toBe(rF2.effective);
  });

  it("AC2 Go grammar-load failure: density reports ok:false for F and F'", async () => {
    const rF = await density(F_go, "go", undefined, failParser);
    const rF2 = await density(F_go_prime, "go", undefined, failParser);
    expect(rF.ok).toBe(false);
    expect(rF2.ok).toBe(false);
    if (rF.ok) throw new Error("expected ok:false");
    if (rF2.ok) throw new Error("expected ok:false");
    expect(rF.reason).toBe("forced-load-failure-for-decoration-test");
    expect(rF2.reason).toBe("forced-load-failure-for-decoration-test");
  });
});

// ── AC3: regression — note-continuation protected across bare-// spacer ──────

describe("AC3: regression — note-continuation protection (Go, HEAD literal)", () => {
  const text = [
    "package main",
    "",
    "// prose1",
    "// prose2",
    "// prose3",
    "// prose4",
    "// prose5",
    "",
    "// TODO(x): a",
    "//",
    "// continued",
    "",
    "func F() {}",
    "",
  ].join("\n");

  const addedRows = new Set([2, 3, 4, 5, 6, 9, 10]);

  const EXPECTED_FIXED = "package main\n\n// TODO(x): a\n//\n// continued\n\nfunc F() {}\n";

  it("AC3: autoFix removes prose group and retains TODO + spacer + continuation", async () => {
    const result = await autoFix(text, "go", addedRows, undefined, undefined, { maxAllowedRows: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fixed).toBe(EXPECTED_FIXED);

    expect(result.fixed).toContain("// TODO(x): a");
    expect(result.fixed).toContain("// continued");

    expect(result.removed).toBeGreaterThan(0);
    expect(result.fixed).not.toContain("// prose1");
  });

  // Prose before the note group makes `// continued` the cheapest unit to drop,
  // so this case goes red if the spacer resets note continuation. Literal is HEAD fd543cc output.
  it("AC3: spacer does not end note continuation when prose precedes the note", async () => {
    const t = [
      "package main", "",
      "// prose1", "// prose2", "// prose3", "",
      "// TODO(x): a", "//", "// continued", "",
      "func F() {}", "",
    ].join("\n");
    const rows = new Set([...Array(t.split("\n").length).keys()].slice(1));
    const result = await autoFix(t, "go", rows, undefined, undefined, { maxAllowedRows: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fixed).toBe("package main\n\n// TODO(x): a\n//\n// continued\n\nfunc F() {}\n");
  });
});


describe("AC4: block comment exemption — all-non-blank-exempt rule", () => {
  it("AC4: multi-line block with prose after URL is NOT exempt", async () => {
    const text = "/* see https://x.y\n  prose\n  prose */\nconst x = 1;";
    const r = await findComments(text, "typescript", TS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.comments.find(c => c.startRow === 0);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });

  it("AC4: single-line block comment that is just a URL IS exempt", async () => {
    const text = "/* https://x.y */\nconst x = 1;";
    const r = await findComments(text, "typescript", TS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.comments.find(c => c.startRow === 0);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });
});


describe("AC5: real-data fixture — nexus boot_sequence_test.go mutation-proof block", () => {
  const DIVIDER = "// ─────────────────────────────────────────────────────────────────────────────";

  const fixture = [
    "package main",
    "",
    DIVIDER,
    "// Mutation proof: drop the !hotSwap guard on mountWorkspace → test fails.",
    "//",
    "// This test is the specification for the critical guard.  If someone removes",
    `// the "!hotSwap" condition from the mountWorkspace block in boot_sequence.go,`,
    "// mountWorkspace will be called with hotSwap=true, and this test catches it.",
    DIVIDER,
    "",
    "func TestBootSequence_HotSwap_MountWorkspace_GuardIsRequired() {}",
    "",
    DIVIDER,
    "// Mutation proof: drop the !hotSwap guard on setupNetwork → test fails.",
    DIVIDER,
    "",
    "func TestBootSequence_HotSwap_SetupNetwork_GuardIsRequired() {}",
  ].join("\n");


  it("AC5: framing // ─────… lines are exempt with reason 'divider'", async () => {
    const r = await findComments(fixture, "go");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const dividerRows = [2, 8, 12, 14];
    for (const row of dividerRows) {
      const c = r.comments.find(c => c.startRow === row);
      expect(c).toBeDefined();
      expect(c!.exempt).toBe(true);
      expect(c!.exemptReason).toBe("divider");
    }
  });

  it("AC5: bare // spacer (row 4) is exempt with reason 'spacer'", async () => {
    const r = await findComments(fixture, "go");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const c = r.comments.find(c => c.startRow === 4);
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
    expect(c!.exemptReason).toBe("spacer");
  });

  it("AC5: prose rows are NOT exempt", async () => {
    const r = await findComments(fixture, "go");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const proseRows = [3, 5, 6, 7, 13];
    for (const row of proseRows) {
      const c = r.comments.find(c => c.startRow === row);
      expect(c).toBeDefined();
      expect(c!.exempt).toBe(false);
    }
  });

  it("AC5: density reports prose rows in commentRows by identity", async () => {
    const d = await density(fixture, "go");
    expect(d.ok).toBe(true);
    if (!d.ok) throw new Error(d.reason);

    const commentRowSet = new Set(d.commentRows);

    expect(commentRowSet.has(3)).toBe(true);
    expect(commentRowSet.has(13)).toBe(true);

    expect(commentRowSet.has(2)).toBe(false);
    expect(commentRowSet.has(4)).toBe(false);
    expect(commentRowSet.has(8)).toBe(false);
    expect(commentRowSet.has(12)).toBe(false);
    expect(commentRowSet.has(14)).toBe(false);

    expect(d.effective).toBeGreaterThan(0);
  });

  it("AC5: correct prose comment text at row 3", async () => {
    const r = await findComments(fixture, "go");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const c = r.comments.find(c => c.startRow === 3);
    expect(c).toBeDefined();
    expect(c!.text).toBe("// Mutation proof: drop the !hotSwap guard on mountWorkspace → test fails.");
    expect(c!.exempt).toBe(false);
  });
});
