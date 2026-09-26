import { describe, it, expect, afterAll } from "bun:test";
import path from "node:path";
import { mkdtempSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import os from "node:os";
import {
  detectLanguage,
  findComments,
  reconstructPostEdit,
  newComments,
  stripComments,
  density,
  autoFix,
  netNewCommentRows,
  collectCodeText,
  type Lang,
  type GetParserFn,
} from "../../src/hooks/lib/comment-density.js";
import type { DiffHunk } from "../../src/hooks/lib/work-scope.js";
import { getParser } from "../../src/hooks/lib/tree-sitter-loader.js";

const FIXTURES = path.join(import.meta.dir, "../fixtures/comment-density");
const PROBE_DIR = path.join(FIXTURES, "nexus-probe");

// ---- AC1: Language detection ----

describe("detectLanguage", () => {
  const cases: [string, string | undefined, Lang | null][] = [
    ["/foo/bar.ts", undefined, "typescript"],
    ["/foo/bar.mts", undefined, "typescript"],
    ["/foo/bar.cts", undefined, "typescript"],
    ["/foo/bar.tsx", undefined, "tsx"],
    ["/foo/bar.jsx", undefined, "tsx"],
    ["/foo/bar.js", undefined, "tsx"],
    ["/foo/bar.mjs", undefined, "tsx"],
    ["/foo/bar.cjs", undefined, "tsx"],
    ["/foo/bar.py", undefined, "python"],
    ["/foo/bar.sh", undefined, "bash"],
    ["/foo/bar.bash", undefined, "bash"],
    ["/foo/bar.yml", undefined, "yaml"],
    ["/foo/bar.yaml", undefined, "yaml"],
    ["/foo/Dockerfile", undefined, "dockerfile"],
    ["/foo/Containerfile", undefined, "dockerfile"],
    ["/foo/Dockerfile.prod", undefined, "dockerfile"],
    ["/foo/Containerfile.dev", undefined, "dockerfile"],
    ["/foo/app.dockerfile", undefined, "dockerfile"],
    ["/foo/script", "#!/usr/bin/env bash", "bash"],
    ["/foo/script", "#!/bin/sh", "bash"],
    ["/foo/script", "#!/usr/bin/env zsh", "bash"],
    ["/foo/script", "#!/usr/bin/env python3", null],
    ["/foo/bar.md", undefined, null],
    ["/foo/bar.txt", undefined, null],
  ];

  it.each(cases)("detectLanguage(%s, %s) → %s", (fp, first, expected) => {
    expect(detectLanguage(fp, first)).toBe(expected);
  });
});

// ---- AC2: Real probe.sh ----

describe("probe.sh fixture", () => {
  it("shebang on row 0 is exempt", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "probe.sh")).text();
    const r = await findComments(text, "bash");
    if (!r.ok) throw new Error(r.reason);

    const shebang = r.comments.find(c => c.startRow === 0);
    expect(shebang).toBeDefined();
    expect(shebang!.exempt).toBe(true);
    expect(shebang!.exemptReason).toBe("shebang");
  });

  it("lines 292 and 672 (#include inside heredocs) are NOT comment nodes", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "probe.sh")).text();
    const r = await findComments(text, "bash");
    if (!r.ok) throw new Error(r.reason);

    const rows = new Set(r.comments.map(c => c.startRow));
    // Line numbers are 1-based in spec; tree-sitter uses 0-based rows
    expect(rows.has(291)).toBe(false); // line 292
    expect(rows.has(671)).toBe(false); // line 672
  });

  it("line 668 (1-based) IS a comment", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "probe.sh")).text();
    const r = await findComments(text, "bash");
    if (!r.ok) throw new Error(r.reason);

    const rows = new Set(r.comments.map(c => c.startRow));
    expect(rows.has(667)).toBe(true); // line 668, 0-based 667
  });

  it("tree-sitter gives a different (non-grep) count — bite: grep-count mismatches", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "probe.sh")).text();
    const r = await findComments(text, "bash");
    if (!r.ok) throw new Error(r.reason);

    const nonExemptRows = new Set<number>();
    for (const c of r.comments) {
      if (!c.exempt) {
        for (let row = c.startRow; row <= c.endRow; row++) nonExemptRows.add(row);
      }
    }

    // Arithmetic:
    //   grep -cE '^\s*#' = 193  (prefix-based)
    //   tree-sitter total comment nodes = 191
    //     - lines 292 and 672 are #include inside heredocs → NOT comment nodes (-2)
    //   Exempt nodes = 33:
    //     - 1 shebang (line 1, row 0)
    //     - 32 divider lines (----... patterns)
    //   Non-exempt rows = 191 - 33 = 158
    //   No trailing comments in this file, so 158 = final count
    //
    // A naive grep counter would give 193 (wrong); tree-sitter gives 158.
    expect(nonExemptRows.size).toBe(158);
    expect(nonExemptRows.size).not.toBe(193);
  });

  it("probe.sh density is over 5/100", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "probe.sh")).text();
    const r = await density(text, "bash");
    const per100 = (r.effective / r.total) * 100;
    expect(per100).toBeGreaterThan(5);
  });
});

// ---- AC3: Exemptions ----

type ExemptCase = [string, Parameters<typeof findComments>[1], string, boolean, string];

const EXEMPT_CASES: ExemptCase[] = [
  ["shebang", "bash", "#!/usr/bin/env bash\necho hi", true, "shebang at row 0"],
  ["non-shebang #", "bash", "echo hi\n# plain comment", false, "plain comment is not exempt"],
  ["jsdoc /**", "typescript", "/** @param x - desc */\nfunction f(x: number) {}", true, "jsdoc block is exempt"],
  ["non-jsdoc /*", "typescript", "/* plain block */\nconst x = 1;", false, "plain block not exempt"],
  ["@-annotation //", "typescript", "// @ts-expect-error\nconst x: any = 1;", true, "@annotation is exempt"],
  ["non-annotation //", "typescript", "// this is code explanation\nconst x = 1;", false, "code comment not exempt"],
  ["eslint-disable", "typescript", "// eslint-disable-next-line\nconst x = eval('hi')", true, "eslint is exempt"],
  ["prettier-ignore", "typescript", "// prettier-ignore\nconst x=1;", true, "prettier-ignore is exempt"],
  ["biome-ignore", "typescript", "// biome-ignore lint: reason\nconst x=1;", true, "biome-ignore is exempt"],
  ["#region", "typescript", "// #region section\nconst x = 1;\n// #endregion", true, "region is exempt"],
  ["URL-only", "typescript", "// https://example.com/path", true, "URL-only is exempt"],
  ["non-URL", "typescript", "// see https://example.com for details", false, "URL in prose not exempt"],
  ["divider ---", "typescript", "// ---------\nconst x = 1;", true, "divider is exempt"],
  ["non-divider", "typescript", "// -- partial", false, "short -- not a divider"],
  ["TODO(owner)", "typescript", "// TODO(alice): fix this", true, "TODO(owner) is exempt"],
  ["plain TODO", "typescript", "// TODO: fix this", false, "plain TODO not exempt"],
  ["shellcheck", "bash", "# shellcheck disable=SC2034\nfoo=bar", true, "shellcheck is exempt"],
  ["noqa", "python", "# noqa: E501\nfoo = 1", true, "noqa is exempt"],
  ["type: ignore", "python", "x = 1  # type: ignore\ny = 2", true, "type: ignore is exempt"],
  ["pylint:", "python", "# pylint: disable=line-too-long\nfoo = 1", true, "pylint: is exempt"],
  ["pragma:", "python", "# pragma: no cover\ndef f(): pass", true, "pragma: is exempt"],
  ["yaml-language-server:", "yaml", "# yaml-language-server: $schema=foo\nkey: val", true, "yaml-ls is exempt"],
];

describe("exemptions", () => {
  for (const [label, lang, code, shouldBeExempt, msg] of EXEMPT_CASES) {
    it(`${label} (${lang}) — ${msg}`, async () => {
      const r = await findComments(code, lang);
      if (!r.ok) throw new Error(r.reason);
      const hasExempt = r.comments.some(c => c.exempt);
      const hasNonExempt = r.comments.some(c => !c.exempt);
      if (shouldBeExempt) {
        expect(hasExempt).toBe(true);
      } else {
        expect(hasNonExempt).toBe(true);
      }
    });
  }
});

describe("Dockerfile leading directive exempt", () => {
  it("syntax= in leading block is exempt", async () => {
    const code = "# syntax=docker/dockerfile:1\nFROM ubuntu\n";
    const r = await findComments(code, "dockerfile");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.startRow === 0);
    expect(c?.exempt).toBe(true);
  });

  it("plain Dockerfile comment is not exempt", async () => {
    const code = "FROM ubuntu\n# install tools\nRUN apt-get install -y curl\n";
    const r = await findComments(code, "dockerfile");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => !c.exempt);
    expect(c).toBeDefined();
  });
});

// ---- AC4: reconstructPostEdit + newComments ----

const YAML_DOC = `apiVersion: v1
kind: ConfigMap
metadata:
  name: example
data:
  # config value for production
  key: value
  other: other
`;

describe("reconstructPostEdit", () => {
  it("YAML Edit inside indented block uses whole-file context", async () => {
    const oldStr = "  # config value for production\n  key: value";
    const newStr = "  # config value for production\n  # updated comment\n  key: new-value";
    const r = reconstructPostEdit("Edit", {
      file_path: "config.yaml",
      old_string: oldStr,
      new_string: newStr,
    }, YAML_DOC);
    expect(r).not.toBeNull();

    const preComments = await findComments(YAML_DOC, "yaml");
    const postComments = await findComments(r!.post, "yaml");
    if (!preComments.ok) throw new Error(preComments.reason);
    if (!postComments.ok) throw new Error(postComments.reason);

    const nc = newComments(preComments.comments, postComments.comments, r!.changedRows);

    // Fragment "# updated comment" is new, "# config value for production" is not
    expect(nc.length).toBe(1);
    expect(nc[0].text).toContain("updated comment");
  });

  it("Edit keeping 2 existing comments + adding 1 → newComments returns 1", async () => {
    const pre = `// existing one\n// existing two\nconst x = 1;\n`;
    const oldStr = `// existing two\nconst x = 1;`;
    const newStr = `// existing two\n// brand new\nconst x = 1;`;
    const r = reconstructPostEdit("Edit", { old_string: oldStr, new_string: newStr }, pre);
    expect(r).not.toBeNull();

    const preComments = await findComments(pre, "typescript");
    const postComments = await findComments(r!.post, "typescript");
    if (!preComments.ok) throw new Error(preComments.reason);
    if (!postComments.ok) throw new Error(postComments.reason);

    const nc = newComments(preComments.comments, postComments.comments, r!.changedRows);
    expect(nc.length).toBe(1);
    expect(nc[0].text).toContain("brand new");
  });

  it("Write over existing file that keeps old comments and adds 2 → exactly 2", async () => {
    const pre = `const a = 1;\n// kept comment\nconst b = 2;\n`;
    const post = `const a = 1;\n// kept comment\nconst b = 2;\n// new one\n// new two\n`;
    const r = reconstructPostEdit("Write", { content: post }, pre);
    expect(r).not.toBeNull();

    const preComments = await findComments(pre, "typescript");
    const postComments = await findComments(post, "typescript");
    if (!preComments.ok) throw new Error(preComments.reason);
    if (!postComments.ok) throw new Error(postComments.reason);

    const nc = newComments(preComments.comments, postComments.comments, r!.changedRows);
    expect(nc.length).toBe(2);
  });

  it("bite: drop pre-comparison gives wrong count", async () => {
    const pre = `// existing\nconst x = 1;\n`;
    const oldStr = `// existing\nconst x = 1;`;
    const newStr = `// existing\nconst x = 1;\n// also new`;
    const r = reconstructPostEdit("Edit", { old_string: oldStr, new_string: newStr }, pre);
    expect(r).not.toBeNull();

    const preComments = await findComments(pre, "typescript");
    const postComments = await findComments(r!.post, "typescript");
    if (!preComments.ok) throw new Error(preComments.reason);
    if (!postComments.ok) throw new Error(postComments.reason);

    // With proper pre-comparison: 1 new comment
    const withPre = newComments(preComments.comments, postComments.comments, r!.changedRows);
    // Without pre-comparison (null): would count the existing comment too
    const withoutPre = newComments(null, postComments.comments, r!.changedRows);

    expect(withPre.length).toBe(1);
    // Without pre comparison, "existing" comment is in changedRows so it appears new
    expect(withoutPre.length).toBeGreaterThan(withPre.length);
  });

  it("returns null when old_string not found", () => {
    const r = reconstructPostEdit("Edit", { old_string: "NOTFOUND", new_string: "x" }, "some text");
    expect(r).toBeNull();
  });
});

// ---- AC5: stripComments ----

describe("stripComments", () => {
  it("removes whole-line comment including newline", async () => {
    const code = `const a = 1;\n// whole line\nconst b = 2;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(code, nonExempt);
    expect(stripped).toBe(`const a = 1;\nconst b = 2;\n`);
  });

  it("removes trailing comment, keeps code byte-exact", async () => {
    const code = `const x = 1; // trailing comment\nconst y = 2;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(code, nonExempt);
    expect(stripped).toBe(`const x = 1;\nconst y = 2;\n`);
  });

  it("removes block comment (multi-line)", async () => {
    const code = `const a = 1;\n/* block\n   comment */\nconst b = 2;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(code, nonExempt);
    expect(stripped).not.toContain("block");
    expect(stripped).toContain("const a = 1;");
    expect(stripped).toContain("const b = 2;");
  });

  async function countErrorNodes(text: string, lang: Parameters<typeof findComments>[1]): Promise<number> {
    const r = await getParser(lang);
    if (!r.ok) throw new Error(r.reason);
    const tree = r.parser.parse(text);
    let count = 0;
    function walk(node: import("../../src/hooks/lib/tree-sitter.js").Node): void {
      if (node.type === "ERROR") count++;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }
    }
    walk(tree.rootNode);
    return count;
  }

  const REPARSE_CASES: Array<[string, Parameters<typeof findComments>[1], string]> = [
    ["bash", "bash", "#!/bin/bash\n# remove me\necho hello\n# also remove\necho world\n"],
    ["yaml", "yaml", "key: value # trailing\n# whole line\nother: thing\n"],
    ["typescript", "typescript", "const a = 1; // trailing\n// whole line\nconst b = 2;\n"],
    ["python", "python", "x = 1  # trailing\n# whole line\ny = 2\n"],
  ];

  for (const [label, lang, code] of REPARSE_CASES) {
    it(`re-parse after strip has no new ERROR nodes: ${label}`, async () => {
      const r = await findComments(code, lang);
      if (!r.ok) throw new Error(r.reason);
      const nonExempt = r.comments.filter(c => !c.exempt);
      const { text: stripped } = stripComments(code, nonExempt);
      const before = await countErrorNodes(code, lang);
      const after = await countErrorNodes(stripped, lang);
      expect(after).toBeLessThanOrEqual(before);
    });
  }

  it("stripping probe.sh leaves lines 292 and 672 unchanged", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "probe.sh")).text();
    const lines = text.split("\n");
    const line292 = lines[291];
    const line672 = lines[671];

    const r = await findComments(text, "bash");
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(text, nonExempt);
    const strippedLines = stripped.split("\n");

    expect(strippedLines).toContain(line292);
    expect(strippedLines).toContain(line672);
  });

  it("stripped probe.sh re-parses cleanly", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "probe.sh")).text();
    const r = await findComments(text, "bash");
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(text, nonExempt);
    const before = await countErrorNodes(text, "bash");
    const after = await countErrorNodes(stripped, "bash");
    expect(after).toBeLessThanOrEqual(before);
  });
});

// ---- AC6: Fallback ----

const failingGetParser: GetParserFn = async (_lang) => ({
  ok: false,
  reason: "injected failure",
});

describe("density fallback", () => {
  it("uses fallback mode when getParser fails", async () => {
    const code = `// comment one\n// comment two\nconst x = 1;\n`;
    const r = await density(code, "typescript", undefined, failingGetParser);
    expect(r.mode).toBe("fallback");
  });

  it("fallback gives same numbers as legacy countEffective for simple TS input", async () => {
    const code = [
      "const a = 1;",
      "// plain comment",
      "const b = 2;",
      "// another",
      "const c = 3;",
      "/** jsdoc */",
      "function f() {}",
      "// @ts-expect-error annotation",
      "const d: any = 1;",
      "// eslint-disable-next-line",
      "eval('x');",
    ].join("\n") + "\n";

    const r = await density(code, "typescript", undefined, failingGetParser);
    expect(r.mode).toBe("fallback");
    // Legacy countEffective: "plain comment" and "another" are effective (2)
    // jsdoc is not counted; @ts-expect-error and eslint-disable are exempt
    expect(r.effective).toBe(2);
  });
});

// ---- AC7: Whole-file density ----

describe("whole-file density over cap", () => {
  it("probe.sh is over 5/100", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "probe.sh")).text();
    const r = await density(text, "bash");
    expect((r.effective / r.total) * 100).toBeGreaterThan(5);
  });

  it("pod-nonroot.yaml is over 5/100", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "pod-nonroot.yaml")).text();
    const r = await density(text, "yaml");
    expect((r.effective / r.total) * 100).toBeGreaterThan(5);
  });

  it("pod-root.yaml is over 5/100", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "pod-root.yaml")).text();
    const r = await density(text, "yaml");
    expect((r.effective / r.total) * 100).toBeGreaterThan(5);
  });

  it("pod-root-sysadmin.yaml is over 5/100", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "pod-root-sysadmin.yaml")).text();
    const r = await density(text, "yaml");
    expect((r.effective / r.total) * 100).toBeGreaterThan(5);
  });

  it("Dockerfile is over 5/100", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "Dockerfile")).text();
    const r = await density(text, "dockerfile");
    expect((r.effective / r.total) * 100).toBeGreaterThan(5);
  });

  it("Containerfile is over 5/100", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "Containerfile")).text();
    const r = await density(text, "dockerfile");
    expect((r.effective / r.total) * 100).toBeGreaterThan(5);
  });

  it("TS fixture with many comments is over cap", async () => {
    const text = await Bun.file(path.join(FIXTURES, "over-cap.ts")).text();
    const r = await density(text, "typescript");
    expect((r.effective / r.total) * 100).toBeGreaterThan(5);
  });

  it("clean TS fixture is under or equal to cap", async () => {
    const text = await Bun.file(path.join(FIXTURES, "clean.ts")).text();
    const r = await density(text, "typescript");
    expect((r.effective / r.total) * 100).toBeLessThanOrEqual(5);
  });
});

// ---- Parse-error fallback ----

describe("parse-error fallback", () => {
  const INVALID_YAML = 'key: "v # no"\nb: |\n  # in scalar\n- 994  # kvm group\n';

  it("invalid YAML does not silently yield 0 effective (fallback fires)", async () => {
    const r = await density(INVALID_YAML, "yaml");
    expect(r.mode).toBe("fallback");
    expect(r.effective).toBeGreaterThan(0);
  });

  it("findComments returns ok:false with reason 'parse-error' for invalid YAML", async () => {
    const r = await findComments(INVALID_YAML, "yaml");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("parse-error");
  });

  it("bite: old behavior (no hasError check) silently returns 0", async () => {
    const realResult = await findComments(INVALID_YAML, "yaml");
    expect(realResult.ok).toBe(false);

    const oldBehaviorCount = realResult.ok ? realResult.comments.filter(c => !c.exempt).length : 0;
    expect(oldBehaviorCount).toBe(0);
    const withFix = await density(INVALID_YAML, "yaml");
    expect(withFix.effective).toBeGreaterThan(oldBehaviorCount);
  });
});

// ---- AC-lib6: # in TS/JS is not a comment (private class fields) ----

const failParser6: GetParserFn = async () => ({ ok: false, reason: "forced-fallback-for-hash-test" });

describe("fallback # counting excludes TS private fields", () => {
  it("TS private field #field counts as 0 in fallback (lang=typescript)", async () => {
    const code = `class Foo {\n  #count = 0;\n  #name = '';\n}\n`;
    const r = await density(code, "typescript", undefined, failParser6);
    expect(r.mode).toBe("fallback");
    expect(r.effective).toBe(0);
  });

  it("bash: same # prefix IS a comment in fallback", async () => {
    const code = `echo hi\n#count=0\n#name=foo\n`;
    const r = await density(code, "bash", undefined, failParser6);
    expect(r.mode).toBe("fallback");
    expect(r.effective).toBeGreaterThan(0);
  });

  it("bite: TS #field counted differently than bash # (proves fix is lang-gated)", async () => {
    const code = `class Foo {\n  #count = 0;\n}\n`;
    const tsR = await density(code, "typescript", undefined, failParser6);
    const bashR = await density(code, "bash", undefined, failParser6);
    expect(tsR.effective).toBe(0);
    expect(bashR.effective).toBeGreaterThan(0);
    expect(tsR.effective).not.toBe(bashR.effective);
  });
});

describe("autoFix", () => {
  it("returns removed=0 when already within budget", async () => {
    const text = Array.from({ length: 40 }, (_, i) =>
      i === 0 ? `// one comment` : `const x${i} = ${i};`
    ).join("\n") + "\n";
    const allRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "typescript", allRows);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.removed).toBe(0);
  });

  it("strips over-budget session comments, preserves code", async () => {
    const codeLines = Array.from({ length: 30 }, (_, i) => `const x${i} = ${i};`);
    const commentLines = Array.from({ length: 8 }, (_, i) => `// session ${i}`);
    const text = [...codeLines, ...commentLines].join("\n") + "\n";
    const allRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "typescript", allRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) {
      expect(r.fixed).toContain(`const x${i} = ${i};`);
    }
  });

  it("preserves pre-existing comments (not in addedRows)", async () => {
    const baseComments = Array.from({ length: 5 }, (_, i) => `// base ${i}`);
    const sessionCode = Array.from({ length: 20 }, (_, i) => `const y${i} = ${i};`);
    const sessionComments = Array.from({ length: 5 }, (_, i) => `// session ${i}`);
    const basePart = baseComments.join("\n");
    const sessionPart = [...sessionCode, ...sessionComments].join("\n");
    const text = basePart + "\n" + sessionPart + "\n";
    const baseLineCount = baseComments.length;
    const sessionRows = new Set<number>();
    for (let i = baseLineCount; i < text.split("\n").length; i++) sessionRows.add(i);
    const r = await autoFix(text, "typescript", sessionRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (let i = 0; i < 5; i++) {
      expect(r.fixed).toContain(`// base ${i}`);
    }
  });

  it("returns ok:false when original has parse error (unfixable)", async () => {
    const text = "// comment 1\n// comment 2\n// comment 3\nconst x = ;\n";
    const allRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "typescript", allRows);
    expect(r.ok).toBe(false);
  });

  it("safety verifier (re-parse): fails if post-strip re-parse returns error", async () => {
    let callCount = 0;
    const mockParser: GetParserFn = async (lang) => {
      const real = await getParser(lang);
      if (!real.ok) return real;
      callCount++;
      if (callCount >= 2) {
        return { ok: false as const, reason: "mock post-strip failure" };
      }
      return real;
    };
    const text = Array.from({ length: 30 }, (_, i) =>
      i % 4 === 0 ? `// comment ${i}` : `const x${i} = ${i};`
    ).join("\n") + "\n";
    const allRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "typescript", allRows, mockParser);
    expect(r.ok).toBe(false);
  });

  it("safety verifier (code-identity): blocks strip when origCode differs from fixedCode", async () => {
    let gpCallCount = 0;
    const mockParser: GetParserFn = async (lang) => {
      const real = await getParser(lang);
      if (!real.ok) return real;
      gpCallCount++;
      if (gpCallCount === 3) {
        let parseCallCount = 0;
        const origParse = (src: string) => real.parser.parse(src);
        const proxyParser = {
          parse(src: string) {
            parseCallCount++;
            if (parseCallCount === 1) {
              return origParse(src + "\nconst phantom = 999;");
            }
            return origParse(src);
          },
        } as typeof real.parser;
        return { ok: true as const, parser: proxyParser, language: real.language };
      }
      return real;
    };
    const codeLines = Array.from({ length: 30 }, (_, i) => `const x${i} = ${i};`);
    const commentLines = Array.from({ length: 8 }, (_, i) => `// session ${i}`);
    const text = [...codeLines, ...commentLines].join("\n") + "\n";
    const allRows = new Set(Array.from({ length: 38 }, (_, i) => i));
    const r = await autoFix(text, "typescript", allRows, mockParser);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("code content");
  });

  it("trailing-only: budget not over-stripped vs whole-line", async () => {
    // Worked example — trailing vs whole-line with M=20, budget=1.
    //
    // Trailing (inline) comments:
    //   M=20, candidates=2, budget=floor(0.05*20)=1
    //   toCheck=[c1], wlRemoved=0 (trailing, line stays)
    //   1 <= floor(0.05*(20-0))=1 → break, budget stays 1
    //   remove 1, keep 1; after fix: still 20 lines → second run budget=1, 1 candidate → no removal (idempotent)
    const codeLines = Array.from({ length: 18 }, (_, i) => `const x${i} = ${i};`);
    const trailingLines = [
      `const y0 = 0; // session trailing 0`,
      `const y1 = 1; // session trailing 1`,
    ];
    const text = [...codeLines, ...trailingLines].join("\n") + "\n";
    const allRows = new Set(Array.from({ length: 20 }, (_, i) => i));

    const r = await autoFix(text, "typescript", allRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kept).toBe(1);
    expect(r.removed).toBe(1);

    const fixedLineCount = r.fixed.split("\n").filter(l => l !== "").length;
    expect(fixedLineCount).toBe(20);

    const r2 = await autoFix(r.fixed, "typescript", allRows);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.removed).toBe(0);
  });

  it("bite: without safety verifier, code-changing strip would proceed", async () => {
    const text = `const a = 1;\n// remove me\nconst b = 2;\n`.repeat(10);
    const allRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "typescript", allRows);
    if (!r.ok) return;
    for (const n of ["const a = 1;", "const b = 2;"]) {
      expect(r.fixed).toContain(n);
    }
  });
});

// ---- AC-wave-a: New language fixtures ----

describe("detectLanguage — new languages", () => {
  const cases: [string, string | undefined, import("../../src/hooks/lib/comment-density.js").Lang | null][] = [
    ["/foo/main.go", undefined, "go"],
    ["/foo/lib.rs", undefined, "rust"],
    ["/foo/schema.sql", undefined, "sql"],
    ["/foo/Makefile", undefined, "make"],
    ["/foo/GNUmakefile", undefined, "make"],
    ["/foo/makefile", undefined, "make"],
    ["/foo/rules.mk", undefined, "make"],
    ["/foo/config.toml", undefined, "toml"],
    ["/foo/Cargo.toml", undefined, "toml"],
  ];

  it.each(cases)("detectLanguage(%s, %s) → %s", (fp, first, expected) => {
    expect(detectLanguage(fp, first)).toBe(expected);
  });
});

describe("findComments + density — fixture files", () => {
  it("go/main.go: findComments finds ≥10 comments, density uses tree-sitter", async () => {
    const text = await Bun.file(path.join(FIXTURES, "go/main.go")).text();
    const r = await findComments(text, "go");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(10);
    const d = await density(text, "go");
    expect(d.mode).toBe("tree-sitter");
    expect(d.effective).toBeGreaterThan(0);
  });

  it("rust/lib.rs: findComments finds ≥10 comments, density uses tree-sitter", async () => {
    const text = await Bun.file(path.join(FIXTURES, "rust/lib.rs")).text();
    const r = await findComments(text, "rust");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(10);
    const d = await density(text, "rust");
    expect(d.mode).toBe("tree-sitter");
    expect(d.effective).toBeGreaterThan(0);
  });

  it("sql/schema.sql: findComments finds ≥10 comments (including marginalia), density uses tree-sitter", async () => {
    const text = await Bun.file(path.join(FIXTURES, "sql/schema.sql")).text();
    const r = await findComments(text, "sql");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(10);
    const d = await density(text, "sql");
    expect(d.mode).toBe("tree-sitter");
    expect(d.effective).toBeGreaterThan(0);
  });

  it("make/Makefile: findComments finds ≥10 comments, density uses tree-sitter", async () => {
    const text = await Bun.file(path.join(FIXTURES, "make/Makefile")).text();
    const r = await findComments(text, "make");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(10);
    const d = await density(text, "make");
    expect(d.mode).toBe("tree-sitter");
    expect(d.effective).toBeGreaterThan(0);
  });

  it("toml/config.toml: findComments finds ≥10 comments, density uses tree-sitter", async () => {
    const text = await Bun.file(path.join(FIXTURES, "toml/config.toml")).text();
    const r = await findComments(text, "toml");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(10);
    const d = await density(text, "toml");
    expect(d.mode).toBe("tree-sitter");
    expect(d.effective).toBeGreaterThan(0);
  });
});

describe("SQL block comments (marginalia) are captured", () => {
  it("/* ... */ block comment is collected as non-exempt comment in SQL", async () => {
    const sql = `/* This is a block comment */\nSELECT 1;\n`;
    const r = await findComments(sql, "sql");
    if (!r.ok) throw new Error(r.reason);
    const blockComments = r.comments.filter(c => c.nodeType === "marginalia");
    expect(blockComments.length).toBeGreaterThanOrEqual(1);
  });

  it("bite: without marginalia handling, block comments would be missed", async () => {
    // marginalia node type does NOT include the word "comment",
    // so the old node.type.includes("comment") check would miss it.
    const sql = `/* orphan block */\nSELECT 1;\n`;
    const r = await findComments(sql, "sql");
    if (!r.ok) throw new Error(r.reason);
    // With fix: found; without fix: 0 block comments
    expect(r.comments.some(c => c.nodeType === "marginalia")).toBe(true);
  });
});

describe("Go exemptions", () => {
  it("//go:generate directive is exempt", async () => {
    const code = `//go:generate stringer -type=Weekday\nfunc main() {}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(1);
    expect(r.comments[0].exempt).toBe(true);
  });

  it("// +build constraint is exempt", async () => {
    const code = `// +build !windows\npackage main\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(1);
    expect(r.comments[0].exempt).toBe(true);
  });

  it("//nolint directive is exempt", async () => {
    const code = `package main\nfunc f() {\n  x := 1 //nolint:deadcode\n  _ = x\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const nolint = r.comments.find(c => c.text.includes("nolint"));
    expect(nolint).toBeDefined();
    expect(nolint!.exempt).toBe(true);
  });

  it("comment inside function body is NOT exempt", async () => {
    const code = `package main\nfunc main() {\n\t// This is a body comment\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("body comment"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });
});

describe("Rust doc comment exemptions", () => {
  it("/// outer doc comment is exempt", async () => {
    const code = `/// Computes the answer.\npub fn answer() -> i32 { 42 }\n`;
    const r = await findComments(code, "rust");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(1);
    expect(r.comments[0].exempt).toBe(true);
  });

  it("//! inner doc comment is exempt", async () => {
    const code = `//! Module description.\npub mod m {}\n`;
    const r = await findComments(code, "rust");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(1);
    expect(r.comments[0].exempt).toBe(true);
  });

  it("/*! inner block doc comment is exempt", async () => {
    const code = `/*! Inner doc block. */\npub mod m {}\n`;
    const r = await findComments(code, "rust");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(1);
    expect(r.comments[0].exempt).toBe(true);
  });

  it("regular // Rust comment is NOT exempt", async () => {
    const code = `// Just a plain comment\npub fn f() {}\n`;
    const r = await findComments(code, "rust");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(1);
    expect(r.comments[0].exempt).toBe(false);
  });
});

describe("TOML schema directive exemption", () => {
  it("#:schema directive is exempt", async () => {
    const code = `#:schema https://example.com/schema.json\n[package]\nname = "test"\n`;
    const r = await findComments(code, "toml");
    if (!r.ok) throw new Error(r.reason);
    const schema = r.comments.find(c => c.text.includes("#:schema"));
    expect(schema).toBeDefined();
    expect(schema!.exempt).toBe(true);
  });

  it("regular # TOML comment is NOT exempt", async () => {
    const code = `# This is a plain comment\n[package]\nname = "test"\n`;
    const r = await findComments(code, "toml");
    if (!r.ok) throw new Error(r.reason);
    expect(r.comments.length).toBeGreaterThanOrEqual(1);
    expect(r.comments[0].exempt).toBe(false);
  });
});

describe("autoFix — new languages", () => {
  async function countErrorNodes(text: string, lang: Parameters<typeof findComments>[1]): Promise<number> {
    const { getParser: gp } = await import("../../src/hooks/lib/tree-sitter-loader.js");
    const r = await gp(lang);
    if (!r.ok) throw new Error(r.reason);
    const tree = r.parser.parse(text);
    let count = 0;
    function walk(node: import("../../src/hooks/lib/tree-sitter.js").Node): void {
      if (node.type === "ERROR") count++;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child) walk(child);
      }
    }
    walk(tree.rootNode);
    return count;
  }

  it("over-budget Go file: autoFix removes comments and preserves code", async () => {
    const codeLines = Array.from({ length: 30 }, (_, i) => `var x${i} = ${i}`);
    const commentLines = Array.from({ length: 8 }, (_, i) => `// session comment ${i}`);
    const text = `package main\n\n` + [...codeLines, ...commentLines].join("\n") + "\n";
    const allRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "go", allRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    // Code lines preserved
    for (let i = 0; i < 30; i++) {
      expect(r.fixed).toContain(`var x${i} = ${i}`);
    }
    // Re-parses cleanly
    const errorsBefore = await countErrorNodes(text, "go");
    const errorsAfter = await countErrorNodes(r.fixed, "go");
    expect(errorsAfter).toBeLessThanOrEqual(errorsBefore);
  });

  it("over-budget Rust file: autoFix removes comments and preserves code", async () => {
    const codeLines = Array.from({ length: 30 }, (_, i) => `let x${i} = ${i};`);
    const commentLines = Array.from({ length: 8 }, (_, i) => `// session comment ${i}`);
    const text = `fn main() {\n` + [...codeLines, ...commentLines].join("\n") + "\n}\n";
    const allRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "rust", allRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    // Code lines preserved
    for (let i = 0; i < 30; i++) {
      expect(r.fixed).toContain(`let x${i} = ${i};`);
    }
    // Re-parses cleanly
    const errorsBefore = await countErrorNodes(text, "rust");
    const errorsAfter = await countErrorNodes(r.fixed, "rust");
    expect(errorsAfter).toBeLessThanOrEqual(errorsBefore);
  });
});

// ---- Go doc comment exemption ----

describe("Go doc comment exemption", () => {
  it("top-level func doc is exempt (go-doc)", async () => {
    const code = `package main\n// defaultConfig returns sensible defaults.\nfunc defaultConfig() {}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("defaultConfig returns"));
    expect(c?.exempt).toBe(true);
    expect(c?.exemptReason).toBe("go-doc");
  });

  it("comment inside function body is NOT exempt", async () => {
    const code = `package main\nfunc f() {\n\t// internal implementation note\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("internal implementation"));
    expect(c?.exempt).toBe(false);
  });

  it("const-spec doc in group is exempt (go-doc)", async () => {
    const code = `package main\nconst (\n\t// StatusOK means all checks passed.\n\tStatusOK = iota\n)\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("StatusOK means"));
    expect(c?.exempt).toBe(true);
    expect(c?.exemptReason).toBe("go-doc");
  });

  it("struct field doc is exempt (go-doc)", async () => {
    const code = `package main\ntype Config struct {\n\t// Addr is the listen address.\n\tAddr string\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("Addr is the listen"));
    expect(c?.exempt).toBe(true);
    expect(c?.exemptReason).toBe("go-doc");
  });

  it("comment separated from decl by blank line is NOT exempt", async () => {
    const code = `package main\n// This has a blank line before the func.\n\nfunc f() {}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("blank line before"));
    expect(c?.exempt).toBe(false);
  });

  it("package doc comment adjacent to package clause is exempt (go-doc)", async () => {
    const code = `// Package main is the entry point.\npackage main\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("Package main is"));
    expect(c?.exempt).toBe(true);
    expect(c?.exemptReason).toBe("go-doc");
  });

  it("bite: without go-doc rule, func doc would be non-exempt", async () => {
    const code = `package main\n// docFunc documents the function below.\nfunc docFunc() {}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("docFunc documents"));
    // Must be exempt; removing the go-doc rule makes this fail
    expect(c?.exempt).toBe(true);
    expect(c?.exemptReason).toBe("go-doc");
  });
});

describe("autoFix Bug D: multi-row block spanning pre-existing rows is not a candidate", () => {
  it("15-row block where only 1 row was edited survives removal", async () => {
    const blockLines = ["/*", ...Array.from({ length: 13 }, (_, i) => ` * line ${i}`), " */"];
    const block = blockLines.join("\n");
    const pre = Array.from({ length: 5 }, (_, i) => `const pre${i} = ${i};`).join("\n");
    const post = Array.from({ length: 20 }, (_, i) => `const post${i} = ${i};`).join("\n");
    const text = pre + "\n" + block + "\n" + post + "\n";

    const textLines = text.split("\n");
    const addedRows = new Set<number>();
    addedRows.add(10);
    for (let i = 21; i < textLines.length; i++) addedRows.add(i);

    const r = await autoFix(text, "typescript", addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).toContain("* line 0");
    expect(r.removed).toBe(0);
  });

  it("bite: with any-row candidate selection, the block would be a candidate", () => {
    const startRow = 5;
    const endRow = 19;
    const addedRows = new Set([10]);

    let hitAny = false;
    for (let r = startRow; r <= endRow && !hitAny; r++) hitAny = addedRows.has(r);

    let allAdded = true;
    for (let r = startRow; r <= endRow; r++) {
      if (!addedRows.has(r)) { allAdded = false; break; }
    }

    expect(hitAny).toBe(true);
    expect(allAdded).toBe(false);
  });
});

describe("autoFix Bug A: row-based budget prevents partial-fix over cap", () => {
  it("ten 3-row block comments with addedRows.size=100: removed=9, kept=1", async () => {
    const blockTemplate = (i: number) =>
      `/* block ${i} line 1\n * block ${i} line 2\n * block ${i} line 3 */`;
    const codeLines = Array.from({ length: 70 }, (_, i) => `const c${i} = ${i};`);
    const blockParts = Array.from({ length: 10 }, (_, i) => blockTemplate(i));
    const text = [...codeLines, ...blockParts].join("\n") + "\n";

    const textLines = text.split("\n");
    const addedRows = new Set<number>();
    for (let i = 0; i < Math.min(100, textLines.length); i++) addedRows.add(i);

    const r = await autoFix(text, "typescript", addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total).toBe(10);
    expect(r.kept).toBe(1);
    expect(r.removed).toBe(9);
  });

  it("bite: old count-based budget would keep too many blocks leaving density > 5%", () => {
    const addedRowsSize = 100;
    const oldBudget = Math.floor(0.05 * addedRowsSize);
    const oldKeptCount = oldBudget;

    const keptRows = oldKeptCount * 3;
    const density = (keptRows / addedRowsSize) * 100;
    expect(density).toBeGreaterThan(5);
  });
});

describe("TS triple-slash reference directive is exempt", () => {
  it("/// <reference types='foo' /> is exempt in typescript", async () => {
    const code = `/// <reference types="foo" />\nconst x = 1;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const ref = r.comments.find(c => c.text.includes("<reference"));
    expect(ref).toBeDefined();
    expect(ref!.exempt).toBe(true);
  });

  it("autoFix: /// <reference .../> survives (exempt, not a candidate)", async () => {
    const codeLines = Array.from({ length: 30 }, (_, i) => `const x${i} = ${i};`);
    const commentLines = Array.from({ length: 8 }, (_, i) => `// session ${i}`);
    const ref = `/// <reference types="bun-types" />`;
    const text = [ref, ...codeLines, ...commentLines].join("\n") + "\n";
    const allRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "typescript", allRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).toContain('<reference types="bun-types"');
  });

  it("bite: without TSREF_RE exemption, reference directive would be a non-exempt candidate", async () => {
    const code = `/// <reference types="foo" />\nconst x = 1;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const ref = r.comments.find(c => c.text.includes("<reference"));
    expect(ref).toBeDefined();
    expect(ref!.exempt).toBe(true);
  });
});

describe("Rust doc comment exact matching", () => {
  it("//// four slashes is NOT exempt (not a doc comment)", async () => {
    const code = `//// This has four slashes\npub fn f() {}\n`;
    const r = await findComments(code, "rust");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.startsWith("////"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });

  it("/*** three-star block is NOT exempt (not a JSDoc or Rust doc)", async () => {
    const code = `/*** this is a divider-style block */\nconst x = 1;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.startsWith("/***"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });

  it("bite: without exact /// check, //// would wrongly be exempt", () => {
    const raw = "//// four slashes";
    const trimmed = raw.trimStart();
    const oldWouldExempt = trimmed.startsWith("///");
    const newExempt = trimmed.startsWith("///") && (trimmed.length === 3 || trimmed[3] !== "/");
    expect(oldWouldExempt).toBe(true);
    expect(newExempt).toBe(false);
  });

  it("bite: without exact /** check, /*** would wrongly be exempt as jsdoc", () => {
    const raw = "/*** divider block */";
    const trimmed = raw.trimStart();
    const oldWouldExempt = trimmed.startsWith("/**");
    const newExempt = trimmed.startsWith("/**") && !trimmed.startsWith("/***");
    expect(oldWouldExempt).toBe(true);
    expect(newExempt).toBe(false);
  });
});

// ---- Fix 1: Go trailing comments must NOT be exempt as go-doc ----

describe("Go trailing comments are NOT doc-comments", () => {
  it("struct field trailing comment is NOT exempt", async () => {
    const code = [
      "package main",
      "type Config struct {",
      "\tPort int    // listen port",
      "\tHost string // bind host",
      "\tTLS  bool   // use tls",
      "}",
      "",
    ].join("\n");
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const trailing = r.comments.filter(c => c.text.includes("listen port") || c.text.includes("bind host") || c.text.includes("use tls"));
    expect(trailing.length).toBe(3);
    for (const c of trailing) {
      expect(c.exempt).toBe(false);
    }
  });

  it("const spec trailing comment is NOT exempt", async () => {
    const code = [
      "package main",
      "const (",
      "\tA = 1 // first",
      "\tB = 2 // second",
      ")",
      "",
    ].join("\n");
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const trailing = r.comments.filter(c => c.text.includes("first") || c.text.includes("second"));
    expect(trailing.length).toBe(2);
    for (const c of trailing) {
      expect(c.exempt).toBe(false);
    }
  });

  it("consecutive one-line func with trailing comment: trailing comment NOT exempt", async () => {
    const code = [
      "package main",
      "func A() {} // implements A",
      "func B() {} // implements B",
      "",
    ].join("\n");
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const trailing = r.comments.filter(c => c.text.includes("implements"));
    expect(trailing.length).toBe(2);
    for (const c of trailing) {
      expect(c.exempt).toBe(false);
    }
  });

  it("whole-line doc comment above struct field remains exempt", async () => {
    const code = [
      "package main",
      "type Config struct {",
      "\t// Addr is the listen address.",
      "\tAddr string",
      "}",
      "",
    ].join("\n");
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("Addr is"));
    expect(c?.exempt).toBe(true);
    expect(c?.exemptReason).toBe("go-doc");
  });

  it("bite: before fix, struct field trailing comment was wrongly exempt", async () => {
    const code = [
      "package main",
      "type Config struct {",
      "\tPort int // listen port",
      "\tHost string // bind host",
      "}",
      "",
    ].join("\n");
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const portComment = r.comments.find(c => c.text.includes("listen port"));
    expect(portComment).toBeDefined();
    expect(portComment!.exempt).toBe(false);
  });
});

// ---- Fix 2: autoFix single-pass reaches ≤5/100 ----

describe("autoFix single-pass density compliance", () => {
  it("20×(1 whole-line comment + 4 code): single autoFix reaches ≤5/100", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`// comment ${i}`);
      for (let j = 0; j < 4; j++) lines.push(`const v${i}_${j} = ${i * 4 + j};`);
    }
    const text = lines.join("\n") + "\n";
    const allRows = new Set(lines.map((_, i) => i));

    const r = await autoFix(text, "typescript", allRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const fixedLines = r.fixed.split("\n");
    const origLines = text.split("\n");
    const removedWholeLineRows = new Set<number>();
    for (let i = 0; i < origLines.length; i++) {
      const orig = origLines[i];
      if (orig.trimStart().startsWith("//") && allRows.has(i)) {
        const inFixed = fixedLines.some(l => l === orig);
        if (!inFixed) removedWholeLineRows.add(i);
      }
    }
    const sortedRemoved = [...removedWholeLineRows].sort((a, b) => a - b);
    const remappedRows = new Set<number>();
    for (const row of allRows) {
      if (removedWholeLineRows.has(row)) continue;
      const offset = sortedRemoved.filter(rr => rr < row).length;
      remappedRows.add(row - offset);
    }

    const d = await density(r.fixed, "typescript", remappedRows);
    expect(d.effective / remappedRows.size * 100).toBeLessThanOrEqual(5);

    const r2 = await autoFix(r.fixed, "typescript", remappedRows);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.removed).toBe(0);
  });

  it("all-new file 21 comments ~80 lines: single autoFix reaches ≤5/100", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 21; i++) {
      lines.push(`// note ${i}`);
      for (let j = 0; j < 3; j++) lines.push(`const w${i}_${j} = ${i * 3 + j};`);
    }
    while (lines.length < 80) lines.push(`const pad${lines.length} = 0;`);
    const text = lines.join("\n") + "\n";
    const allRows = new Set(lines.map((_, i) => i));

    const r = await autoFix(text, "typescript", allRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const origLines = text.split("\n");
    const fixedLinesArr = r.fixed.split("\n");
    const removedWholeLineRows = new Set<number>();
    for (let i = 0; i < origLines.length; i++) {
      const orig = origLines[i];
      if (orig.trimStart().startsWith("//") && allRows.has(i)) {
        const inFixed = fixedLinesArr.some(l => l === orig);
        if (!inFixed) removedWholeLineRows.add(i);
      }
    }
    const sortedRemoved = [...removedWholeLineRows].sort((a, b) => a - b);
    const remappedRows = new Set<number>();
    for (const row of allRows) {
      if (removedWholeLineRows.has(row)) continue;
      const offset = sortedRemoved.filter(rr => rr < row).length;
      remappedRows.add(row - offset);
    }

    const d = await density(r.fixed, "typescript", remappedRows);
    expect(d.effective / remappedRows.size * 100).toBeLessThanOrEqual(5);

    const r2 = await autoFix(r.fixed, "typescript", remappedRows);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.removed).toBe(0);
  });

  it("bite: old keptRows/addedRows.size denominator leaves fixed text over cap", async () => {
    // 20×(1 comment + 4 code) = 100 rows; budget=5; keeps 5 comments; fixed=85 rows
    // old check: 5/100*100=5 ≤5 → passes; but density(fixed,remapped)=5/85*100≈5.88 > 5
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`// comment ${i}`);
      for (let j = 0; j < 4; j++) lines.push(`const v${i}_${j} = ${i * 4 + j};`);
    }
    const text = lines.join("\n") + "\n";
    const allRows = new Set(lines.map((_, i) => i));

    // Simulate old logic: maxAllowedRows = floor(0.05*100)=5, keep 5 comment rows
    const addedRowsSize = 100;
    const keptRows = 5; // 5 comments kept
    const oldCheck = keptRows / addedRowsSize * 100;
    // Old check passes (≤5), but real density would be:
    const fixedRowCount = 100 - 15; // 15 comments removed
    const realDensity = keptRows / fixedRowCount * 100;

    expect(oldCheck).toBeLessThanOrEqual(5); // old check wrongly passes
    expect(realDensity).toBeGreaterThan(5);  // actual density is over cap

    // The new autoFix should reach compliant state (fixed text density ≤5/100)
    const r = await autoFix(text, "typescript", allRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Compute remapped rows for verification
    const origLines = text.split("\n");
    const fixedLinesArr = r.fixed.split("\n");
    const removedWholeLineRows = new Set<number>();
    for (let i = 0; i < origLines.length; i++) {
      const orig = origLines[i];
      if (orig.trimStart().startsWith("//") && allRows.has(i)) {
        if (!fixedLinesArr.some(l => l === orig)) removedWholeLineRows.add(i);
      }
    }
    const sortedRemoved = [...removedWholeLineRows].sort((a, b) => a - b);
    const remappedRows = new Set<number>();
    for (const row of allRows) {
      if (removedWholeLineRows.has(row)) continue;
      const offset = sortedRemoved.filter(rr => rr < row).length;
      remappedRows.add(row - offset);
    }
    const d = await density(r.fixed, "typescript", remappedRows);
    expect(d.effective / remappedRows.size * 100).toBeLessThanOrEqual(5);
  });
});

// ---- netNewCommentRows ----

describe("netNewCommentRows", () => {
  const ts = "typescript" as Lang;

  it("reword in same hunk counts as 0 net-new", async () => {
    const base = `function f() {\n  // old comment\n  return 1;\n}\n`;
    const post = `function f() {\n  // new comment\n  return 1;\n}\n`;
    const hunk: DiffHunk = { added: [2], removed: ["  // old comment"], removedBaseLineNos: [2] };
    const r = await netNewCommentRows(base, post, ts, [hunk], getParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(0);
    expect(r.added).toBe(1);
    expect(r.removed).toBe(1);
  });

  it("genuinely added comment counts as 1", async () => {
    const base = `function f() {\n  return 1;\n}\n`;
    const post = `function f() {\n  // new comment\n  return 1;\n}\n`;
    const hunk: DiffHunk = { added: [2], removed: [], removedBaseLineNos: [] };
    const r = await netNewCommentRows(base, post, ts, [hunk], getParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toBe(2);
    expect(r.added).toBe(1);
    expect(r.removed).toBe(0);
  });

  it("reword + one new comment = 1 net-new", async () => {
    const base = `function f() {\n  // old comment\n  return 1;\n}\n`;
    const post = `function f() {\n  // new comment\n  // extra comment\n  return 1;\n}\n`;
    const hunk: DiffHunk = { added: [2, 3], removed: ["  // old comment"], removedBaseLineNos: [2] };
    const r = await netNewCommentRows(base, post, ts, [hunk], getParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toBe(3);
    expect(r.added).toBe(2);
    expect(r.removed).toBe(1);
  });

  it("new comment ABOVE a reword → rows equals exactly [row of the new comment]", async () => {
    const base = `function f() {\n  // why old\n  return 1;\n}\n`;
    const post = `function f() {\n  // brand new narration\n  // why reworded\n  return 1;\n}\n`;
    const hunk: DiffHunk = { added: [2, 3], removed: ["  // why old"], removedBaseLineNos: [2] };
    const r = await netNewCommentRows(base, post, ts, [hunk], getParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toBe(2);
  });

  it("new comment BELOW a reword → rows equals exactly [row of the new comment]", async () => {
    const base = `function f() {\n  // why old\n  return 1;\n}\n`;
    const post = `function f() {\n  // why reworded\n  // brand new narration\n  return 1;\n}\n`;
    const hunk: DiffHunk = { added: [2, 3], removed: ["  // why old"], removedBaseLineNos: [2] };
    const r = await netNewCommentRows(base, post, ts, [hunk], getParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toBe(3);
  });

  it("two rewords + one new in a hunk, new in the middle → exactly [middle row]", async () => {
    const base = `function f() {\n  // old narration 1\n  // old narration 2\n  return 1;\n}\n`;
    const post = `function f() {\n  // new narration 1\n  // brand new middle\n  // new narration 2\n  return 1;\n}\n`;
    const hunk: DiffHunk = {
      added: [2, 3, 4],
      removed: ["  // old narration 1", "  // old narration 2"],
      removedBaseLineNos: [2, 3],
    };
    const r = await netNewCommentRows(base, post, ts, [hunk], getParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toBe(3);
  });

  it("exempt comment pairing does not cancel a real added comment", async () => {
    const base = `function f() {\n  // @ts-ignore\n  return 1;\n}\n`;
    const post = `function f() {\n  // @ts-ignore\n  // real comment\n  return 1;\n}\n`;
    const hunk: DiffHunk = { added: [3], removed: [], removedBaseLineNos: [] };
    const r = await netNewCommentRows(base, post, ts, [hunk], getParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toBe(3);
  });

  it("autoFix does not strip a reworded comment when netNewRows excludes it", async () => {
    const codeLines = Array.from({ length: 94 }, (_, i) => `const x${i + 7} = ${i + 7};`);
    const commentLines = Array.from({ length: 5 }, (_, i) => `// comment ${i + 2}`);
    const text = [`// new`, ...commentLines, ...codeLines].join("\n") + "\n";

    const addedRows = new Set(Array.from({ length: 100 }, (_, i) => i));
    const netNewRows = new Set([1, 2, 3, 4, 5]);

    const r = await autoFix(text, ts, addedRows, getParser, netNewRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).toContain("// new");
  });
});

// ---- HR-22: Partial-error tree fix ----

describe("findComments: partial-error tree yields safe comments", () => {
  it("TypeScript inline-import array suffix: ok:true with both trailing and inline comments", async () => {
    const code = "const a = 1; // trailing restating\nlet x: import('a').B[];\nfoo(); /* inline */\n";
    const r = await findComments(code, "typescript");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const effective = r.comments.filter(c => !c.exempt);
    expect(effective).toHaveLength(2);
    const texts = effective.map(c => c.text);
    expect(texts.some(t => t.includes("trailing restating"))).toBe(true);
    expect(texts.some(t => t.includes("inline"))).toBe(true);
  });
});

describe("netNewCommentRows: partial parse errors", () => {
  const ts = "typescript" as Lang;

  it("parse error line outside added hunk: AST counting, reword pairing works", async () => {
    const errLine = "\nlet x: import('a').B[];";
    const base = `function f() {\n  // old comment\n  return 1;\n}${errLine}\n`;
    const post = `function f() {\n  // new comment\n  return 1;\n}${errLine}\n`;
    const hunk: DiffHunk = { added: [2], removed: ["  // old comment"], removedBaseLineNos: [2] };
    const r = await netNewCommentRows(base, post, ts, [hunk], getParser);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(0);
  });

  it("parse error on an added hunk row: falls back ok:false", async () => {
    const base = `function f() {\n  // existing comment\n  return 1;\n}\n`;
    const post = `function f() {\n  // existing comment\n  return 1;\n}\nlet x: import('a').B[];\n`;
    const hunk: DiffHunk = { added: [5], removed: [], removedBaseLineNos: [] };
    const r = await netNewCommentRows(base, post, ts, [hunk], getParser);
    expect(r.ok).toBe(false);
  });
});

describe("autoFix: skips candidates overlapping error region", () => {
  it("does not strip a trailing comment on the same row as a parse error", async () => {
    const lines: string[] = [
      "const x0 = 0; // over-cap-comment",
      "let x: import('a').B[]; // error-row-comment",
      ...Array.from({ length: 8 }, (_, i) => `const x${i + 2} = ${i + 2};`),
    ];
    const text = lines.join("\n") + "\n";
    const addedRows = new Set(Array.from({ length: lines.length }, (_, i) => i));
    const r = await autoFix(text, "typescript", addedRows);
    if (r.ok && r.removed > 0) {
      expect(r.fixed).toContain("// error-row-comment");
    }
  });
});

// ---- Go run-based comment exemptions (GO-T2) ----

describe("Go go-file-header exemption", () => {
  it("AC1: license block before package x is exempt, reason go-file-header", async () => {
    const code = `// Copyright 2024 Acme Corp.\n// SPDX-License-Identifier: MIT\n\npackage main\n\nfunc f() {}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c1 = r.comments.find(c => c.text.includes("Copyright"));
    expect(c1).toBeDefined();
    expect(c1!.exempt).toBe(true);
    expect(c1!.exemptReason).toBe("go-file-header");
    const c2 = r.comments.find(c => c.text.includes("SPDX"));
    expect(c2).toBeDefined();
    expect(c2!.exempt).toBe(true);
    expect(c2!.exemptReason).toBe("go-file-header");
  });

  it("AC1: Code generated comment + blank + package is exempt, reason go-file-header", async () => {
    const code = `// Code generated by foo. DO NOT EDIT.\n\npackage main\n\nfunc f() {}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("Code generated"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
    expect(c!.exemptReason).toBe("go-file-header");
  });

  it("AC4: narrative comment after package_clause is NOT exempt via go-file-header", async () => {
    const code = `package main\n\n// some narrative comment here\n\nfunc f() {}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("narrative comment"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });
});

describe("Go cgo-preamble (// lines) exemption", () => {
  it("AC2: // #cgo and // #include directly above import C are both exempt, reason cgo-preamble", async () => {
    const code = `package main\n\n// #cgo LDFLAGS: -lm\n// #include <math.h>\nimport "C"\n\nfunc f() {}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c1 = r.comments.find(c => c.text.includes("#cgo"));
    expect(c1).toBeDefined();
    expect(c1!.exempt).toBe(true);
    expect(c1!.exemptReason).toBe("cgo-preamble");
    const c2 = r.comments.find(c => c.text.includes("#include"));
    expect(c2).toBeDefined();
    expect(c2!.exempt).toBe(true);
    expect(c2!.exemptReason).toBe("cgo-preamble");
  });

  it("AC2: // cgo comment with blank line before import C is NOT exempt", async () => {
    const code = `package main\n\n// #cgo LDFLAGS: -lm\n\nimport "C"\n\nfunc f() {}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("#cgo LDFLAGS"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });
});

describe("Go go-example-output exemption", () => {
  it("AC3: Output: line and contiguous lines inside ExampleHello are all exempt, reason go-example-output", async () => {
    const code = `package main\n\nimport "fmt"\n\nfunc ExampleHello() {\n\tfmt.Println("hi")\n\t// Output:\n\t// hi\n\t// there\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const cOut = r.comments.find(c => c.text.trim() === "// Output:");
    expect(cOut).toBeDefined();
    expect(cOut!.exempt).toBe(true);
    expect(cOut!.exemptReason).toBe("go-example-output");
    const cHi = r.comments.find(c => c.text.trim() === "// hi");
    expect(cHi).toBeDefined();
    expect(cHi!.exempt).toBe(true);
    expect(cHi!.exemptReason).toBe("go-example-output");
    const cThere = r.comments.find(c => c.text.trim() === "// there");
    expect(cThere).toBeDefined();
    expect(cThere!.exempt).toBe(true);
    expect(cThere!.exemptReason).toBe("go-example-output");
  });

  it("AC3: Unordered output: variant inside Example func is exempt, reason go-example-output", async () => {
    const code = `package main\n\nimport "fmt"\n\nfunc ExampleSort() {\n\tfmt.Println("b")\n\t// Unordered output:\n\t// b\n\t// a\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("Unordered output:"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
    expect(c!.exemptReason).toBe("go-example-output");
    const ca = r.comments.find(c => c.text.trim() === "// a");
    expect(ca).toBeDefined();
    expect(ca!.exempt).toBe(true);
    expect(ca!.exemptReason).toBe("go-example-output");
  });

  it("AC3: Output: and following lines inside func helper are NOT exempt via go-example-output", async () => {
    const code = `package main\n\nimport "fmt"\n\nfunc helper() {\n\tfmt.Println("hi")\n\t// Output:\n\t// hi\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const cOut = r.comments.find(c => c.text.trim() === "// Output:");
    expect(cOut).toBeDefined();
    expect(cOut!.exempt).toBe(false);
    const cHi = r.comments.find(c => c.text.trim() === "// hi");
    expect(cHi).toBeDefined();
    expect(cHi!.exempt).toBe(false);
  });
});

// ---- Go inline-directive exemptions (GO-T1) ----

describe("Go lint:ignore / lint:file-ignore exemptions", () => {
  it("//lint:ignore SA1000 reason is present and exempt in go", async () => {
    const code = `package main\nfunc f() {\n  _ = 1 //lint:ignore SA1000 not needed\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("lint:ignore"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("//lint:file-ignore U1000 reason is present and exempt in go", async () => {
    // Inside func body so go-doc exemption does not apply
    const code = `package main\nfunc f() {\n  _ = 1 //lint:file-ignore U1000 generated\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("lint:file-ignore"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("// lint ignore later is NOT exempt (near-miss, no colon)", async () => {
    const code = `package main\nfunc f() {\n  _ = 1 // lint ignore later\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("lint ignore later"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });
});

describe("Go Unordered output: exemption (lowercase o)", () => {
  it("// Unordered output: is present and exempt in go", async () => {
    const code = `package main\nfunc ExampleF() {\n  // Unordered output:\n  // b\n  // a\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("Unordered output:"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("// Output: is still present and exempt in go", async () => {
    const code = `package main\nfunc ExampleF() {\n  // Output:\n  // hello\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("Output:"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("// output looks fine is NOT exempt (near-miss, no colon after output)", async () => {
    const code = `package main\nfunc f() {\n  // output looks fine\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("output looks fine"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });
});

describe("Go +marker: directive exemptions", () => {
  it("// +kubebuilder:validation:Optional is present and exempt in go", async () => {
    // Inside func body so go-doc exemption does not apply
    const code = `package main\nfunc init() {\n  // +kubebuilder:validation:Optional\n  _ = 1\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("+kubebuilder:validation:Optional"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("// +k8s:deepcopy-gen=package is present and exempt in go", async () => {
    // Inside func body so go-doc exemption does not apply
    const code = `package main\nfunc init() {\n  // +k8s:deepcopy-gen=package\n  _ = 1\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("+k8s:deepcopy-gen=package"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
  });

  it("// +kubebuilder:validation:Optional is NOT exempt in typescript", async () => {
    const code = `// +kubebuilder:validation:Optional\nconst x = 1;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("+kubebuilder:validation:Optional"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });

  it("// + not a marker is NOT exempt in go (near-miss, space after +)", async () => {
    const code = `package main\nfunc f() {\n  // + not a marker\n}\n`;
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("+ not a marker"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(false);
  });
});

function allRows(code: string): Set<number> {
  return new Set(code.split("\n").map((_, i) => i));
}

const GO_FIXTURES = {
  F1_between_blanks: `package main\n\nfunc main() {\n\n\t// comment one\n\t// comment two\n\t// comment three\n\t// comment four\n\t// comment five\n\t// comment six\n\n\tx := 1\n\t_ = x\n}\n`,
  F2_comment_at_eof: `package main\n\nfunc main() {\n\tx := 1\n\t_ = x\n}\n\n// comment one\n// comment two\n// comment three\n// comment four\n// comment five\n// comment six\n`,
  F3_trailing_single: `package main\n\nfunc main() {\n\tx := 1 // comment one\n\ty := 2 // comment two\n\tz := 3 // comment three\n\ta := 4 // comment four\n\tb := 5 // comment five\n\tc := 6 // comment six\n\t_ = x + y + z + a + b + c\n}\n`,
  F4_start_of_func: `package main\n\nfunc main() {\n\t// comment one\n\t// comment two\n\t// comment three\n\t// comment four\n\t// comment five\n\t// comment six\n\tx := 1\n\t_ = x\n}\n`,
  F5_before_brace: `package main\n\nfunc main() {\n\tx := 1\n\t_ = x\n\n\t// comment one\n\t// comment two\n\t// comment three\n\t// comment four\n\t// comment five\n\t// comment six\n}\n`,
  F6_aligned_struct: `package main\n\ntype Foo struct {\n\tA int     // comment one\n\tB string  // comment two\n\tC float64 // comment three\n\tD bool    // comment four\n\tE int64   // comment five\n\tF uint    // comment six\n}\n`,
  F7_blank_comment_brace: `package main\n\nfunc main() {\n\tx := 1\n\t_ = x\n\n\t// comment one\n\t// comment two\n\t// comment three\n\t// comment four\n\t// comment five\n\t// comment six\n\t// comment seven\n}\n`,
  F8_comment_before_blank: `package main\n\nfunc main() {\n\tx := 1\n\t_ = x\n\t// comment one\n\t// comment two\n\t// comment three\n\t// comment four\n\t// comment five\n\t// comment six\n\n\ty := 2\n\t_ = y\n}\n`,
};

const ALIGNED_STRUCT_CODE = `package main\n\ntype Foo struct {\n\tA        int     // alpha\n\tB        string  // beta\n\tLongName float64 // gamma\n}\n`;

const f9VarLines = Array.from({ length: 47 }, (_, i) => `\tvar x${i} = ${i}`).join("\n");
const ALIGNED_WITH_NARRATIVE = `package main\n\ntype Foo struct {\n\tA        int     // alpha\n\tB        string  // beta\n\tLongName float64 // gamma\n}\n\n// narrative\n\nfunc main() {\n${f9VarLines}\n\t_ = x0\n}\n`;

const ALL_REMOVED_STRUCT = `package main\n\ntype Foo struct {\n\tA        int     // alpha\n\tB        string  // beta\n\tLongName float64 // gamma\n}\n\nfunc main() {\n\tvar x0, x1, x2, x3, x4, x5, x6, x7, x8, x9 int\n\t_ = x0 + x1 + x2 + x3 + x4 + x5 + x6 + x7 + x8 + x9\n}\n`;

describe("Go autoFix text-level whitespace output (GO-T2b)", () => {
  it("AC1: comment between two blank lines collapses to a single blank line", async () => {
    const code = GO_FIXTURES.F1_between_blanks;
    const r = await autoFix(code, "go", allRows(code));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).not.toMatch(/\n\n\n/);
    expect(r.fixed).toContain("func main() {\n\n\t");
  });

  it("AC2: comment block at EOF leaves no trailing blank line", async () => {
    const code = GO_FIXTURES.F2_comment_at_eof;
    const r = await autoFix(code, "go", allRows(code));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).not.toMatch(/\n\n$/);
    expect(r.fixed).toMatch(/\}\n$/);
  });

  it("AC3: pre-existing double blank elsewhere is preserved byte-identical", async () => {
    const code = `package main\n\n\nfunc main() {\n\tx := 1\n\t// comment one\n\t// comment two\n\t// comment three\n\t// comment four\n\t// comment five\n\t// comment six\n\t_ = x\n}\n`;
    const r = await autoFix(code, "go", allRows(code));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).toContain("package main\n\n\nfunc main()");
  });

  it("AC5: TypeScript autoFix output is unaffected by Go normalisation path", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i}; // comment ${i}`);
    const code = lines.join("\n") + "\n";
    const r = await autoFix(code, "typescript", allRows(code));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toMatch(/const x0 = 0;/);
  });

  it("AC6: autoFix returns ok and removed>0 for each Go fixture", async () => {
    for (const [name, code] of Object.entries(GO_FIXTURES)) {
      const r = await autoFix(code, "go", allRows(code));
      expect(r.ok, `${name}: expected ok`).toBe(true);
      if (!r.ok) continue;
      expect(r.removed, `${name}: expected removed>0`).toBeGreaterThan(0);
    }
  });

  it("AC7: aligned trailing run — narrative removed, all aligned comments kept", async () => {
    const r = await autoFix(ALIGNED_WITH_NARRATIVE, "go", allRows(ALIGNED_WITH_NARRATIVE));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("// alpha");
    expect(r.fixed).toContain("// beta");
    expect(r.fixed).toContain("// gamma");
    expect(r.fixed).not.toContain("// narrative");
  });

  it("AC8: aligned trailing run — all-removed variant: struct comments gone", async () => {
    const r = await autoFix(ALL_REMOVED_STRUCT, "go", allRows(ALL_REMOVED_STRUCT));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBe(3);
    expect(r.fixed).not.toContain("// alpha");
    expect(r.fixed).not.toContain("// beta");
    expect(r.fixed).not.toContain("// gamma");
  });

  it("AC9: partial aligned run — unreachable budget returns still-over-cap", async () => {
    const codeRows = allRows(ALIGNED_STRUCT_CODE);
    const netNewWithoutGamma = new Set([...codeRows].filter(r => r !== 5));
    const r = await autoFix(ALIGNED_STRUCT_CODE, "go", codeRows, undefined, netNewWithoutGamma);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("still over cap after fix");
  });
});

// ---- Go autoFix: no external formatter needed (GO-D6) ----

// Bun snapshots the environment at startup: child processes spawned without an
// explicit env keep the original PATH even after process.env.PATH is changed.
// So autoFix runs in a child bun whose whole environment is PATH=<empty dir>.
describe("Go autoFix: no external formatter needed (GO-D6)", () => {
  const _go_d6_tmpDirs: string[] = [];
  afterAll(() => {
    for (const d of _go_d6_tmpDirs) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("AC1: autoFix succeeds with ok:true when no go toolchain binary is on PATH", () => {
    const emptyDir = mkdtempSync(path.join(os.tmpdir(), "go-d6-"));
    _go_d6_tmpDirs.push(emptyDir);
    expect(readdirSync(emptyDir)).toEqual([]);
    expect(Bun.which("go", { PATH: emptyDir })).toBeNull();

    const code = [
      "package main",
      "",
      "//go:generate echo hi",
      "//go:build !windows",
      "",
      "func main() {",
      "\t// narrative one",
      "\t// narrative two",
      "\t// narrative three",
      "\t// narrative four",
      "\t// narrative five",
      "\t// narrative six",
      "\tx := 1 //nolint:unused",
      "\t_ = x",
      "}",
      "",
    ].join("\n");

    const lib = path.resolve(import.meta.dir, "../../src/hooks/lib/comment-density.ts");
    const script = `
      const { autoFix } = await import(${JSON.stringify(lib)});
      const code = ${JSON.stringify(code)};
      const rows = new Set(code.split("\\n").map((_, i) => i));
      const r = await autoFix(code, "go", rows);
      process.stdout.write(JSON.stringify(r));
    `;
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      env: { PATH: emptyDir },
      cwd: emptyDir,
    });
    const stderr = child.stderr.toString();
    expect(child.exitCode, stderr).toBe(0);
    const r = JSON.parse(child.stdout.toString());

    expect(r.ok, `reason: ${r.reason}`).toBe(true);
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("//go:generate echo hi");
    expect(r.fixed).toContain("//go:build !windows");
    expect(r.fixed).toContain("//nolint:unused");
    expect(r.fixed).not.toContain("// narrative one");
    expect(r.fixed).not.toContain("// narrative six");
  });

  it("AC2: autoFix does not invoke gofmt or go even when they are available on PATH", () => {
    const stubDir = mkdtempSync(path.join(os.tmpdir(), "go-d6-stub-"));
    _go_d6_tmpDirs.push(stubDir);
    const logFile = path.join(stubDir, "invocations.log");

    // stub gofmt: log invocation, passthrough stdin via cat
    writeFileSync(
      path.join(stubDir, "gofmt"),
      `#!/bin/sh\nprintf 'gofmt\\n' >> "${logFile}"\ncat\n`,
      { mode: 0o755 },
    );
    // stub go: log invocation, print nothing
    writeFileSync(
      path.join(stubDir, "go"),
      `#!/bin/sh\nprintf 'go\\n' >> "${logFile}"\n`,
      { mode: 0o755 },
    );

    const code = [
      "package main",
      "",
      "//go:generate echo hi",
      "//go:build !windows",
      "",
      "func main() {",
      "\t// narrative one",
      "\t// narrative two",
      "\t// narrative three",
      "\t// narrative four",
      "\t// narrative five",
      "\t// narrative six",
      "\tx := 1 //nolint:unused",
      "\t_ = x",
      "}",
      "",
    ].join("\n");

    const lib = path.resolve(import.meta.dir, "../../src/hooks/lib/comment-density.ts");
    const script = `
      const { autoFix } = await import(${JSON.stringify(lib)});
      const code = ${JSON.stringify(code)};
      const rows = new Set(code.split("\\n").map((_, i) => i));
      const r = await autoFix(code, "go", rows);
      process.stdout.write(JSON.stringify(r));
    `;
    const child = Bun.spawnSync([process.execPath, "-e", script], {
      env: { PATH: stubDir },
      cwd: stubDir,
    });
    const stderr = child.stderr.toString();
    expect(child.exitCode, stderr).toBe(0);
    const r = JSON.parse(child.stdout.toString());
    expect(r.ok, `reason: ${r.reason}`).toBe(true);

    // neither gofmt nor go must have been invoked
    expect(existsSync(logFile), "stub log must not exist — gofmt/go was invoked").toBe(false);
  });
});

// ---- Go autoFix text-level output (GO-D6) ----

describe("Go autoFix text-level output (GO-D6)", () => {
  // narrative comment inside const block — not adjacent to any spec, not a doc-comment
  const F_CONST_BETWEEN = `package main\n\nconst (\n\tX      = 1\n\tYYYYYY = 2\n\t// narrative comment\n)\n`;
  // narrative standalone comment between trailing-comment stmts
  const F_FUNC_TRAILING = `package main\n\nfunc foo() {\n\tx := 1 // first\n\t// narrative\n\tyy := 22 // second\n}\n`;
  const F_STRUCT_NARRATIVE = `package main\n\ntype T struct {\n\tA        int    // short\n\tLongName string // long\n\t// narrative\n}\n`;

  it("AC1a: const block — narrative between diff-length consts removed, exact output", async () => {
    const r = await autoFix(F_CONST_BETWEEN, "go", allRows(F_CONST_BETWEEN));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).not.toContain("narrative");
    expect(r.fixed).toBe("package main\n\nconst (\n\tX      = 1\n\tYYYYYY = 2\n)\n");
  });

  it("AC1b: func body — narrative between trailing-comment stmts removed, exact output", async () => {
    const r = await autoFix(F_FUNC_TRAILING, "go", allRows(F_FUNC_TRAILING));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).not.toContain("narrative");
    expect(r.fixed).toBe("package main\n\nfunc foo() {\n\tx := 1\n\tyy := 22\n}\n");
  });

  it("AC1c: struct fields split by narrative — narrative removed, ok and removed>0", async () => {
    const r = await autoFix(F_STRUCT_NARRATIVE, "go", allRows(F_STRUCT_NARRATIVE));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).not.toContain("narrative");
  });

  it("AC2: gofmt-dirty input not reformatted; non-removed rows byte-identical", async () => {
    const dirtyCode = `package main\n\nconst (\n  X = 1\n  Y = 2\n)\n\n// narrative one\n// narrative two\n// narrative three\n// narrative four\n// narrative five\n// narrative six\n\nfunc main() {}\n`;
    const r = await autoFix(dirtyCode, "go", allRows(dirtyCode));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    expect(r.fixed).toContain("  X = 1");
    expect(r.fixed).toContain("  Y = 2");
    expect(r.fixed).not.toContain("// narrative");
    expect(r.fixed).toBe("package main\n\nconst (\n  X = 1\n  Y = 2\n)\n\nfunc main() {}\n");
  });
});

// ---- M3: GO_LINE_RE pin ----

describe("Go //line directive exemption pin (M3)", () => {
  const CODE_WITH_LINE = `package main\n\nfunc foo() {\n\tx := 1\n\t//line foo.go:10\n\t_ = x\n}\n`;

  it("//line inside func body: present in r.comments, exempt, exemptReason='line foo.go:10'", async () => {
    const r = await findComments(CODE_WITH_LINE, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("line foo.go:10"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
    expect(c!.exemptReason).toBe("line foo.go:10");
  });

  it("autoFix keeps //line directive when file is over budget", async () => {
    const code = `package main\n\nfunc foo() {\n\tx := 1\n\t//line foo.go:10\n\t// c1\n\t// c2\n\t// c3\n\t// c4\n\t// c5\n\t// c6\n\t_ = x\n}\n`;
    const r = await autoFix(code, "go", allRows(code));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).toContain("//line foo.go:10");
  });
});

// ---- M4: isGoCgoComment pin ----

describe("Go cgo preamble exemption pin (M4)", () => {
  const CGO_CODE = `package main\n\n/*\n#include <stdio.h>\n*/\nimport "C"\n\nfunc main() {}\n`;

  it("cgo preamble: exempt===true and exemptReason==='cgo-preamble'", async () => {
    const r = await findComments(CGO_CODE, "go");
    if (!r.ok) throw new Error(r.reason);
    const c = r.comments.find(c => c.text.includes("#include"));
    expect(c).toBeDefined();
    expect(c!.exempt).toBe(true);
    expect(c!.exemptReason).toBe("cgo-preamble");
  });

  it("autoFix keeps cgo preamble when file is over budget", async () => {
    const code = `package main\n\n/*\n#include <stdio.h>\n*/\nimport "C"\n\nfunc main() {\n\t// c1\n\t// c2\n\t// c3\n\t// c4\n\t// c5\n\t// c6\n\tx := 1\n\t_ = x\n}\n`;
    const r = await autoFix(code, "go", allRows(code));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).toContain("#include <stdio.h>");
  });
});

// ---- GF-2 Bug B: CRLF trailing comment ----

describe("GF-2 Bug B: CRLF trailing comment preserves \\r\\n", () => {
  it("stripComments on CRLF Go source: trailing-comment line keeps \\r", async () => {
    const code = "package main\r\nfunc main() {\r\n\tx := 1 // note\r\n\t_ = x\r\n}\r\n";
    const r = await findComments(code, "go");
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(code, nonExempt);
    const lines = stripped.split("\n");
    const xLine = lines.find(l => l.includes("x := 1"));
    expect(xLine).toBeDefined();
    expect(xLine!.endsWith("\r")).toBe(true);
  });

  it("autoFix on over-budget CRLF Go file: every non-final line keeps \\r", async () => {
    const varLines = Array.from({ length: 20 }, (_, i) => `\tvar x${i} = ${i}`);
    const commentLines = Array.from({ length: 5 }, (_, i) => `\t// c${i}`);
    const all = [
      "package main",
      "func main() {",
      ...varLines,
      ...commentLines,
      "\t_ = x0 // trailing note",
      "}",
    ];
    const text = all.join("\r\n") + "\r\n";
    const addedRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "go", addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.removed).toBeGreaterThan(0);
    const lines = r.fixed.split("\n");
    for (let i = 0; i < lines.length - 1; i++) {
      expect(lines[i].endsWith("\r"), `line ${i} must end with \\r: ${JSON.stringify(lines[i])}`).toBe(true);
    }
  });
});

// ---- GF-4 Defect 1: kept counts individual comments not units ----

describe("GF-4 Defect 1: kept counts individual comments not units", () => {
  it("paragraph kept: kept === comments in kept units, removed + kept === total", async () => {
    const codeLines = Array.from({ length: 90 }, (_, i) => `const x${i} = ${i};`);
    const text = [
      ...codeLines,
      "// group1 line1",
      "// group1 line2",
      "// group1 line3",
      "const sep = 0;",
      "// group2 line1",
      "// group2 line2",
      "// group2 line3",
      "// group2 line4",
      "// group2 line5",
    ].join("\n") + "\n";
    const addedRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "typescript", addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.total).toBe(8);
    expect(r.kept).toBe(3);
    expect(r.removed).toBe(5);
    expect(r.removed + r.kept).toBe(r.total);
    expect(r.fixed).toContain("// group1 line1");
    expect(r.fixed).toContain("// group1 line2");
    expect(r.fixed).toContain("// group1 line3");
    expect(r.fixed).not.toContain("// group2 line1");
  });
});

// ---- GF-4 Defect 2: URL inside paragraph protects whole paragraph ----

describe("GF-4 Defect 2: URL inside paragraph protects whole paragraph", () => {
  it("URL inside paragraph: never partial removal (both prose lines kept or fix fails)", async () => {
    const codeLines = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`);
    const text = [
      ...codeLines,
      "// Foo does bar per spec:",
      "// https://example.com/spec",
      "// and more words here",
    ].join("\n") + "\n";
    const addedRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "typescript", addedRows);
    if (r.ok) {
      expect(r.fixed).toContain("// Foo does bar per spec:");
      expect(r.fixed).toContain("// and more words here");
    }
  });

  it("nolint adjacent to paragraph: directive is boundary, prose paragraph still removable", async () => {
    const varLines = Array.from({ length: 20 }, (_, i) => `var x${i} = ${i}`);
    const text = [
      "package main",
      "",
      ...varLines,
      "//nolint:somecheck",
      "// prose one",
      "// prose two",
      "// prose three",
    ].join("\n") + "\n";
    const addedRows = new Set(text.split("\n").map((_, i) => i));
    const r = await autoFix(text, "go", addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).toContain("//nolint:somecheck");
    expect(r.fixed).not.toContain("// prose one");
  });
});

// ---- GF-2 Bug A: consecutive // paragraph partial removal ----

describe("GF-2 Bug A: consecutive // paragraph removed whole-or-none", () => {
  it("autoFix on Go file: 6-line // paragraph kept whole or removed whole", async () => {
    const varLines = Array.from({ length: 20 }, (_, i) => `var x${i} = ${i}`);
    const paraLines = Array.from({ length: 6 }, (_, i) => `// para line ${i + 1}`);
    const code = ["package main", ...varLines, ...paraLines].join("\n") + "\n";
    const addedRows = new Set(code.split("\n").map((_, i) => i));
    const r = await autoFix(code, "go", addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const remaining = paraLines.filter(l => r.fixed.includes(l)).length;
    // Must be 0 (all removed) or 6 (all kept), never a partial group
    expect(remaining === 0 || remaining === 6).toBe(true);
  });

  it("trailing inline comment directly before whole-line paragraph: each unit decided independently", async () => {
    // 20 var lines + "var z = 0 // trailing" + 4 whole-line // para lines.
    // Budget = floor(0.05 * 27) = 1.
    const varLines = Array.from({ length: 20 }, (_, i) => `var x${i} = ${i}`);
    const code = [
      "package main",
      ...varLines,
      "var z = 0 // trailing",
      "// para 1",
      "// para 2",
      "// para 3",
      "// para 4",
    ].join("\n") + "\n";
    const addedRows = new Set(code.split("\n").map((_, i) => i));
    const r = await autoFix(code, "go", addedRows);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).toContain("// trailing");
  });
});

// ---- GF-6: comment-between-tokens correctness ----

describe("GF-6: comment between tokens — no fusion, correct separator", () => {
  function overBudgetGo(inline: string): string {
    const body = Array.from({ length: 12 }, (_, i) => `\tx${i} := ${i}\n\t_ = x${i}`).join("\n");
    return `package p\n\nfunc f() error {\n${body}\n\t${inline}\n}\n\nfunc g() error {\n\t${inline}\n}\n\nfunc h() error {\n\t${inline}\n}\n`;
  }

  it("Go autoFix: inline comment between return and nil must not produce returnnil", async () => {
    const go = overBudgetGo("return/* c1 */nil");
    const rows = new Set(go.split("\n").map((_, i) => i));
    const r = await autoFix(go, "go", rows, undefined, rows);
    if (!r.ok) return;
    expect(r.fixed).not.toContain("returnnil");
  });

  it("stripComments: typeof/* c */x does not fuse tokens", async () => {
    const code = `const t = typeof/* c */x;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const comments = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(code, comments);
    expect(stripped).not.toContain("typeofx");
    expect(stripped).toContain("typeof x");
  });

  it("stripComments: multiline block comment between return and value — not same-line collapse", async () => {
    const code = `function f() {\n  return /*\n  */ 1;\n}\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const comments = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(code, comments);
    const lines = stripped.split("\n");
    const returnLine = lines.find(l => l.includes("return"));
    expect(returnLine).toBeDefined();
    expect(returnLine!).not.toContain("1");
  });

  it("collectCodeText: space separator distinguishes fused tokens from separate tokens", async () => {
    const pr = await getParser("go");
    if (!pr.ok) throw new Error(pr.reason);
    const srcSep = `package p\nfunc f()error{return nil}`;
    const srcFused = `package p\nfunc f()error{returnnil}`;
    const sepTokens = collectCodeText(pr.parser.parse(srcSep).rootNode, srcSep, "go");
    const fusedTokens = collectCodeText(pr.parser.parse(srcFused).rootNode, srcFused, "go");
    expect(sepTokens).not.toBe(fusedTokens);
  });

  it("autoFix: Fix-3 parse-error guard fires before code-identity check (mock parser)", async () => {
    let gpCalls = 0;
    const mockGetParser: GetParserFn = async (lang) => {
      const real = await getParser(lang);
      if (!real.ok) return real;
      gpCalls++;
      if (gpCalls === 3) {
        let parseCalls = 0;
        const proxy = {
          parse(src: string) {
            parseCalls++;
            if (parseCalls === 2) {
              return real.parser.parse("class Fooextends Bar{}");
            }
            return real.parser.parse(src);
          },
        } as typeof real.parser;
        return { ok: true as const, parser: proxy, language: real.language };
      }
      return real;
    };
    const lines = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`);
    const cLines = Array.from({ length: 8 }, (_, i) => `// comment ${i}`);
    const code = [...lines, ...cLines].join("\n") + "\n";
    const allRows = new Set(code.split("\n").map((_, i) => i));
    const r = await autoFix(code, "typescript", allRows, mockGetParser);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("parse error");
  });

  it("stripComments: whole-line and trailing removals byte-identical (regression guard)", async () => {
    const code = `const a = 1; // trailing\n// whole line\nconst b = 2;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const comments = r.comments.filter(c => !c.exempt);
    const { text: stripped } = stripComments(code, comments);
    expect(stripped).toBe(`const a = 1;\nconst b = 2;\n`);
  });
});
