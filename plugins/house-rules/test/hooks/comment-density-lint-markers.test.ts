/**
 * Pins per-language lint-tool marker scoping (LA-11 / ticket 11).
 *
 * Markers are recognised only in the language that owns them:
 *   typescript      eslint-disable/enable, prettier-ignore, biome-ignore,
 *                   triple-slash /// <reference, @ts-*, #__PURE__/@__PURE__,
 *                   @license/@preserve, istanbul/c8 ignore, webpackChunkName,
 *                   //# sourceMappingURL=; jsx variant covers .tsx/.jsx/.js
 *   python          noqa, type: ignore, pylint:, pragma: (coverage.py)
 *   bash            shellcheck
 *   yaml            yaml-language-server:
 * A marker from another toolchain is ordinary prose (counted, not exempt).
 *
 * Annotation tags (/^@\w/) are a comment-density policy exemption for every
 * language — they are not scoped to TypeScript.
 *
 * Each case: one snippet per marker, real parseable code, marker at a non-zero
 * row, and a plain narrative comment in the same snippet that must NOT be exempt.
 */
import { describe, it, expect } from "bun:test";
import { findComments, type GetParserFn } from "../../src/hooks/lib/comment-density.js";
import type { Language } from "../../src/hooks/languages/registry.js";
import { classifyComments, parseText, parserForPath } from "../../src/hooks/languages/parse.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TS = parserForPath(getParser, "sample.ts");

async function getComments(text: string, lang: Language, factory?: GetParserFn) {
  const r = await findComments(text, lang, factory);
  if (!r.ok) throw new Error(`findComments failed: ${r.reason}`);
  return r.comments;
}

async function getCommentsWithFactory(text: string, lang: Language, factory: GetParserFn) {
  const r = await findComments(text, lang, factory);
  if (!r.ok) throw new Error(`findComments failed: ${r.reason}`);
  return r.comments;
}

function byText(comments: Awaited<ReturnType<typeof getComments>>, text: string) {
  const found = comments.find(c => c.text === text);
  if (!found) {
    const all = comments.map(c => JSON.stringify(c.text)).join(", ");
    throw new Error(`Comment ${JSON.stringify(text)} not found. Have: [${all}]`);
  }
  return found;
}


type Row = [
  lang: Language,
  label: string,
  snippet: string,
  markerText: string,
  expectedExempt: boolean,
  expectedReason: string | undefined,
  plainText: string,
];

const CASES: Row[] = [
  // ---- Go (C-style // comments; noqa/eslint/pylint are foreign, counted) ----
  [
    "go",
    "go // noqa — foreign marker, counted",
    `package main\n\nfunc main() {\n\t// plain narrative\n\tx := 1 // noqa\n\t_ = x\n}`,
    "// noqa",
    false,
    undefined,
    "// plain narrative",
  ],
  [
    "go",
    "go // eslint-disable-line — foreign marker, counted",
    `package main\n\nfunc main() {\n\t// plain narrative\n\tx := 1 // eslint-disable-line\n\t_ = x\n}`,
    "// eslint-disable-line",
    false,
    undefined,
    "// plain narrative",
  ],
  [
    "go",
    "go // eslint-disable-next-line — foreign marker, counted",
    `package main\n\nfunc main() {\n\t// plain narrative\n\t// eslint-disable-next-line\n\tx := 1\n\t_ = x\n}`,
    "// eslint-disable-next-line",
    false,
    undefined,
    "// plain narrative",
  ],
  [
    "go",
    "go // pylint: disable=x — foreign marker, counted",
    `package main\n\nfunc main() {\n\t// plain narrative\n\tx := 1 // pylint: disable=x\n\t_ = x\n}`,
    "// pylint: disable=x",
    false,
    undefined,
    "// plain narrative",
  ],

  // ---- Go annotation tag (cross-language policy exemption) ----
  [
    "go",
    "go // @Summary x — annotation tag, policy-exempt in every language",
    `package main\n\nfunc main() {\n\t// plain narrative\n\tx := 1 // @Summary x\n\t_ = x\n}`,
    "// @Summary x",
    true,
    "@Summary x",
    "// plain narrative",
  ],

  // ---- TypeScript (native home of eslint-disable, prettier-ignore, biome-ignore, triple-slash) ----
  [
    "typescript",
    "ts // eslint-disable-next-line no-x",
    `// plain narrative\n// eslint-disable-next-line no-x\nconst b = 2;`,
    "// eslint-disable-next-line no-x",
    true,
    "eslint-disable-next-line no-x",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts /// <reference path=\"x.d.ts\" />",
    `// plain narrative\n/// <reference path="x.d.ts" />\nconst a = 1;`,
    `/// <reference path="x.d.ts" />`,
    true,
    `/ <reference path="x.d.ts" />`,
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // biome-ignore lint: x",
    `// plain narrative\n// biome-ignore lint: x\nconst b = 2;`,
    "// biome-ignore lint: x",
    true,
    "biome-ignore lint: x",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // prettier-ignore",
    `// plain narrative\n// prettier-ignore\nconst b = 2;`,
    "// prettier-ignore",
    true,
    "prettier-ignore",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // pragma: x — foreign marker, counted",
    `// plain narrative\n// pragma: x\nconst b = 2;`,
    "// pragma: x",
    false,
    undefined,
    "// plain narrative",
  ],

  // ---- Python (native home of noqa, type: ignore, pylint:) ----
  [
    "python",
    "py # noqa",
    `x = 1  # plain narrative\ny = x + 1  # noqa\nz = y`,
    "# noqa",
    true,
    "noqa",
    "# plain narrative",
  ],
  [
    "python",
    "py # type: ignore",
    `x = 1  # plain narrative\ny = x + 1  # type: ignore\nz = y`,
    "# type: ignore",
    true,
    "type: ignore",
    "# plain narrative",
  ],
  [
    "python",
    "py # pylint: disable=x",
    `x = 1  # plain narrative\ny = x + 1  # pylint: disable=x\nz = y`,
    "# pylint: disable=x",
    true,
    "pylint: disable=x",
    "# plain narrative",
  ],

  // ---- Bash (native home of shellcheck; noqa is "foreign") ----
  [
    "bash",
    "bash # shellcheck disable=SC2034",
    `#!/bin/bash\n# plain narrative\n# shellcheck disable=SC2034\nx=1`,
    "# shellcheck disable=SC2034",
    true,
    "shellcheck disable=SC2034",
    "# plain narrative",
  ],
  [
    "bash",
    "bash # noqa — foreign marker, counted",
    `#!/bin/bash\n# plain narrative\ny=2 # noqa`,
    "# noqa",
    false,
    undefined,
    "# plain narrative",
  ],

  // ---- YAML (native home of yaml-language-server:) ----
  [
    "yaml",
    "yaml # yaml-language-server: $schema=x.json",
    `key: value\n# yaml-language-server: $schema=x.json\n# plain narrative\nother: value`,
    "# yaml-language-server: $schema=x.json",
    true,
    // inner = "yaml-language-server: $schema=x.json" → first 30 chars
    "yaml-language-server: $schema=",
    "# plain narrative",
  ],

  // ---- TOML (noqa is foreign, counted) ----
  [
    "toml",
    "toml # noqa — foreign marker, counted",
    `[section]\n# noqa\n# plain narrative\nkey = "value"`,
    "# noqa",
    false,
    undefined,
    "# plain narrative",
  ],

  // ---- Dockerfile (noqa is foreign, counted) ----
  [
    "dockerfile",
    "dockerfile # noqa — foreign marker, counted",
    `FROM ubuntu:20.04\n# plain narrative\n# noqa\nRUN echo hello`,
    "# noqa",
    false,
    undefined,
    "# plain narrative",
  ],

  // ---- Make (noqa is foreign, counted) ----
  [
    "make",
    "make # noqa — foreign marker, counted",
    `# plain narrative\n# noqa\nall:\n\techo hello`,
    "# noqa",
    false,
    undefined,
    "# plain narrative",
  ],

  // ---- Rust (eslint-disable-next-line and noqa are both foreign, counted) ----
  [
    "rust",
    "rust // noqa — foreign marker, counted",
    `fn main() {\n    // plain narrative\n    let x = 1; // noqa\n    let _ = x;\n}`,
    "// noqa",
    false,
    undefined,
    "// plain narrative",
  ],
  [
    "rust",
    "rust // eslint-disable-next-line x — foreign marker, counted",
    `fn main() {\n    // plain narrative\n    // eslint-disable-next-line x\n    let x = 1;\n    let _ = x;\n}`,
    "// eslint-disable-next-line x",
    false,
    undefined,
    "// plain narrative",
  ],

  // ---- TypeScript (noqa is foreign, counted; covers .tsx/.js via jsx grammar in standalone test) ----
  [
    "typescript",
    "typescript // noqa — foreign marker, counted",
    `// plain narrative\nconst a = 1; // noqa\nexport default a;`,
    "// noqa",
    false,
    undefined,
    "// plain narrative",
  ],

  // ---- TypeScript new markers (wave-2 TYPESCRIPT_TOOL_MARKERS) ----
  [
    "typescript",
    "ts // @ts-ignore",
    `// plain narrative\n// @ts-ignore\nconst x: string = 1 as unknown as string;`,
    "// @ts-ignore",
    true,
    "@ts-ignore",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // @ts-expect-error",
    `// plain narrative\n// @ts-expect-error\nconst x: string = 1 as unknown as string;`,
    "// @ts-expect-error",
    true,
    "@ts-expect-error",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // @ts-nocheck",
    `const x = 1;\n// @ts-nocheck\n// plain narrative`,
    "// @ts-nocheck",
    true,
    "@ts-nocheck",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // @ts-check",
    `const x = 1;\n// @ts-check\n// plain narrative`,
    "// @ts-check",
    true,
    "@ts-check",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts /*#__PURE__*/",
    `// plain narrative\nconst fn = /*#__PURE__*/ (() => 1);`,
    "/*#__PURE__*/",
    true,
    "#__PURE__",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts /*@__PURE__*/",
    `// plain narrative\nconst fn = /*@__PURE__*/ (() => 1);`,
    "/*@__PURE__*/",
    true,
    "@__PURE__",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // @license MIT",
    `const x = 1;\n// plain narrative\n// @license MIT`,
    "// @license MIT",
    true,
    "@license MIT",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // @preserve",
    `const x = 1;\n// plain narrative\n// @preserve`,
    "// @preserve",
    true,
    "@preserve",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // istanbul ignore next",
    `// plain narrative\n// istanbul ignore next\nconst x = 1;`,
    "// istanbul ignore next",
    true,
    "istanbul ignore next",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts // c8 ignore next",
    `// plain narrative\n// c8 ignore next\nconst x = 1;`,
    "// c8 ignore next",
    true,
    "c8 ignore next",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts /* webpackChunkName */",
    `// plain narrative\nconst m = import(/* webpackChunkName: "chunk" */ "./mod");`,
    `/* webpackChunkName: "chunk" */`,
    true,
    `webpackChunkName: "chunk"`,
    "// plain narrative",
  ],
  [
    "typescript",
    "ts //# sourceMappingURL=",
    `// plain narrative\nconst x = 1;\n//# sourceMappingURL=bundle.js.map`,
    "//# sourceMappingURL=bundle.js.map",
    true,
    "# sourceMappingURL=bundle.js.m",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts /*! banner */ — license-banner",
    `// plain narrative\n/*! Copyright 2024 Acme Corp */\nconst x = 1;`,
    "/*! Copyright 2024 Acme Corp */",
    true,
    "license-banner",
    "// plain narrative",
  ],

  // ---- TypeScript block-comment every-line rule cases ----
  [
    "typescript",
    "ts block /* eslint+prose */ — NOT directive (every-line rule pins this)",
    `// plain narrative\nconst x = 1;\n/* eslint-disable no-x\n * long prose line\n */`,
    "/* eslint-disable no-x\n * long prose line\n */",
    false,
    undefined,
    "// plain narrative",
  ],
  [
    "typescript",
    "ts block /* eslint-a + eslint-b */ — directive (all lines match)",
    `// plain narrative\nconst x = 1;\n/* eslint-disable a\n * eslint-disable b */`,
    "/* eslint-disable a\n * eslint-disable b */",
    true,
    "eslint-disable a",
    "// plain narrative",
  ],
  [
    "typescript",
    "ts block /* @license + prose */ — directive (@license exception)",
    `// plain narrative\nconst x = 1;\n/*\n * @license MIT\n * Copyright prose\n */`,
    "/*\n * @license MIT\n * Copyright prose\n */",
    true,
    "@license MIT",
    "// plain narrative",
  ],

  [
    "sql",
    "sql /* eslint-disable */ — foreign marker, counted",
    `-- plain narrative\n/* eslint-disable */\nSELECT 1; -- noqa`,
    "/* eslint-disable */",
    false,
    undefined,
    "-- plain narrative",
  ],
  [
    "sql",
    "sql -- noqa — noqa is python-only, -- prefix not stripped",
    `-- plain narrative\n/* eslint-disable */\nSELECT 1; -- noqa`,
    "-- noqa",
    false,
    undefined,
    "-- plain narrative",
  ],
];

// ---------------------------------------------------------------------------
// Main marker assertion suite
// ---------------------------------------------------------------------------

describe("lint-tool marker exemptions — per-language scoping (LA-11 pin)", () => {
  it.each(CASES)(
    "%s %s — marker exempt=%s reason=%s",
    async (lang, _label, snippet, markerText, expectedExempt, expectedReason) => {
      const factory = lang === "typescript" ? TS : undefined;
      const comments = await getComments(snippet, lang, factory);
      const marker = byText(comments, markerText);
      expect(marker.exempt).toBe(expectedExempt);
      expect(marker.exemptReason).toBe(expectedReason);
    },
  );

  it.each(CASES)(
    "%s %s — plain narrative is NOT exempt",
    async (lang, _label, snippet, _marker, _exempt, _reason, plainText) => {
      const factory = lang === "typescript" ? TS : undefined;
      const comments = await getComments(snippet, lang, factory);
      const plain = byText(comments, plainText);
      expect(plain.exempt).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// AC2 directive classification
// ---------------------------------------------------------------------------

async function getClassified(text: string, lang: Language, factory?: GetParserFn) {
  const r = await parseText(text, lang, factory ?? getParser);
  if (!r.ok) throw new Error(`parseText failed: ${r.reason}`);
  return classifyComments(r.tree.rootNode, text, lang);
}

function byClassifiedText(comments: ReturnType<typeof classifyComments>, text: string) {
  const found = comments.find(c => c.text === text);
  if (!found) {
    const all = comments.map(c => JSON.stringify(c.text)).join(", ");
    throw new Error(`Comment ${JSON.stringify(text)} not found in classified output. Have: [${all}]`);
  }
  return found;
}

describe("AC2 directive classification (LA-11)", () => {
  it("python # noqa is a directive with label noqa", async () => {
    const text = `x = 1  # plain narrative\ny = x + 1  # noqa\nz = y`;
    const comments = await getClassified(text, "python");
    const c = byClassifiedText(comments, "# noqa");
    expect(c.directive).toBe(true);
    expect(c.label).toBe("noqa");
  });

  it("typescript // eslint-disable-next-line no-x is a directive", async () => {
    const text = `// plain narrative\n// eslint-disable-next-line no-x\nconst b = 2;`;
    const comments = await getClassified(text, "typescript", TS);
    const c = byClassifiedText(comments, "// eslint-disable-next-line no-x");
    expect(c.directive).toBe(true);
    expect(c.label).toBe("eslint-disable-next-line no-x");
  });

  it("go // eslint-disable-next-line is not a directive (foreign marker)", async () => {
    const text = `package main\n\nfunc main() {\n\t// plain narrative\n\t// eslint-disable-next-line\n\tx := 1\n\t_ = x\n}`;
    const comments = await getClassified(text, "go");
    const c = byClassifiedText(comments, "// eslint-disable-next-line");
    expect(c.directive).toBe(false);
    expect(c.label).toBeUndefined();
  });

  it("go // noqa is not a directive (foreign marker)", async () => {
    const text = `package main\n\nfunc main() {\n\t// plain narrative\n\tx := 1 // noqa\n\t_ = x\n}`;
    const comments = await getClassified(text, "go");
    const c = byClassifiedText(comments, "// noqa");
    expect(c.directive).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TypeScript jsx grammar (.tsx/.jsx/.js) — noqa is foreign, counted
// ---------------------------------------------------------------------------

describe("typescript jsx grammar — noqa foreign (LA-11)", () => {
  const jsxFactory = parserForPath(getParser, "x.tsx");

  it("typescript (jsx grammar) // noqa — not exempt, not directive", async () => {
    const text = `// plain narrative\nconst a = 1; // noqa\nexport default a;`;
    const comments = await getCommentsWithFactory(text, "typescript", jsxFactory);
    const noqa = byText(comments, "// noqa");
    expect(noqa.exempt).toBe(false);
    expect(noqa.exemptReason).toBeUndefined();
    const plain = byText(comments, "// plain narrative");
    expect(plain.exempt).toBe(false);
  });
});
