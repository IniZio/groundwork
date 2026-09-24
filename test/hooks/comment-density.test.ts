import { describe, it, expect } from "bun:test";
import { stripComments, autoFix, findComments, density } from "../../src/hooks/lib/comment-density.js";

describe("stripComments rowChanges — whole-line comment", () => {
  it("single whole-line comment produces deleted rowChange", async () => {
    const text = "// whole\nconst x = 1;\n";
    const fr = await findComments(text, "typescript");
    expect(fr.ok).toBe(true);
    if (!fr.ok) return;
    const nonExempt = fr.comments.filter(c => !c.exempt);
    const { rowChanges } = stripComments(text, nonExempt);
    expect(rowChanges.length).toBe(1);
    expect(rowChanges[0].origRow).toBe(0);
    expect(rowChanges[0].kind).toBe("deleted");
    expect(rowChanges[0].origText).toBe("// whole");
  });
});

describe("stripComments rowChanges — multi-row block comment", () => {
  it("block spanning 3 rows produces 3 deleted entries", async () => {
    const text = "/* line1\n   line2\n*/\nconst x = 1;\n";
    const fr = await findComments(text, "typescript");
    expect(fr.ok).toBe(true);
    if (!fr.ok) return;
    const nonExempt = fr.comments.filter(c => !c.exempt);
    const { rowChanges } = stripComments(text, nonExempt);
    expect(rowChanges.length).toBe(3);
    const sorted = [...rowChanges].sort((a, b) => a.origRow - b.origRow);
    expect(sorted.map(r => r.origRow)).toEqual([0, 1, 2]);
    for (const rc of sorted) expect(rc.kind).toBe("deleted");
  });
});

describe("stripComments rowChanges — inline trailing comment", () => {
  it("inline comment on a code line produces modified rowChange", async () => {
    const text = "const x = 1; // inline\nconst y = 2;\n";
    const fr = await findComments(text, "typescript");
    expect(fr.ok).toBe(true);
    if (!fr.ok) return;
    const nonExempt = fr.comments.filter(c => !c.exempt);
    const { rowChanges } = stripComments(text, nonExempt);
    expect(rowChanges.length).toBe(1);
    expect(rowChanges[0].origRow).toBe(0);
    expect(rowChanges[0].kind).toBe("modified");
    expect(rowChanges[0].origText).toBe("const x = 1; // inline");
    expect(rowChanges[0].fixedText).toBe("const x = 1;");
  });
});

describe("autoFix rowChanges — whole-line removal propagated", () => {
  it("comments over cap produce deleted rowChanges", async () => {
    const lines = Array.from({ length: 20 }, (_, i) =>
      i === 0 || i === 2 || i === 4 ? `// comment ${i}` : `const x${i} = ${i};`
    );
    const text = lines.join("\n") + "\n";
    const rowSet = new Set(Array.from({ length: 20 }, (_, i) => i));
    const ar = await autoFix(text, "typescript", rowSet);
    expect(ar.ok).toBe(true);
    if (!ar.ok) return;
    const deleted = ar.rowChanges.filter(rc => rc.kind === "deleted");
    expect(deleted.length).toBe(3);
    expect(ar.rowChanges.filter(rc => rc.kind === "modified").length).toBe(0);
    for (const rc of deleted) expect([0, 2, 4]).toContain(rc.origRow);
  });
});

describe("autoFix rowChanges — no removal returns empty rowChanges", () => {
  it("file at or under cap has empty rowChanges", async () => {
    const lines = [
      "// one comment",
      ...Array.from({ length: 19 }, (_, i) => `const x${i} = ${i};`),
    ];
    const text = lines.join("\n") + "\n";
    const rowSet = new Set(Array.from({ length: 20 }, (_, i) => i));
    const ar = await autoFix(text, "typescript", rowSet);
    expect(ar.ok).toBe(true);
    if (!ar.ok) return;
    expect(ar.removed).toBe(0);
    expect(ar.rowChanges.length).toBe(0);
  });
});

describe("stripComments rowChanges — mid-line and multi-comment rows", () => {
  it("mid-line block comment produces one modified rowChange with code preserved", async () => {
    const text = "const w4 = /* mid 4 */ 4;\n";
    const fr = await findComments(text, "typescript");
    expect(fr.ok).toBe(true);
    if (!fr.ok) return;
    const nonExempt = fr.comments.filter(c => !c.exempt);
    const { rowChanges } = stripComments(text, nonExempt);
    expect(rowChanges.length).toBe(1);
    expect(rowChanges[0].origRow).toBe(0);
    expect(rowChanges[0].kind).toBe("modified");
    expect(rowChanges[0].fixedText).toBe("const w4 = 4;");
  });

  it("two trailing comments on one row produce one modified rowChange", async () => {
    const text = "const z14 = 14; /* p14 */ // q14\n";
    const fr = await findComments(text, "typescript");
    expect(fr.ok).toBe(true);
    if (!fr.ok) return;
    const nonExempt = fr.comments.filter(c => !c.exempt);
    const { rowChanges } = stripComments(text, nonExempt);
    expect(rowChanges.length).toBe(1);
    expect(rowChanges[0].origRow).toBe(0);
    expect(rowChanges[0].kind).toBe("modified");
  });

  it("row with only two block comments produces one rowChange entry", async () => {
    const text = "/* a */ /* b */\n";
    const fr = await findComments(text, "typescript");
    expect(fr.ok).toBe(true);
    if (!fr.ok) return;
    const nonExempt = fr.comments.filter(c => !c.exempt);
    const { rowChanges } = stripComments(text, nonExempt);
    expect(rowChanges.length).toBe(1);
    expect(rowChanges[0].origRow).toBe(0);
  });
});

describe("autoFix property — rowChanges fidelity", () => {
  it("rowChanges round-trips original from fixed (seeded, 500 iters)", async () => {
    // Mulberry32 PRNG — deterministic, fast.
    function mulberry32(seed: number): () => number {
      let s = seed;
      return () => { s |= 0; s = s + 0x6d2b79f5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 0x100000000; };
    }
    const prng = mulberry32(0xdeadbeef);

    const templates: Array<(i: number) => string> = [
      (i) => `const v${i} = ${i};`,
      (i) => `const v${i} = ${i};`,
      (i) => `const v${i} = ${i};`,
      (i) => `// note ${i}`,
      (i) => `const v${i} = ${i}; // t${i}`,
      (i) => `const v${i} = ${i}; /* a${i} */ // b${i}`,
      (i) => `/* a${i} */ /* b${i} */`,
      (i) => `/* a${i} */ // @ts-ignore`,
      (_i) => `// @ts-expect-error`,
      (i) => `/** doc ${i} */`,
      (i) => `/* multi ${i}\n   more ${i} */`,
      (i) => `const w${i} = /* in ${i} */ ${i};`,
      (i) => `  // indented ${i}`,
      (_i) => `// x`,
    ];

    let checked = 0;
    let notOk = 0;

    for (let iter = 0; iter < 500; iter++) {
      const targetLineCount = 40 + Math.floor(prng() * 20);
      const lines: string[] = [];
      let tplIdx = 0;
      while (lines.length < targetLineCount) {
        const tpl = templates[Math.floor(prng() * templates.length)];
        lines.push(...tpl(tplIdx++).split("\n"));
      }
      const text = lines.join("\n") + "\n";
      const lineCount = lines.length;

      const addedRows = new Set<number>();
      for (let i = 0; i < lineCount; i++) {
        if (i < 3 || prng() * 100 < 70) addedRows.add(i);
      }
      if (addedRows.size === 0) continue;

      const ar = await autoFix(text, "typescript", addedRows);
      if (!ar.ok) {
        if (ar.reason === "pre-existing comment removed") {
          throw new Error(`I1 (pre-existing) failed iter ${iter}: ${ar.reason}\ntext:\n${text}`);
        }
        notOk++;
        continue;
      }
      if (ar.rowChanges.length === 0) continue; checked++;

      const origRowsSeen = new Set<number>();
      for (const rc of ar.rowChanges) {
        expect(origRowsSeen.has(rc.origRow)).toBe(false);
        origRowsSeen.add(rc.origRow);
      }

      for (const rc of ar.rowChanges) {
        if (!addedRows.has(rc.origRow)) {
          throw new Error(`I1 failed iter ${iter}: origRow ${rc.origRow} not in addedRows\ntext:\n${text}`);
        }
      }

      const deletedSet = new Set(ar.rowChanges.filter(rc => rc.kind === "deleted").map(rc => rc.origRow));
      const remap = new Map<number, number>();
      for (let r = 0, k = 0; r < lineCount; r++) {
        if (!deletedSet.has(r)) remap.set(r, k++);
      }
      const remappedAdded = new Set<number>();
      for (const r of addedRows) {
        if (remap.has(r)) remappedAdded.add(remap.get(r)!);
      }
      if (remappedAdded.size > 0) {
        const dr = await density(ar.fixed, "typescript", remappedAdded);
        if (dr.total > 0 && dr.effective / dr.total * 100 > 5) {
          throw new Error(`I2 failed iter ${iter}: density ${dr.effective}/${dr.total}\nfixed:\n${ar.fixed}`);
        }
      }

      const origLines = text.split("\n");
      const modifiedMap = new Map(
        ar.rowChanges.filter(rc => rc.kind === "modified").map(rc => [rc.origRow, rc.fixedText ?? ""])
      );
      const rebuiltLines: string[] = [];
      for (let r = 0; r < origLines.length; r++) {
        if (deletedSet.has(r)) continue;
        rebuiltLines.push(modifiedMap.has(r) ? modifiedMap.get(r)! : origLines[r]);
      }
      const rebuilt = rebuiltLines.join("\n");
      expect(rebuilt).toBe(ar.fixed);
    }

    expect(checked).toBeGreaterThanOrEqual(150);
    expect(notOk).toBeGreaterThan(0);
  }, 10000);
});
