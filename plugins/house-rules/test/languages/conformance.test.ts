import { describe, it, expect, afterAll } from "bun:test";
import path from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { LANGUAGES, LANGUAGE_ADAPTERS, languageForPath } from "../../src/hooks/languages/registry.js";
import { createSourceFiles } from "../../src/engine/source-file.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";

const FIXTURES_DIR = path.join(import.meta.dir, "../fixtures/languages");
const GRAMMARS_DIR = path.join(import.meta.dir, "../../src/hooks/grammars");
const PLUGIN_DIR = path.join(import.meta.dir, "../..");
const ROOT_PKG_PATH = path.join(import.meta.dir, "../../../../package.json");
const HEADER_RE = /conformance: comments=(\d+) directive=(\d+) doc=(\d+) groups=(\d+)/;

function sha256hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function countNamedNodes(node: { isNamed: boolean; childCount: number; child(i: number): { isNamed: boolean; childCount: number; child(i: number): any } }): number {
  let count = node.isNamed ? 1 : 0;
  for (let i = 0; i < node.childCount; i++) {
    count += countNamedNodes(node.child(i));
  }
  return count;
}

const rootPkg: { devDependencies: Record<string, string> } =
  JSON.parse(readFileSync(ROOT_PKG_PATH, "utf8"));

describe("language conformance", () => {
  const sf = createSourceFiles(getParser);
  afterAll(() => sf.dispose());

  for (const lang of LANGUAGES) {
    it(`conformance: ${lang}`, async () => {
      // (a) find fixture
      let entries: string[] = [];
      try {
        entries = readdirSync(FIXTURES_DIR);
      } catch {
        // directory absent: zero entries, will fail below
      }
      const matches = entries.filter((e) => {
        const ext = path.extname(e);
        const stem = ext ? e.slice(0, -ext.length) : e;
        return stem === lang;
      });
      if (matches.length === 0) {
        throw new Error(
          `no conformance fixture for language "${lang}" (expected test/fixtures/languages/${lang}.<ext>)`,
        );
      }
      if (matches.length > 1) {
        throw new Error(
          `language "${lang}": multiple fixtures found: ${matches.join(", ")}`,
        );
      }

      const fixturePath = path.join(FIXTURES_DIR, matches[0]);
      const text = readFileSync(fixturePath, "utf8");
      const firstLine = text.split("\n")[0];

      // (b)
      expect(languageForPath(fixturePath, firstLine), `language "${lang}": languageForPath mismatch`).toBe(lang);

      const result = await sf.get(lang, text);
      if (!result.ok) {
        throw new Error(`grammar for language "${lang}" did not load: ${result.reason}`);
      }
      const { source } = result;

      const adapter = LANGUAGE_ADAPTERS[lang];
      const wasmName = adapter.grammar.wasm;
      const wasmBuf = readFileSync(path.join(GRAMMARS_DIR, wasmName));
      const actualSha = sha256hex(wasmBuf);
      const actualBytes = wasmBuf.byteLength;
      const stem = wasmName.replace(/\.wasm$/, "");

      // (d) provenance checks
      if (adapter.grammar.vendor) {
        const sources: Record<string, { package: string; version: string; sha256: string; bytes: number }> =
          JSON.parse(readFileSync(path.join(GRAMMARS_DIR, "SOURCES.json"), "utf8"));
        const entry = sources[wasmName];
        expect(entry, `language "${lang}": ${wasmName} missing from SOURCES.json`).toBeTruthy();
        expect(entry.package, `language "${lang}": SOURCES.json package mismatch`).toBe(adapter.grammar.vendor.package);
        expect(entry.sha256, `language "${lang}": SOURCES.json sha256 mismatch`).toBe(actualSha);
        expect(entry.bytes, `language "${lang}": SOURCES.json bytes mismatch`).toBe(actualBytes);

        const vendorPkg = adapter.grammar.vendor.package;
        const pinnedVersion = rootPkg.devDependencies[vendorPkg];
        expect(pinnedVersion, `language "${lang}": package ${vendorPkg} missing from root devDependencies`).toBeTruthy();
        expect(entry.version, `language "${lang}": SOURCES.json version for ${vendorPkg} (${entry.version}) !== package.json pin (${pinnedVersion})`).toBe(pinnedVersion);

        const sourceJsonPath = path.join(GRAMMARS_DIR, `${stem}.source.json`);
        if (existsSync(sourceJsonPath)) {
          const sj: { package: string; version: string; sha256: string; bytes: number } =
            JSON.parse(readFileSync(sourceJsonPath, "utf8"));
          expect(sj.package, `language "${lang}": source.json package must equal SOURCES.json package`).toBe(entry.package);
          expect(sj.version, `language "${lang}": source.json version must equal SOURCES.json version`).toBe(entry.version);
          expect(sj.sha256, `language "${lang}": source.json sha256 must equal SOURCES.json sha256`).toBe(entry.sha256);
          expect(sj.bytes, `language "${lang}": source.json bytes must equal SOURCES.json bytes`).toBe(entry.bytes);
        }
      } else if (adapter.grammar.build) {
        const sj: { sha256: string; bytes: number; build_command?: string; cli_version?: string; package?: string; version?: string; repo?: string; commit?: string } =
          JSON.parse(readFileSync(path.join(GRAMMARS_DIR, `${stem}.source.json`), "utf8"));
        expect(sj.sha256, `language "${lang}": source.json sha256 mismatch`).toBe(actualSha);
        expect(sj.bytes, `language "${lang}": source.json bytes mismatch`).toBe(actualBytes);
        expect(sj.build_command, `language "${lang}": source.json build_command must contain "tree-sitter build --wasm"`).toContain("tree-sitter build --wasm");
        expect(sj.cli_version, `language "${lang}": source.json cli_version must match semver`).toMatch(/^\d+\.\d+\.\d+$/);

        if (sj.package) {
          const pinnedVersion = rootPkg.devDependencies[sj.package];
          expect(pinnedVersion, `language "${lang}": source.json package ${sj.package} not in root devDependencies`).toBeTruthy();
          expect(sj.version, `language "${lang}": source.json version for ${sj.package} (${sj.version}) !== package.json pin (${pinnedVersion})`).toBe(pinnedVersion);
        }

        if (sj.repo) {
          expect(sj.commit, `language "${lang}": source.json commit must be a 40-char lowercase hex string`).toMatch(/^[0-9a-f]{40}$/);
        }

        const scriptPath = path.join(PLUGIN_DIR, adapter.grammar.build);
        expect(existsSync(scriptPath), `language "${lang}": build script ${adapter.grammar.build} not found in plugin`).toBe(true);
        const script = readFileSync(scriptPath, "utf8");
        const pin = (name: string): string => script.match(new RegExp(`^${name}="([^"]*)"`, "m"))?.[1] ?? `<${name} not set>`;
        expect(sj.cli_version, `language "${lang}": source.json cli_version must equal CLI_VERSION in ${adapter.grammar.build}`).toBe(pin("CLI_VERSION"));
        if (sj.repo) {
          expect(sj.repo, `language "${lang}": source.json repo must equal GRAMMAR_REPO in ${adapter.grammar.build}`).toBe(pin("GRAMMAR_REPO"));
          expect(sj.commit, `language "${lang}": source.json commit must equal GRAMMAR_COMMIT in ${adapter.grammar.build}`).toBe(pin("GRAMMAR_COMMIT"));
        }
      }

      // (e)
      if (source.errorRows.size > 0) {
        throw new Error(
          `language "${lang}": fixture has parse errors on rows: ${[...source.errorRows].join(", ")}`,
        );
      }

      const namedCount = countNamedNodes(source.tree.rootNode);
      expect(namedCount, `language "${lang}": non-trivial parse: named node count ${namedCount} < 60`).toBeGreaterThanOrEqual(60);

      // (f)
      const allMatches = [...text.matchAll(new RegExp(HEADER_RE.source, "g"))];
      if (allMatches.length !== 1) {
        throw new Error(
          `language "${lang}": expected exactly 1 conformance header, found ${allMatches.length}`,
        );
      }
      const [, rc, rd, rdc, rg] = allMatches[0];
      const declared = {
        comments: parseInt(rc, 10),
        directive: parseInt(rd, 10),
        doc: parseInt(rdc, 10),
        groups: parseInt(rg, 10),
      };
      const { comments } = source;
      const actual = {
        comments: comments.length,
        directive: comments.filter((c) => c.directive).length,
        doc: comments.filter((c) => c.kind === "doc").length,
        groups: new Set(comments.map((c) => c.group).filter((g) => g !== null)).size,
      };
      expect(actual, `${lang} fixture counts`).toEqual(declared);
    });
  }
});
