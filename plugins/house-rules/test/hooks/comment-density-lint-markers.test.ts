/**
 * Pins lint-tool marker exemptions (AC5 of LA-05).
 *
 * The shared isExemptInner list in src/hooks/lib/comment-density.ts applies to
 * every language. Ticket 11 will scope markers per language; this file must
 * produce a visible diff when that happens.
 *
 * Each case: one snippet per marker, containing real parseable code, with the
 * marker comment at a non-zero row and a plain narrative comment in the same
 * snippet that must NOT be exempt.
 */
import { describe, it, expect } from "bun:test";
import { findComments } from "../../src/hooks/lib/comment-density.js";
import type { Language } from "../../src/hooks/languages/registry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getComments(text: string, lang: Language) {
  const r = await findComments(text, lang);
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
  // ---- Go (C-style // comments; noqa is "foreign" to Go but shared list applies) ----
  [
    "go",
    "go // noqa",
    `package main\n\nfunc main() {\n\t// plain narrative\n\tx := 1 // noqa\n\t_ = x\n}`,
    "// noqa",
    true,
    "noqa",
    "// plain narrative",
  ],
  [
    "go",
    "go // eslint-disable-line",
    `package main\n\nfunc main() {\n\t// plain narrative\n\tx := 1 // eslint-disable-line\n\t_ = x\n}`,
    "// eslint-disable-line",
    true,
    "eslint-disable-line",
    "// plain narrative",
  ],
  [
    "go",
    "go // pylint: disable=x",
    `package main\n\nfunc main() {\n\t// plain narrative\n\tx := 1 // pylint: disable=x\n\t_ = x\n}`,
    "// pylint: disable=x",
    true,
    "pylint: disable=x",
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
    "ts // pragma: x",
    `// plain narrative\n// pragma: x\nconst b = 2;`,
    "// pragma: x",
    true,
    "pragma: x",
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
    "bash # noqa (foreign marker, shared list applies)",
    `#!/bin/bash\n# plain narrative\ny=2 # noqa`,
    "# noqa",
    true,
    "noqa",
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

  // ---- TOML (noqa is foreign; shared list applies) ----
  [
    "toml",
    "toml # noqa",
    `[section]\n# noqa\n# plain narrative\nkey = "value"`,
    "# noqa",
    true,
    "noqa",
    "# plain narrative",
  ],

  // ---- Dockerfile (noqa is foreign; shared list applies) ----
  [
    "dockerfile",
    "dockerfile # noqa (after FROM line)",
    `FROM ubuntu:20.04\n# plain narrative\n# noqa\nRUN echo hello`,
    "# noqa",
    true,
    "noqa",
    "# plain narrative",
  ],

  // ---- Make (noqa is foreign; shared list applies) ----
  [
    "make",
    "make # noqa",
    `# plain narrative\n# noqa\nall:\n\techo hello`,
    "# noqa",
    true,
    "noqa",
    "# plain narrative",
  ],

  // ---- Rust (eslint-disable-next-line, noqa are both foreign; shared list applies) ----
  [
    "rust",
    "rust // noqa",
    `fn main() {\n    // plain narrative\n    let x = 1; // noqa\n    let _ = x;\n}`,
    "// noqa",
    true,
    "noqa",
    "// plain narrative",
  ],
  [
    "rust",
    "rust // eslint-disable-next-line x",
    `fn main() {\n    // plain narrative\n    // eslint-disable-next-line x\n    let x = 1;\n    let _ = x;\n}`,
    "// eslint-disable-next-line x",
    true,
    "eslint-disable-next-line x",
    "// plain narrative",
  ],

  // ---- TSX (noqa is foreign; shared list applies) ----
  [
    "tsx",
    "tsx // noqa",
    `// plain narrative\nconst a = 1; // noqa\nexport default a;`,
    "// noqa",
    true,
    "noqa",
    "// plain narrative",
  ],

  [
    "sql",
    "sql /* eslint-disable */",
    `-- plain narrative\n/* eslint-disable */\nSELECT 1; -- noqa`,
    "/* eslint-disable */",
    true,
    "eslint-disable",
    "-- plain narrative",
  ],
  [
    "sql",
    "sql -- noqa (NOT exempt: -- prefix not stripped by commentInnerText)",
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

describe("lint-tool marker exemptions (LA-05 AC5 pin)", () => {
  it.each(CASES)(
    "%s %s — marker exempt=%s reason=%s",
    async (lang, _label, snippet, markerText, expectedExempt, expectedReason) => {
      const comments = await getComments(snippet, lang);
      const marker = byText(comments, markerText);
      expect(marker.exempt).toBe(expectedExempt);
      expect(marker.exemptReason).toBe(expectedReason);
    },
  );

  it.each(CASES)(
    "%s %s — plain narrative is NOT exempt",
    async (lang, _label, snippet, _marker, _exempt, _reason, plainText) => {
      const comments = await getComments(snippet, lang);
      const plain = byText(comments, plainText);
      expect(plain.exempt).toBe(false);
    },
  );
});
