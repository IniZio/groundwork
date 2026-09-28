import { describe, it, expect } from "bun:test";
import { notCheckedFiles, coverageReport } from "../../src/engine/run.js";
import type { Rule, RuleContext, ScopedFile } from "../../src/engine/types.js";
import type { Language } from "../../src/hooks/languages/registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(langs: string[]): Rule {
  return {
    id: "density",
    meta: { description: "stub density rule" },
    languages: langs as readonly Language[],
    check: () => [],
  };
}

function makeFile(filePath: string, opts: { lang?: Language; text?: string } = {}): ScopedFile {
  return { path: filePath, text: opts.text ?? "content", lang: opts.lang };
}

// ---------------------------------------------------------------------------
// notCheckedFiles: lang === undefined falls back to languageForPath
// ---------------------------------------------------------------------------

describe("notCheckedFiles — lang fallback via languageForPath", () => {
  const rule = makeRule(["kotlin", "swift", "java", "typescript", "python"]);

  it("lang=undefined for .kt/.kts/.swift/.java reports only x.rb", () => {
    const files: ScopedFile[] = [
      makeFile("a.kt"),              // lang: undefined → resolves 'kotlin' → covered
      makeFile("build.gradle.kts"),  // lang: undefined → resolves 'kotlin' → covered
      makeFile("App.swift"),
      makeFile("Foo.java"),
      makeFile("x.rb"),
    ];
    const result = notCheckedFiles([rule], files);
    expect(result).toEqual(["x.rb"]);
  });

  it("file.lang explicitly set to uncovered language still reports", () => {
    const files: ScopedFile[] = [
      makeFile("script.rb", { lang: undefined }),
      makeFile("legacy.rb", { lang: "go" as Language }),
    ];
    const result = notCheckedFiles([rule], files);
    expect(result).toContain("script.rb");
    expect(result).toContain("legacy.rb");
  });

  it("file.lang set to covered language is NOT reported", () => {
    const files: ScopedFile[] = [
      makeFile("Main.kt", { lang: "kotlin" as Language }),
    ];
    const result = notCheckedFiles([rule], files);
    expect(result).toEqual([]);
  });
});


describe("coverageReport — lang fallback produces failed entry", () => {
  it("lang=undefined + sourceFile returning {ok:false} produces failed entry", async () => {
    const rule = makeRule(["kotlin"]);
    const file = makeFile("Main.kt", { text: "class Foo {}" });

    const ctx: RuleContext = {
      repoRoot: "/repo",
      mode: "cli",
      files: [file],
      sourceFile: async (_f) => ({ ok: false, reason: "grammar not loaded" }),
    };

    const cov = await coverageReport([rule], ctx);
    expect(cov.failed).toHaveLength(1);
    expect(cov.failed[0].path).toBe("Main.kt");
    expect(cov.failed[0].language).toBe("kotlin");
    expect(cov.failed[0].reason).toBe("grammar not loaded");
    expect(cov.notChecked).toEqual([]);
  });

  it("lang=undefined + sourceFile returning null does NOT produce failed or notChecked entry", async () => {
    const rule = makeRule(["kotlin"]);
    const file = makeFile("Main.kt", { text: "class Foo {}" });

    const ctx: RuleContext = {
      repoRoot: "/repo",
      mode: "cli",
      files: [file],
      sourceFile: async (_f) => null,
    };

    const cov = await coverageReport([rule], ctx);
    expect(cov.failed).toHaveLength(0);
    expect(cov.notChecked).toEqual([]);
  });
});
