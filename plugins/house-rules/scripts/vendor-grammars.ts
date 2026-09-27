#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { LANGUAGE_ADAPTERS, LANGUAGES } from "../src/hooks/languages/registry.js";

const ROOT = path.resolve(import.meta.dir, "..");
const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const NM = path.join(REPO_ROOT, "node_modules");
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

for (const lang of LANGUAGES) {
  const { grammar } = LANGUAGE_ADAPTERS[lang];
  if (!grammar.vendor) continue;
  const { package: pkg, file } = grammar.vendor;
  const version = JSON.parse(readFileSync(path.join(NM, pkg, "package.json"), "utf8")).version as string;
  record(pkg, version, path.join(NM, pkg, file), path.join(GRAMMARS_DIR, grammar.wasm));
}

const sourcesPath = path.join(GRAMMARS_DIR, "SOURCES.json");
const json = JSON.stringify(sources, null, 2) + "\n";
Bun.write(sourcesPath, json);

const totalBytes = Object.values(sources).reduce((s, e) => s + e.bytes, 0);
console.log(`Vendored ${Object.keys(sources).length} files (${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
for (const [file, info] of Object.entries(sources)) {
  console.log(`  ${file}  ${info.package}@${info.version}  ${info.sha256.slice(0, 12)}…`);
}
