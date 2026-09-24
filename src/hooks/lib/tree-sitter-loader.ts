import path from "node:path";
import { Parser, Language } from "./tree-sitter.js";

export type Lang = "bash" | "yaml" | "typescript" | "tsx" | "python" | "dockerfile" | "go" | "rust" | "sql" | "make" | "toml";

export type LoadResult =
  | { ok: true; parser: Parser; language: Language }
  | { ok: false; reason: string };

const GRAMMARS_DIR = path.join(import.meta.dir, "../grammars");
const LIB_DIR = import.meta.dir;

const WASM_FILES: Record<Lang, string> = {
  bash: "tree-sitter-bash.wasm",
  yaml: "tree-sitter-yaml.wasm",
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-tsx.wasm",
  python: "tree-sitter-python.wasm",
  dockerfile: "tree-sitter-dockerfile.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  sql: "tree-sitter-sql.wasm",
  make: "tree-sitter-make.wasm",
  toml: "tree-sitter-toml.wasm",
};

let initPromise: Promise<void> | null = null;
const cache = new Map<Lang, LoadResult>();

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const wasmBinary = await Bun.file(path.join(LIB_DIR, "tree-sitter.wasm")).arrayBuffer();
      await Parser.init({ wasmBinary });
    })();
  }
  return initPromise;
}

export async function getParser(lang: Lang): Promise<LoadResult> {
  const cached = cache.get(lang);
  if (cached) return cached;

  try {
    await ensureInit();
  } catch (e) {
    const result: LoadResult = { ok: false, reason: `Parser init failed: ${e}` };
    return result;
  }

  const wasmFile = WASM_FILES[lang];
  const wasmPath = path.join(GRAMMARS_DIR, wasmFile);

  let buf: Uint8Array;
  try {
    buf = new Uint8Array(await Bun.file(wasmPath).arrayBuffer());
  } catch (e) {
    const result: LoadResult = { ok: false, reason: `Grammar not found: ${wasmPath}` };
    cache.set(lang, result);
    return result;
  }

  if (buf.length < 8) {
    const result: LoadResult = { ok: false, reason: `Corrupt wasm: ${wasmPath}` };
    cache.set(lang, result);
    return result;
  }

  try {
    const language = await Language.load(buf);
    const parser = new Parser();
    parser.setLanguage(language);
    const result: LoadResult = { ok: true, parser, language };
    cache.set(lang, result);
    return result;
  } catch (e) {
    const result: LoadResult = { ok: false, reason: `Language load failed: ${e}` };
    cache.set(lang, result);
    return result;
  }
}
