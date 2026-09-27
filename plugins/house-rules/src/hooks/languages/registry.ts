import path from "node:path";
import type { CommentClassifier } from "./comments.js";
import { classifyGoComments } from "./go.js";
import { classifyRustComments } from "./rust.js";
import { classifyDockerfileComments } from "./dockerfile.js";
import { classifyTomlComments } from "./toml.js";
import { isSqlCommentNodeType } from "./sql.js";
import {
  withToolMarkers,
  TYPESCRIPT_TOOL_MARKERS,
  PYTHON_TOOL_MARKERS,
  BASH_TOOL_MARKERS,
  YAML_TOOL_MARKERS,
} from "./tool-markers.js";

export interface LanguageDetection {
  /** lower-case, with leading dot, compared to path.extname(p).toLowerCase() */
  readonly extensions: readonly string[];
  /** exact, case-sensitive basenames */
  readonly basenames?: readonly string[];
  /** case-INsensitive basename prefixes; checked before extensions */
  readonly basenamePrefixes?: readonly string[];
  /** shebang interpreter names; only consulted when the file has no extension and a first line is given */
  readonly shebangInterpreters?: readonly string[];
}

export interface LanguageGrammar {
  /** wasm file name under HR/src/hooks/grammars/ */
  readonly wasm: string;
  /** npm package + path of the wasm file inside that package; present = copied by scripts/vendor-grammars.ts */
  readonly vendor?: { readonly package: string; readonly file: string };
  /** plugin-relative build script path; present = built from source, not vendored */
  readonly build?: string;
}

export interface LanguageAdapter {
  readonly id: string;
  readonly detect: LanguageDetection;
  readonly grammar: LanguageGrammar;
  /** which grammar node types are comments; absent = any type whose name contains "comment" */
  readonly isCommentNodeType?: (type: string) => boolean;
  /** when absent, the default classifier applies: adjacent whole-line comments of the same kind form a group */
  readonly classifyComments?: CommentClassifier;
}

const bash = {
  id: "bash",
  detect: {
    extensions: [".sh", ".bash"],
    shebangInterpreters: ["bash", "bsh", "sh", "zsh"],
  },
  grammar: {
    wasm: "tree-sitter-bash.wasm",
    vendor: { package: "tree-sitter-bash", file: "tree-sitter-bash.wasm" },
  },
  classifyComments: withToolMarkers(BASH_TOOL_MARKERS),
} satisfies LanguageAdapter;

const yaml = {
  id: "yaml",
  detect: {
    extensions: [".yml", ".yaml"],
  },
  grammar: {
    wasm: "tree-sitter-yaml.wasm",
    vendor: { package: "@tree-sitter-grammars/tree-sitter-yaml", file: "tree-sitter-yaml.wasm" },
  },
  classifyComments: withToolMarkers(YAML_TOOL_MARKERS),
} satisfies LanguageAdapter;

const typescript = {
  id: "typescript",
  detect: {
    extensions: [".ts", ".mts", ".cts"],
  },
  grammar: {
    wasm: "tree-sitter-typescript.wasm",
    vendor: { package: "tree-sitter-typescript", file: "tree-sitter-typescript.wasm" },
  },
  classifyComments: withToolMarkers(TYPESCRIPT_TOOL_MARKERS),
} satisfies LanguageAdapter;

const tsx = {
  id: "tsx",
  detect: {
    extensions: [".tsx", ".jsx", ".js", ".mjs", ".cjs"],
  },
  grammar: {
    wasm: "tree-sitter-tsx.wasm",
    vendor: { package: "tree-sitter-typescript", file: "tree-sitter-tsx.wasm" },
  },
  classifyComments: withToolMarkers(TYPESCRIPT_TOOL_MARKERS),
} satisfies LanguageAdapter;

const python = {
  id: "python",
  detect: {
    extensions: [".py"],
  },
  grammar: {
    wasm: "tree-sitter-python.wasm",
    vendor: { package: "tree-sitter-python", file: "tree-sitter-python.wasm" },
  },
  classifyComments: withToolMarkers(PYTHON_TOOL_MARKERS),
} satisfies LanguageAdapter;

const dockerfile = {
  id: "dockerfile",
  detect: {
    extensions: [".dockerfile"],
    basenames: ["Dockerfile", "Containerfile"],
    basenamePrefixes: ["Dockerfile.", "Containerfile."],
  },
  grammar: {
    wasm: "tree-sitter-dockerfile.wasm",
    build: "scripts/build-dockerfile-grammar.sh",
  },
  classifyComments: classifyDockerfileComments,
} satisfies LanguageAdapter;

const go = {
  id: "go",
  detect: {
    extensions: [".go"],
  },
  grammar: {
    wasm: "tree-sitter-go.wasm",
    vendor: { package: "tree-sitter-go", file: "tree-sitter-go.wasm" },
  },
  classifyComments: classifyGoComments,
} satisfies LanguageAdapter;

const rust = {
  id: "rust",
  detect: {
    extensions: [".rs"],
  },
  grammar: {
    wasm: "tree-sitter-rust.wasm",
    vendor: { package: "tree-sitter-rust", file: "tree-sitter-rust.wasm" },
  },
  classifyComments: classifyRustComments,
} satisfies LanguageAdapter;

const sql = {
  id: "sql",
  detect: {
    extensions: [".sql"],
  },
  grammar: {
    wasm: "tree-sitter-sql.wasm",
    build: "scripts/build-sql-grammar.sh",
  },
  isCommentNodeType: isSqlCommentNodeType,
} satisfies LanguageAdapter;

const make = {
  id: "make",
  detect: {
    extensions: [".mk"],
    basenames: ["Makefile", "GNUmakefile", "makefile"],
  },
  grammar: {
    wasm: "tree-sitter-make.wasm",
    vendor: { package: "tree-sitter-make", file: "tree-sitter-make.wasm" },
  },
} satisfies LanguageAdapter;

const toml = {
  id: "toml",
  detect: {
    extensions: [".toml"],
  },
  grammar: {
    wasm: "tree-sitter-toml.wasm",
    vendor: { package: "@tree-sitter-grammars/tree-sitter-toml", file: "tree-sitter-toml.wasm" },
  },
  classifyComments: classifyTomlComments,
} satisfies LanguageAdapter;

const ADAPTERS = { bash, yaml, typescript, tsx, python, dockerfile, go, rust, sql, make, toml };

export type Language = keyof typeof ADAPTERS;

export const LANGUAGE_ADAPTERS: Readonly<Record<Language, LanguageAdapter>> = ADAPTERS;

export const LANGUAGES: readonly Language[] = Object.keys(ADAPTERS) as Language[];

export function languageForPath(filePath: string, firstLine?: string): Language | null {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();

  for (const lang of LANGUAGES) {
    const detect = LANGUAGE_ADAPTERS[lang].detect;
    if (detect.basenames?.includes(base)) return lang;
  }

  for (const lang of LANGUAGES) {
    const detect = LANGUAGE_ADAPTERS[lang].detect;
    if (detect.basenamePrefixes?.some(p => base.toLowerCase().startsWith(p.toLowerCase()))) return lang;
  }

  for (const lang of LANGUAGES) {
    const detect = LANGUAGE_ADAPTERS[lang].detect;
    if (detect.extensions.includes(ext)) return lang;
  }

  if (!ext && firstLine) {
    for (const lang of LANGUAGES) {
      const detect = LANGUAGE_ADAPTERS[lang].detect;
      if (detect.shebangInterpreters) {
        const regex = new RegExp(`^#!.*?\\b(${detect.shebangInterpreters.join("|")})\\b`);
        if (regex.test(firstLine)) return lang;
      }
    }
  }

  return null;
}
