import { describe, it, expect } from "bun:test";
import { languageForPath } from "../../src/hooks/languages/registry.js";
import { createSourceFiles } from "../../src/engine/source-file.js";

// Extensions where the default TS grammar (tree-sitter-typescript.wasm) applies
const TS_EXTS = [".ts", ".mts", ".cts"];
// Extensions where the JSX grammar variant (tree-sitter-tsx.wasm) applies
const JSX_EXTS = [".tsx", ".jsx", ".js", ".mjs", ".cjs"];
const ALL_EXTS = [...TS_EXTS, ...JSX_EXTS];

// Angle-bracket cast: valid TS syntax, not JSX — parses clean in TS, errors in TSX
const TS_GENERIC = "const a = <Foo>bar;";
const JSX_ELEMENT = 'const el = <div className="x">{y}</div>;';

describe("AC1: languageForPath identifies typescript for all 8 extensions", () => {
  for (const ext of ALL_EXTS) {
    it(`languageForPath("file${ext}") === "typescript"`, () => {
      expect(languageForPath(`file${ext}`)).toBe("typescript");
    });
  }
});

describe("AC2: grammar variant routing via createSourceFiles", () => {
  for (const ext of TS_EXTS) {
    it(`${ext}: TS generic cast parses clean (errorRows 0)`, async () => {
      const sf = createSourceFiles();
      const result = await sf.get("typescript", TS_GENERIC, `file${ext}`);
      sf.dispose();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.source.errorRows.size).toBe(0);
    });

    it(`${ext}: JSX element has parse errors`, async () => {
      const sf = createSourceFiles();
      const result = await sf.get("typescript", JSX_ELEMENT, `file${ext}`);
      sf.dispose();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.source.errorRows.size).toBeGreaterThan(0);
    });
  }

  for (const ext of JSX_EXTS) {
    it(`${ext}: JSX element parses clean (errorRows 0)`, async () => {
      const sf = createSourceFiles();
      const result = await sf.get("typescript", JSX_ELEMENT, `file${ext}`);
      sf.dispose();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.source.errorRows.size).toBe(0);
    });

    it(`${ext}: TS generic cast has parse errors`, async () => {
      const sf = createSourceFiles();
      const result = await sf.get("typescript", TS_GENERIC, `file${ext}`);
      sf.dispose();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.source.errorRows.size).toBeGreaterThan(0);
    });
  }
});
