import { describe, it, expect } from "bun:test";
import path from "node:path";
import { runRules, notCheckedFiles } from "../../src/engine/run.js";
import { loadRules } from "../../src/engine/registry.js";
import type { Rule, RuleContext, ScopedFile } from "../../src/engine/types.js";

// ---------------------------------------------------------------------------
// notCheckedFiles — with real rules loaded from the rules directory
// ---------------------------------------------------------------------------

describe("notCheckedFiles — real rules", () => {
  let rules: Rule[];

  const rulesReady = loadRules(
    path.resolve(import.meta.dir, "../../rules"),
  ).then((r) => {
    rules = r;
  });

  it("PRESENT: .kt file with lang undefined is listed (not checked by any rule)", async () => {
    await rulesReady;
    const files: ScopedFile[] = [
      { path: "src/App.kt", text: "fun main(){}" },
      { path: "a.ts", text: "x", lang: "typescript" },
    ];
    const result = notCheckedFiles(rules, files);
    expect(result).toContain("src/App.kt");
    expect(result).not.toContain("a.ts");
  });

  it("PRESENT: App.kt and Main.java listed; ABSENT: non-source files (LA-D3)", async () => {
    await rulesReady;
    const files: ScopedFile[] = [
      { path: "src/App.kt", text: "fun main(){}" },
      { path: "src/Main.java", text: "class Main {}" },
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
    expect(result).toContain("src/App.kt");
    expect(result).toContain("src/Main.java");
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
      vehicles: ["diff"],
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
      vehicles: ["tree-sitter"],
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
