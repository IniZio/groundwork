#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "..");
const NM = path.join(ROOT, "node_modules");
const LIB_DIR = path.join(ROOT, "src/hooks/lib");
const GRAMMARS_DIR = path.join(ROOT, "src/hooks/grammars");

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function vendor(src: string, dest: string): { file: string; sha256: string; bytes: number } {
  copyFileSync(src, dest);
  const buf = readFileSync(src);
  return { file: path.basename(dest), sha256: sha256(buf), bytes: buf.length };
}

const sources: Record<string, { package: string; version: string; file: string; sha256: string; bytes: number }> = {};

function record(
  pkg: string,
  version: string,
  src: string,
  dest: string,
) {
  const info = vendor(src, dest);
  sources[info.file] = { package: pkg, version, ...info };
}

const tsVer = JSON.parse(readFileSync(path.join(NM, "web-tree-sitter/package.json"), "utf8")).version as string;
record("web-tree-sitter", tsVer, path.join(NM, "web-tree-sitter/tree-sitter.js"), path.join(LIB_DIR, "tree-sitter.js"));
record("web-tree-sitter", tsVer, path.join(NM, "web-tree-sitter/tree-sitter.wasm"), path.join(LIB_DIR, "tree-sitter.wasm"));

const bashVer = JSON.parse(readFileSync(path.join(NM, "tree-sitter-bash/package.json"), "utf8")).version as string;
record("tree-sitter-bash", bashVer, path.join(NM, "tree-sitter-bash/tree-sitter-bash.wasm"), path.join(GRAMMARS_DIR, "tree-sitter-bash.wasm"));

const yamlVer = JSON.parse(readFileSync(path.join(NM, "@tree-sitter-grammars/tree-sitter-yaml/package.json"), "utf8")).version as string;
record("@tree-sitter-grammars/tree-sitter-yaml", yamlVer, path.join(NM, "@tree-sitter-grammars/tree-sitter-yaml/tree-sitter-yaml.wasm"), path.join(GRAMMARS_DIR, "tree-sitter-yaml.wasm"));

const tsgramVer = JSON.parse(readFileSync(path.join(NM, "tree-sitter-typescript/package.json"), "utf8")).version as string;
record("tree-sitter-typescript", tsgramVer, path.join(NM, "tree-sitter-typescript/tree-sitter-typescript.wasm"), path.join(GRAMMARS_DIR, "tree-sitter-typescript.wasm"));
record("tree-sitter-typescript", tsgramVer, path.join(NM, "tree-sitter-typescript/tree-sitter-tsx.wasm"), path.join(GRAMMARS_DIR, "tree-sitter-tsx.wasm"));

const pyVer = JSON.parse(readFileSync(path.join(NM, "tree-sitter-python/package.json"), "utf8")).version as string;
record("tree-sitter-python", pyVer, path.join(NM, "tree-sitter-python/tree-sitter-python.wasm"), path.join(GRAMMARS_DIR, "tree-sitter-python.wasm"));

const sourcesPath = path.join(GRAMMARS_DIR, "SOURCES.json");
const json = JSON.stringify(sources, null, 2) + "\n";
Bun.write(sourcesPath, json);

const totalBytes = Object.values(sources).reduce((s, e) => s + e.bytes, 0);
console.log(`Vendored ${Object.keys(sources).length} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
for (const [file, info] of Object.entries(sources)) {
  console.log(`  ${file}  ${info.package}@${info.version}  ${info.sha256.slice(0, 12)}…`);
}
