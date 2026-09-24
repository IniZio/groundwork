import { describe, it, expect, beforeAll } from "bun:test";
import { execSync, spawnSync } from "node:child_process";
import { mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getParser, type Lang } from "../../src/hooks/lib/tree-sitter-loader.js";

const GRAMMARS_DIR = path.resolve(import.meta.dir, "../../src/hooks/grammars");
const HOOKS_DIR = path.resolve(import.meta.dir, "../../src/hooks");

function walkComments(node: import("../../src/hooks/lib/tree-sitter.js").Node): string[] {
  const found: string[] = [];
  if (node.type.includes("comment")) found.push(node.type);
  for (let i = 0; i < node.childCount; i++) {
    found.push(...walkComments(node.child(i)!));
  }
  return found;
}

describe("AC1: loadLanguage loads grammars from buffer", () => {
  const CASES: { lang: Lang; sample: string }[] = [
    { lang: "bash", sample: "#!/bin/bash\n# a comment\necho 'hi'" },
    { lang: "yaml", sample: "# yaml comment\nkey: value\n" },
    { lang: "typescript", sample: "// ts comment\nconst x = 1;\n" },
    { lang: "tsx", sample: "// tsx comment\nconst el = <div/>;\n" },
    { lang: "python", sample: "# python comment\ndef foo(): pass\n" },
  ];

  for (const { lang, sample } of CASES) {
    it(`${lang}: parses sample and finds a comment node`, async () => {
      const result = await getParser(lang);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tree = result.parser.parse(sample);
      const comments = walkComments(tree.rootNode);
      expect(comments.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("AC2: vendored runtime works without node_modules", () => {
  const TMP = `/tmp/gw-ts-loader-test-${process.pid}`;

  beforeAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(path.join(TMP, "hooks"), { recursive: true });
    cpSync(HOOKS_DIR, path.join(TMP, "hooks"), { recursive: true });
  });

  it("probe spawned by path in no-node_modules dir exits 0 and prints OK", () => {
    const probePath = path.join(TMP, "hooks/lib/tree-sitter-probe.ts");
    const result = spawnSync("bun", [probePath], {
      cwd: TMP,
      encoding: "utf8",
      timeout: 30000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OK");
    expect(result.stdout).toContain("comments=");
  });
});

describe("AC3: missing or corrupt wasm fails open", () => {
  const TMP3 = `/tmp/gw-ts-loader-failopen-${process.pid}`;

  beforeAll(() => {
    rmSync(TMP3, { recursive: true, force: true });
    mkdirSync(path.join(TMP3, "hooks"), { recursive: true });
    cpSync(HOOKS_DIR, path.join(TMP3, "hooks"), { recursive: true });
    rmSync(path.join(TMP3, "hooks/grammars/tree-sitter-python.wasm"));
    writeFileSync(path.join(TMP3, "probe-failopen.ts"), [
      'import { getParser } from "./hooks/lib/tree-sitter-loader.js";',
      'const r = await getParser("python");',
      'process.stdout.write(r.ok ? "ok=true\\n" : "ok=false reason=" + r.reason + "\\n");',
      'process.exit(r.ok ? 1 : 0);',
    ].join("\n"));
  });

  it("missing wasm returns {ok:false} with a reason (spawned probe, python.wasm removed)", () => {
    const result = spawnSync("bun", [path.join(TMP3, "probe-failopen.ts")], {
      cwd: TMP3,
      encoding: "utf8",
      timeout: 30000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ok=false");
    expect(result.stdout).toContain("reason=");
  });
});

describe("AC4: SOURCES.json records package@version + sha256", () => {
  it("SOURCES.json has entries for all 5 grammars plus runtime files", async () => {
    const sourcesFile = Bun.file(path.join(GRAMMARS_DIR, "SOURCES.json"));
    const sources = await sourcesFile.json();
    const keys = Object.keys(sources);
    expect(keys).toContain("tree-sitter-bash.wasm");
    expect(keys).toContain("tree-sitter-yaml.wasm");
    expect(keys).toContain("tree-sitter-typescript.wasm");
    expect(keys).toContain("tree-sitter-tsx.wasm");
    expect(keys).toContain("tree-sitter-python.wasm");
    for (const entry of Object.values(sources) as Array<{ package: string; version: string; sha256: string }>) {
      expect(entry.package).toBeTruthy();
      expect(entry.version).toBeTruthy();
      expect(entry.sha256).toHaveLength(64);
    }
  });

  it("re-running vendor-grammars.ts produces byte-identical SOURCES.json", async () => {
    const before = await Bun.file(path.join(GRAMMARS_DIR, "SOURCES.json")).text();
    execSync("bun scripts/vendor-grammars.ts", {
      cwd: path.resolve(import.meta.dir, "../.."),
      encoding: "utf8",
    });
    const after = await Bun.file(path.join(GRAMMARS_DIR, "SOURCES.json")).text();
    expect(after).toBe(before);
  });
});

describe("AC5: package.json pins exact versions, no tree-sitter-wasms", () => {
  it("devDependencies contain the required packages at pinned versions", async () => {
    const pkg = await Bun.file(path.resolve(import.meta.dir, "../../../../package.json")).json();
    const dev = pkg.devDependencies;
    expect(dev["web-tree-sitter"]).toBe("0.25.0");
    expect(dev["tree-sitter-bash"]).toBe("0.25.1");
    expect(dev["@tree-sitter-grammars/tree-sitter-yaml"]).toBe("0.7.1");
    expect(dev["tree-sitter-typescript"]).toBe("0.23.2");
    expect(dev["tree-sitter-python"]).toBe("0.25.0");
  });

  it("tree-sitter-wasms is absent from package.json", async () => {
    const pkg = await Bun.file(path.resolve(import.meta.dir, "../../../../package.json")).json();
    const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    expect(Object.keys(all)).not.toContain("tree-sitter-wasms");
  });
});

describe("AC6: getParser is memoised; dockerfile loads; Lang type includes all 6", () => {
  it("second call for bash returns cached result (same object reference)", async () => {
    const r1 = await getParser("bash");
    const r2 = await getParser("bash");
    expect(r1).toBe(r2);
  });

  it("dockerfile grammar loads with ok:true", async () => {
    const r = await getParser("dockerfile");
    expect(r.ok).toBe(true);
  });
});

describe("AC7: new language grammars load (go, rust, sql, make, toml)", () => {
  const NEW_LANGS: { lang: Parameters<typeof getParser>[0]; sample: string }[] = [
    { lang: "go", sample: "// go comment\npackage main\nfunc main() {}\n" },
    { lang: "rust", sample: "// rust comment\nfn main() {}\n" },
    { lang: "sql", sample: "-- sql comment\nSELECT 1;\n" },
    { lang: "make", sample: "# make comment\nall:\n\techo hi\n" },
    { lang: "toml", sample: "# toml comment\n[package]\nname = \"test\"\n" },
  ];

  for (const { lang, sample } of NEW_LANGS) {
    it(`${lang}: loads with ok:true and parses sample`, async () => {
      const r = await getParser(lang);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const tree = r.parser.parse(sample);
      expect(tree.rootNode).toBeDefined();
    });

    it(`${lang}: second call returns memoised result (same object reference)`, async () => {
      const r1 = await getParser(lang);
      const r2 = await getParser(lang);
      expect(r1).toBe(r2);
    });
  }
});
