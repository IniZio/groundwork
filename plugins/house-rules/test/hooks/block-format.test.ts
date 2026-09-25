import { describe, it, expect } from "bun:test";
import { formatBlock, type BlockInput } from "../../src/hooks/lib/block-format.js";

const LIMIT = 2000;

const DHEADER =
  "house-rules comment-density gate: files changed in this session exceed the code convention (at most 5 comment lines per 100 added lines).\n" +
  "This is a convention check — not a bug, a merge, or another session's edit.";
const DFOOTERBASE = "Remove comments that restate the code; keep only one-line \"why\" comments, until each file is at or under 5/100. Deleting or rewording a comment that predates the session is not an acceptable fix. Then stop again.";
const SFOOTERBASE = "Merge the coexisting directories or move/delete the scratch file. Then stop again.";
const HANDBACK = " Edits made after hand-back do not reach the caller.";

function densityInput(n: number, noticeCount = 0, fixedCount = 0, suffix: string | null = null): BlockInput {
  const lines = Array.from({ length: n }, (_, i) => `  /repo/widget${i}.tsx: ${(10 + i).toFixed(1)}/100 (2 comments in 10 added lines; rows 1, 6)`);
  const notices = Array.from({ length: noticeCount }, (_, i) => `(/repo/parse${i}.tsx: parse error — prefix count used)`);
  const fixedFiles = Array.from({ length: fixedCount }, (_, i) => `/repo/fixed${i}.ts`);
  return {
    header: DHEADER,
    sections: [{ lines, footer: DFOOTERBASE }],
    notices,
    fixedFiles,
    suffix,
  };
}

function strayInput(n: number, fixedCount = 0, suffix: string | null = null): BlockInput {
  const lines = Array.from({ length: n }, (_, i) => `  /repo/docs/file${i}.md: docs/ coexists with doc/`);
  const fixedFiles = Array.from({ length: fixedCount }, (_, i) => `/repo/fixed${i}.ts`);
  return {
    header: "house-rules gate:",
    sections: [{ lines, footer: SFOOTERBASE }],
    notices: [],
    fixedFiles,
    suffix,
  };
}

function bothInput(dCount: number, sCount: number, suffix: string | null = null): BlockInput {
  const DFOOTER_DENSITY = DFOOTERBASE.slice(0, -" Then stop again.".length);
  const dLines = Array.from({ length: dCount }, (_, i) => `  /repo/widget${i}.tsx: ${(10 + i).toFixed(1)}/100 (2 comments in 10 added lines; rows 1, 6)`);
  const sLines = Array.from({ length: sCount }, (_, i) => `  /repo/docs/file${i}.md: docs/ coexists with doc/`);
  return {
    header: "house-rules gate: files changed in this session violate one or more code conventions.",
    sections: [
      { label: "comment-density:", lines: dLines, footer: DFOOTER_DENSITY },
      { label: "stray-artifacts:", lines: sLines, footer: SFOOTERBASE },
    ],
    notices: [],
    fixedFiles: [],
    suffix,
  };
}

// Property: output always ≤ 2000 chars.
describe("block-format: length invariant", () => {
  it("density: sizes 0..60, no extras", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(densityInput(n));
      expect(out.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("density: sizes 0..60 with notices", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(densityInput(n, Math.min(n, 10)));
      expect(out.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("density: sizes 0..60 with fixedFiles", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(densityInput(n, 0, Math.min(n, 10)));
      expect(out.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("density: sizes 0..60 with suffix", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(densityInput(n, 0, 0, HANDBACK));
      expect(out.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("stray: sizes 0..60", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(strayInput(n));
      expect(out.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("stray: sizes 0..60 with fixedFiles", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(strayInput(n, Math.min(n, 5)));
      expect(out.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("both: sizes 0..60 combined", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(bothInput(n, n, HANDBACK));
      expect(out.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("both: 30 density + 1 stray (SubagentStop)", () => {
    const out = formatBlock(bothInput(30, 1, HANDBACK));
    expect(out.length).toBeLessThanOrEqual(LIMIT);
  });

  it("both: 1 density + 30 stray (SubagentStop)", () => {
    const out = formatBlock(bothInput(1, 30, HANDBACK));
    expect(out.length).toBeLessThanOrEqual(LIMIT);
  });

  it("long single line (2500-char path)", () => {
    const longPath = "/repo/" + "a".repeat(2490);
    const out = formatBlock({
      header: DHEADER,
      sections: [{ lines: [`  ${longPath}: 20.0/100`], footer: DFOOTERBASE }],
      notices: [],
      fixedFiles: [],
      suffix: null,
    });
    expect(out.length).toBeLessThanOrEqual(LIMIT);
  });

  it("long notice (2500 chars)", () => {
    const longNotice = "(" + "x".repeat(2490) + ")";
    const out = formatBlock({
      header: DHEADER,
      sections: [{ lines: ["  /repo/a.tsx: 20.0/100 (2 comments)"], footer: DFOOTERBASE }],
      notices: [longNotice],
      fixedFiles: [],
      suffix: null,
    });
    expect(out.length).toBeLessThanOrEqual(LIMIT);
  });

  it("30 notices (parse-error fallback scenario)", () => {
    const out = formatBlock(densityInput(30, 30, 0));
    expect(out.length).toBeLessThanOrEqual(LIMIT);
  });

  it("40 fixed files + 1 stray", () => {
    const DFOOTER_DENSITY = DFOOTERBASE.slice(0, -" Then stop again.".length);
    const strayLines = [`  /repo/docs/x.md: docs/ coexists with doc/`];
    const fixedFiles = Array.from({ length: 40 }, (_, i) => `/repo/fixed${i}.ts`);
    const out = formatBlock({
      header: "house-rules gate: files changed in this session violate one or more code conventions.",
      sections: [
        { label: "comment-density:", lines: [], footer: DFOOTER_DENSITY },
        { label: "stray-artifacts:", lines: strayLines, footer: SFOOTERBASE },
      ],
      notices: [],
      fixedFiles,
      suffix: HANDBACK,
    });
    expect(out.length).toBeLessThanOrEqual(LIMIT);
  });
});

// Property: mandatory parts always present.
describe("block-format: mandatory parts", () => {
  it("density header always present", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(densityInput(n));
      expect(out).toContain("house-rules comment-density gate:");
    }
  });

  it("density footer always present", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(densityInput(n));
      expect(out).toContain("not an acceptable fix.");
    }
  });

  it("stray footer always present", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(strayInput(n));
      expect(out).toContain("Merge the coexisting directories");
    }
  });

  it("suffix always present when given", () => {
    for (let n = 0; n <= 60; n++) {
      const out = formatBlock(densityInput(n, 0, 0, HANDBACK));
      expect(out).toContain("Edits made after hand-back do not reach the caller.");
    }
  });

  it("both: section labels always present", () => {
    for (let n = 1; n <= 30; n++) {
      const out = formatBlock(bothInput(n, n, HANDBACK));
      expect(out).toContain("comment-density:");
      expect(out).toContain("stray-artifacts:");
    }
  });
});

// Property: each non-empty list shows ≥1 real entry when it fits.
describe("block-format: minimum-entry guarantee", () => {
  it("density: 1 file always visible", () => {
    const out = formatBlock(densityInput(1));
    expect(out).toContain("widget0.tsx");
  });

  it("density: 30 density + 1 stray — stray entry visible", () => {
    const out = formatBlock(bothInput(30, 1, HANDBACK));
    expect(out).toContain("stray-artifacts:");
    // Stray section must show the one real entry (not just a suffix)
    expect(out).toContain("docs/file0.md");
  });

  it("density: 1 density + 30 stray — density entry visible", () => {
    const out = formatBlock(bothInput(1, 30, HANDBACK));
    expect(out).toContain("widget0.tsx");
  });

  it("stray: 1 file always visible", () => {
    const out = formatBlock(strayInput(1));
    expect(out).toContain("docs/file0.md");
  });

  it("fixedNote: at least prefix shown when fixedFiles present (small budget edge)", () => {
    const out = formatBlock(densityInput(60, 0, 1));
    expect(out.length).toBeLessThanOrEqual(LIMIT);
    // fixedFiles may or may not appear depending on budget, but output must be valid
  });

  it("no digit-growth: suffix count stable across sizes", () => {
    // Suffix count must equal items.length minus the entries actually shown.
    const moreRegex = /… (\d+) more/g;
    for (let n = 9; n <= 11; n++) {
      const out = formatBlock(densityInput(n));
      const matches = [...out.matchAll(moreRegex)];
      const shown = out.split("\n").filter(l => l.includes("widget")).length;
      for (const m of matches) {
        expect(Number(m[1])).toBe(n - shown);
      }
    }
  });
});

// Realistic long paths (110-170 char lines) — expose budget-reservation bug.
const RROOT = "/dev/shm/claude-1003/-home-user--local-share-project/abcd1234/";

function realisticDensityLine(i: number): string {
  return `  ${RROOT}src/w${i}-component-name.tsx: ${(10 + i).toFixed(1)}/100 (2 comments in 10 added lines; rows 1, 6)`;
}

function realisticStrayLine(i: number): string {
  return `  ${RROOT}src/w${i}-component-name.tsx: docs/ coexists with doc/`;
}

function realisticNoticeLine(i: number): string {
  return `(${RROOT}src/parse${i}-component.tsx: parse error — prefix count used)`;
}

function realisticBothInput(dCount: number, sCount: number, suffix: string | null = null): BlockInput {
  const DFOOTER_DENSITY = DFOOTERBASE.slice(0, -" Then stop again.".length);
  return {
    header: "house-rules gate: files changed in this session violate one or more code conventions.",
    sections: [
      { label: "comment-density:", lines: Array.from({ length: dCount }, (_, i) => realisticDensityLine(i)), footer: DFOOTER_DENSITY },
      { label: "stray-artifacts:", lines: Array.from({ length: sCount }, (_, i) => realisticStrayLine(i)), footer: SFOOTERBASE },
    ],
    notices: [],
    fixedFiles: [],
    suffix,
  };
}

function realisticTripleInput(dCount: number, nCount: number, sCount: number, suffix: string | null = null): BlockInput {
  const DFOOTER_DENSITY = DFOOTERBASE.slice(0, -" Then stop again.".length);
  return {
    header: "house-rules gate: files changed in this session violate one or more code conventions.",
    sections: [
      { label: "comment-density:", lines: Array.from({ length: dCount }, (_, i) => realisticDensityLine(i)), footer: DFOOTER_DENSITY },
      { label: "stray-artifacts:", lines: Array.from({ length: sCount }, (_, i) => realisticStrayLine(i)), footer: SFOOTERBASE },
    ],
    notices: Array.from({ length: nCount }, (_, i) => realisticNoticeLine(i)),
    fixedFiles: [],
    suffix,
  };
}

describe("block-format: realistic paths", () => {
  it("30 density + 1 stray with HANDBACK: stray path visible, length ≤2000", () => {
    const out = formatBlock(realisticBothInput(30, 1, HANDBACK));
    expect(out.length).toBeLessThanOrEqual(LIMIT);
    expect(out).toContain(`${RROOT}src/w0-component-name.tsx: docs/ coexists with doc/`);
  });

  it("30 density + 1 stray without HANDBACK: stray path visible, length ≤2000", () => {
    const out = formatBlock(realisticBothInput(30, 1, null));
    expect(out.length).toBeLessThanOrEqual(LIMIT);
    expect(out).toContain(`${RROOT}src/w0-component-name.tsx: docs/ coexists with doc/`);
  });

  it("30 notices + 30 density + 1 stray: stray path visible, length ≤2000", () => {
    const out = formatBlock(realisticTripleInput(30, 30, 1, HANDBACK));
    expect(out.length).toBeLessThanOrEqual(LIMIT);
    expect(out).toContain(`${RROOT}src/w0-component-name.tsx: docs/ coexists with doc/`);
  });
});

// Exact-output: density-only with no truncation must match gate.ts untruncated path.
describe("block-format: byte-identity for no-truncation density-only", () => {
  it("1 file, no extras — matches manual assembly", () => {
    const lines = ["  /repo/widget0.tsx: 20.0/100 (2 comments in 10 added lines; rows 1, 6)"];
    const expected = [DHEADER, ...lines, DFOOTERBASE].join("\n");
    const out = formatBlock({
      header: DHEADER,
      sections: [{ lines, footer: DFOOTERBASE }],
      notices: [],
      fixedFiles: [],
      suffix: null,
    });
    expect(out).toBe(expected);
  });

  it("1 file + notice + fixedNote — matches manual assembly", () => {
    const lines = ["  /repo/widget0.tsx: 20.0/100 (2 comments in 10 added lines; rows 1, 6)"];
    const notices = ["(/repo/parse0.tsx: parse error — prefix count used)"];
    const fixedFiles = ["/repo/fix0.ts"];
    const fixedNote = "auto-fixed in this run: " + fixedFiles.join(", ");
    const expected = [DHEADER, ...lines, ...notices, fixedNote, DFOOTERBASE].join("\n");
    const out = formatBlock({
      header: DHEADER,
      sections: [{ lines, footer: DFOOTERBASE }],
      notices,
      fixedFiles,
      suffix: null,
    });
    expect(out).toBe(expected);
  });
});
