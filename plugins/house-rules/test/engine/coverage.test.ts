import { describe, it, expect } from "bun:test";
import path from "node:path";
import {
  runRules,
  notCheckedFiles,
  coverageReport,
  formatCoverage,
  grammarFailureWarning,
  grammarWarnings,
  EMPTY_COVERAGE,
} from "../../src/engine/run.js";
import { loadRules } from "../../src/engine/registry.js";
import { createSourceFiles } from "../../src/engine/source-file.js";
import type { Rule, RuleContext, ScopedFile } from "../../src/engine/types.js";

const RULES_DIR = path.resolve(import.meta.dir, "../../rules");

// TypeScript text with a syntax error on row 1 (0-based) = row 2 (1-based)
const TS_WITH_ERROR = `const x = 1;
const y = ;
const z = 3;`;

const TS_CLEAN = `const x = 1;\nconst y = 2;\n`;

// ---------------------------------------------------------------------------
// notCheckedFiles — with real rules loaded from the rules directory
// ---------------------------------------------------------------------------

describe("notCheckedFiles — real rules", () => {
  let rules: Rule[];

  const rulesReady = loadRules(RULES_DIR).then((r) => {
    rules = r;
  });

  it("PRESENT: .rb file with lang undefined is listed (not checked by any rule)", async () => {
    await rulesReady;
    const files: ScopedFile[] = [
      { path: "src/app.rb", text: "puts 'hello'" },
      { path: "src/App.kt", text: "fun main(){}" },
      { path: "a.ts", text: "x", lang: "typescript" },
    ];
    const result = notCheckedFiles(rules, files);
    expect(result).toContain("src/app.rb");
    expect(result).not.toContain("src/App.kt");
    expect(result).not.toContain("a.ts");
  });

  it("PRESENT: app.rb and main.lua listed; ABSENT: non-source files (LA-D3)", async () => {
    await rulesReady;
    const files: ScopedFile[] = [
      { path: "src/app.rb", text: "puts 'hello'" },
      { path: "src/main.lua", text: "print('hi')" },
      { path: "src/App.kt", text: "fun main(){}" },
      { path: "README.md", text: "# docs" },
      { path: "package.json", text: "{}" },
      { path: "notes.txt", text: "notes" },
      { path: "bun.lock", text: "" },
      { path: "logo.png", text: "binary" },
      { path: "CMakeLists.txt.bak", text: "backup" },
      { path: "a.ts", text: "x", lang: "typescript" },
    ];
    const result = notCheckedFiles(rules, files);
    // source-code files with no adapter → listed
    expect(result).toContain("src/app.rb");
    expect(result).toContain("src/main.lua");
    expect(result).not.toContain("src/App.kt");
    expect(result).not.toContain("README.md");
    expect(result).not.toContain("package.json");
    expect(result).not.toContain("notes.txt");
    expect(result).not.toContain("bun.lock");
    expect(result).not.toContain("logo.png");
    expect(result).not.toContain("CMakeLists.txt.bak");
    expect(result).not.toContain("a.ts");
  });

  it("only recognised files -> []", async () => {
    await rulesReady;
    const files: ScopedFile[] = [
      { path: "a.ts", text: "x", lang: "typescript" },
      { path: "b.go", text: "y", lang: "go" },
    ];
    const result = notCheckedFiles(rules, files);
    expect(result).toEqual([]);
  });

  it("rules without languages (commit-message, stray-artifacts) -> [] even with .kt file", async () => {
    await rulesReady;
    const noLangRules = rules.filter(
      (r) => !r.languages || r.languages.length === 0,
    );
    const files: ScopedFile[] = [{ path: "src/App.kt", text: "fun main(){}" }];
    const result = notCheckedFiles(noLangRules, files);
    expect(result).toEqual([]);
  });

  it("deleted file (text undefined) is not listed", async () => {
    await rulesReady;
    const files: ScopedFile[] = [
      { path: "src/App.kt" }, // text undefined → deleted
    ];
    const result = notCheckedFiles(rules, files);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runRules — sourceFile availability based on languages declaration
// ---------------------------------------------------------------------------

describe("runRules — sourceFile availability by languages", () => {
  const CTX: RuleContext = {
    repoRoot: "/repo",
    mode: "guard",
    sourceFile: async () => null, // a real function
  };

  it("stub rule WITHOUT languages sees ctx.sourceFile as undefined", async () => {
    let seen: string | undefined;
    const rule: Rule = {
      id: "no-lang-stub",
      meta: { description: "stub without languages" },
      check(ctx) {
        seen = typeof ctx.sourceFile;
        return [];
      },
    };
    await runRules([rule], CTX, {}, []);
    expect(seen).toBe("undefined");
  });

  it("stub rule WITH languages: ['typescript'] sees ctx.sourceFile as function", async () => {
    let seen: string | undefined;
    const rule: Rule = {
      id: "with-lang-stub",
      meta: { description: "stub with languages" },
      languages: ["typescript"],
      check(ctx) {
        seen = typeof ctx.sourceFile;
        return [];
      },
    };
    await runRules([rule], CTX, {}, []);
    expect(seen).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// coverageReport — notChecked
// ---------------------------------------------------------------------------

describe("coverageReport — notChecked", () => {
  let rules: Rule[];
  const rulesReady = loadRules(RULES_DIR).then((r) => { rules = r; });

  it("PRESENT: .rb file with no lang goes to notChecked", async () => {
    await rulesReady;
    const ctx: RuleContext = {
      repoRoot: "/repo",
      mode: "gate",
      files: [
        { path: "src/app.rb", text: "puts 'hello'" },
        { path: "src/App.kt", text: "fun main(){}" },
      ],
      sourceFile: async () => null,
    };
    const cov = await coverageReport(rules, ctx);
    expect(cov.notChecked).toContain("src/app.rb");
    expect(cov.notChecked).not.toContain("src/App.kt");
    expect(cov.partiallyChecked).toEqual([]);
    expect(cov.failed).toEqual([]);
  });
});

describe("coverageReport — partiallyChecked", () => {
  let rules: Rule[];
  const rulesReady = loadRules(RULES_DIR).then((r) => { rules = r; });

  it("PRESENT: TS file with syntax error appears in partiallyChecked with 1-based rows", async () => {
    await rulesReady;
    const sources = createSourceFiles();
    const ctx: RuleContext = {
      repoRoot: "/repo",
      mode: "gate",
      files: [{ path: "src/a.ts", lang: "typescript", text: TS_WITH_ERROR }],
      sourceFile: (f) =>
        f.lang && f.text !== undefined
          ? sources.get(f.lang, f.text, f.path)
          : Promise.resolve(null),
    };
    const cov = await coverageReport(rules, ctx);
    // row 1 (0-based) -> 2 (1-based) is the only error row in TS_WITH_ERROR
    expect(cov.partiallyChecked).toEqual([{ path: "src/a.ts", rows: [2] }]);
    expect(cov.failed).toEqual([]);
    sources.dispose();
  });
});

describe("coverageReport — failed", () => {
  let rules: Rule[];
  const rulesReady = loadRules(RULES_DIR).then((r) => { rules = r; });

  it("PRESENT: factory failing for typescript -> failed entry, no partiallyChecked", async () => {
    await rulesReady;
    const ctx: RuleContext = {
      repoRoot: "/repo",
      mode: "gate",
      files: [{ path: "src/a.ts", lang: "typescript", text: TS_WITH_ERROR }],
      sourceFile: async () => ({ ok: false, reason: "boom" }),
    };
    const cov = await coverageReport(rules, ctx);
    expect(cov.failed).toEqual([
      { path: "src/a.ts", language: "typescript", reason: "boom" },
    ]);
    expect(cov.partiallyChecked).toEqual([]);
  });
});

describe("coverageReport — clean file is absent from all lists", () => {
  let rules: Rule[];
  const rulesReady = loadRules(RULES_DIR).then((r) => { rules = r; });

  it("ABSENT: clean TS file -> all lists empty", async () => {
    await rulesReady;
    const sources = createSourceFiles();
    const ctx: RuleContext = {
      repoRoot: "/repo",
      mode: "gate",
      files: [{ path: "src/a.ts", lang: "typescript", text: TS_CLEAN }],
      sourceFile: (f) =>
        f.lang && f.text !== undefined
          ? sources.get(f.lang, f.text, f.path)
          : Promise.resolve(null),
    };
    const cov = await coverageReport(rules, ctx);
    expect(cov.notChecked).toEqual([]);
    expect(cov.partiallyChecked).toEqual([]);
    expect(cov.failed).toEqual([]);
    sources.dispose();
  });

  it("ABSENT: formatCoverage(EMPTY_COVERAGE, ...) returns []", () => {
    expect(formatCoverage(EMPTY_COVERAGE, "house-rules coverage:", "  ")).toEqual([]);
  });
});

describe("formatCoverage — exact strings", () => {
  it("notChecked-only header is byte-identical to spec", () => {
    const cov = { notChecked: ["src/App.kt"], partiallyChecked: [], failed: [] };
    const lines = formatCoverage(cov, "house-rules coverage:", "  ");
    expect(lines[0]).toBe(
      "house-rules coverage: files no language adapter recognises were not checked.",
    );
    expect(lines[1]).toBe("  not checked: src/App.kt");
  });

  it("mixed coverage renders three line shapes in order with given indent", () => {
    const cov = {
      notChecked: ["src/App.kt"],
      partiallyChecked: [{ path: "src/a.ts", rows: [2] }],
      failed: [{ path: "src/b.ts", language: "typescript" as const, reason: "boom" }],
    };
    const lines = formatCoverage(cov, "house-rules coverage:", "  ");
    expect(lines[0]).toBe("house-rules coverage: some changed files were not fully checked.");
    expect(lines[1]).toBe("  not checked: src/App.kt");
    expect(lines[2]).toBe("  partially checked: src/a.ts (parse errors: rows 2)");
    expect(lines[3]).toBe("  failed: src/b.ts (typescript grammar did not load: boom)");
  });

  it("partially checked with consecutive run renders as range", () => {
    const cov = {
      notChecked: [],
      partiallyChecked: [{ path: "foo.yaml", rows: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232] }],
      failed: [],
    };
    const lines = formatCoverage(cov, "coverage:", "");
    // 230 consecutive rows collapse into one segment "3-232"
    expect(lines[1]).toBe("partially checked: foo.yaml (parse errors: rows 3-232)");
  });

  it("partially checked with gap renders ranges and singles", () => {
    const cov = {
      notChecked: [],
      partiallyChecked: [{ path: "com/example/Query.sql", rows: [14, 15, 16, 17, 42, 61, 78] }],
      failed: [],
    };
    const lines = formatCoverage(cov, "coverage:", "");
    expect(lines[1]).toBe("partially checked: com/example/Query.sql (parse errors: rows 14-17, 42, 61, 78)");
  });

  it("grammarFailureWarning exact string", () => {
    expect(grammarFailureWarning("src/b.ts", "typescript", "boom")).toBe(
      "house-rules warning: the typescript grammar did not load (boom); src/b.ts was not checked.",
    );
  });

  it("grammarWarnings delegates to grammarFailureWarning for each failed entry", () => {
    const cov = {
      notChecked: [],
      partiallyChecked: [],
      failed: [
        { path: "src/a.ts", language: "typescript" as const, reason: "boom" },
        { path: "src/b.go", language: "go" as const, reason: "missing wasm" },
      ],
    };
    expect(grammarWarnings(cov)).toEqual([
      "house-rules warning: the typescript grammar did not load (boom); src/a.ts was not checked.",
      "house-rules warning: the go grammar did not load (missing wasm); src/b.go was not checked.",
    ]);
  });
});
