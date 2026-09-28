import { describe, it, expect, afterAll } from "bun:test";
import path from "node:path";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { LANGUAGES, languageForPath, grammarsOf, grammarFor, grammarVariantForPath } from "../../src/hooks/languages/registry.js";
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
    const grammars = grammarsOf(lang);

    // Collect all fixture files whose stem equals the language id
    let allEntries: string[] = [];
    try {
      allEntries = readdirSync(FIXTURES_DIR);
    } catch {
      // directory absent: zero entries, will fail below
    }

    const fixturesForLang = allEntries.filter((e) => {
      const ext = path.extname(e);
      const stem = ext ? e.slice(0, -ext.length) : e;
      return stem === lang;
    });

    // Group fixtures by which grammar (wasm) they resolve to
    const fixturesByGrammar = new Map<string, string[]>();
    for (const g of grammars) {
      fixturesByGrammar.set(g.wasm, []);
    }
    for (const e of fixturesForLang) {
      const fixturePath = path.join(FIXTURES_DIR, e);
      const variant = grammarVariantForPath(lang, fixturePath);
      const g = grammarFor(lang, variant);
      const bucket = fixturesByGrammar.get(g.wasm);
      if (bucket) bucket.push(e);
    }

    for (const grammarObj of grammars) {
      const wasmName = grammarObj.wasm;
      const matches = fixturesByGrammar.get(wasmName) ?? [];

      it(`conformance: ${lang} [${wasmName}]`, async () => {
        // (a) exactly one fixture per grammar
        if (matches.length === 0) {
          throw new Error(
            `no conformance fixture for language "${lang}" grammar "${wasmName}" ` +
            `(expected test/fixtures/languages/${lang}.<ext> that resolves to this grammar)`,
          );
        }
        if (matches.length > 1) {
          throw new Error(
            `language "${lang}" grammar "${wasmName}": multiple fixtures found: ${matches.join(", ")}`,
          );
        }

        const fixturePath = path.join(FIXTURES_DIR, matches[0]);
        const text = readFileSync(fixturePath, "utf8");
        const firstLine = text.split("\n")[0];

        // (b) languageForPath round-trip
        expect(languageForPath(fixturePath, firstLine), `language "${lang}" [${wasmName}]: languageForPath mismatch`).toBe(lang);

        // (c) parse with the grammar appropriate for this fixture's path
        const result = await sf.get(lang, text, fixturePath);
        if (!result.ok) {
          throw new Error(`grammar "${wasmName}" for language "${lang}" did not load: ${result.reason}`);
        }
        const { source } = result;

        const stem = wasmName.replace(/\.wasm$/, "");
        const wasmBuf = readFileSync(path.join(GRAMMARS_DIR, wasmName));
        const actualSha = sha256hex(wasmBuf);
        const actualBytes = wasmBuf.byteLength;

        // (d) provenance checks
        if (grammarObj.vendor) {
          const sources: Record<string, { package: string; version: string; sha256: string; bytes: number }> =
            JSON.parse(readFileSync(path.join(GRAMMARS_DIR, "SOURCES.json"), "utf8"));
          const entry = sources[wasmName];
          expect(entry, `language "${lang}" [${wasmName}]: missing from SOURCES.json`).toBeTruthy();
          expect(entry.package, `language "${lang}" [${wasmName}]: SOURCES.json package mismatch`).toBe(grammarObj.vendor.package);
          expect(entry.sha256, `language "${lang}" [${wasmName}]: SOURCES.json sha256 mismatch`).toBe(actualSha);
          expect(entry.bytes, `language "${lang}" [${wasmName}]: SOURCES.json bytes mismatch`).toBe(actualBytes);

          const vendorPkg = grammarObj.vendor.package;
          const pinnedVersion = rootPkg.devDependencies[vendorPkg];
          expect(pinnedVersion, `language "${lang}" [${wasmName}]: package ${vendorPkg} missing from root devDependencies`).toBeTruthy();
          expect(entry.version, `language "${lang}" [${wasmName}]: SOURCES.json version (${entry.version}) !== package.json pin (${pinnedVersion})`).toBe(pinnedVersion);

          const sourceJsonPath = path.join(GRAMMARS_DIR, `${stem}.source.json`);
          if (existsSync(sourceJsonPath)) {
            const sj: { package: string; version: string; sha256: string; bytes: number } =
              JSON.parse(readFileSync(sourceJsonPath, "utf8"));
            expect(sj.package, `language "${lang}" [${wasmName}]: source.json package must equal SOURCES.json`).toBe(entry.package);
            expect(sj.version, `language "${lang}" [${wasmName}]: source.json version must equal SOURCES.json`).toBe(entry.version);
            expect(sj.sha256, `language "${lang}" [${wasmName}]: source.json sha256 must equal SOURCES.json`).toBe(entry.sha256);
            expect(sj.bytes, `language "${lang}" [${wasmName}]: source.json bytes must equal SOURCES.json`).toBe(entry.bytes);
          }
        } else if (grammarObj.build) {
          const sj: { sha256: string; bytes: number; build_command?: string; cli_version?: string; package?: string; version?: string; repo?: string; commit?: string } =
            JSON.parse(readFileSync(path.join(GRAMMARS_DIR, `${stem}.source.json`), "utf8"));
          expect(sj.sha256, `language "${lang}" [${wasmName}]: source.json sha256 mismatch`).toBe(actualSha);
          expect(sj.bytes, `language "${lang}" [${wasmName}]: source.json bytes mismatch`).toBe(actualBytes);
          expect(sj.build_command, `language "${lang}" [${wasmName}]: source.json build_command must contain "tree-sitter build --wasm"`).toContain("tree-sitter build --wasm");
          expect(sj.cli_version, `language "${lang}" [${wasmName}]: source.json cli_version must match semver`).toMatch(/^\d+\.\d+\.\d+$/);

          if (sj.package) {
            const pinnedVersion = rootPkg.devDependencies[sj.package];
            expect(pinnedVersion, `language "${lang}" [${wasmName}]: source.json package ${sj.package} not in root devDependencies`).toBeTruthy();
            expect(sj.version, `language "${lang}" [${wasmName}]: source.json version (${sj.version}) !== package.json pin (${pinnedVersion})`).toBe(pinnedVersion);
          }

          if (sj.repo) {
            expect(sj.commit, `language "${lang}" [${wasmName}]: source.json commit must be 40-char lowercase hex`).toMatch(/^[0-9a-f]{40}$/);
          }

          const scriptPath = path.join(PLUGIN_DIR, grammarObj.build);
          expect(existsSync(scriptPath), `language "${lang}" [${wasmName}]: build script ${grammarObj.build} not found`).toBe(true);
          const script = readFileSync(scriptPath, "utf8");
          const pin = (name: string): string => script.match(new RegExp(`^${name}="([^"]*)"`, "m"))?.[1] ?? `<${name} not set>`;
          expect(sj.cli_version, `language "${lang}" [${wasmName}]: source.json cli_version must equal CLI_VERSION in ${grammarObj.build}`).toBe(pin("CLI_VERSION"));
          if (sj.repo) {
            expect(sj.repo, `language "${lang}" [${wasmName}]: source.json repo must equal GRAMMAR_REPO`).toBe(pin("GRAMMAR_REPO"));
            expect(sj.commit, `language "${lang}" [${wasmName}]: source.json commit must equal GRAMMAR_COMMIT`).toBe(pin("GRAMMAR_COMMIT"));
          }
        }

        if (source.errorRows.size > 0) {
          throw new Error(
            `language "${lang}" [${wasmName}]: fixture has parse errors on rows: ${[...source.errorRows].join(", ")}`,
          );
        }

        const namedCount = countNamedNodes(source.tree.rootNode);
        expect(namedCount, `language "${lang}" [${wasmName}]: non-trivial parse: named node count ${namedCount} < 60`).toBeGreaterThanOrEqual(60);

        const allMatches = [...text.matchAll(new RegExp(HEADER_RE.source, "g"))];
        if (allMatches.length !== 1) {
          throw new Error(
            `language "${lang}" [${wasmName}]: expected exactly 1 conformance header, found ${allMatches.length}`,
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
        expect(actual, `${lang} [${wasmName}] fixture counts`).toEqual(declared);
      });
    }
  }
});
