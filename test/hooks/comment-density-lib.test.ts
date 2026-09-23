import { describe, it, expect } from "bun:test";
import path from "node:path";
import {
  detectLanguage,
  findComments,
  reconstructPostEdit,
  newComments,
  stripComments,
  density,
  type Lang,
  type GetParserFn,
} from "../../src/hooks/lib/comment-density.js";
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
    const stripped = stripComments(code, nonExempt);
    expect(stripped).toBe(`const a = 1;\nconst b = 2;\n`);
  });

  it("removes trailing comment, keeps code byte-exact", async () => {
    const code = `const x = 1; // trailing comment\nconst y = 2;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const stripped = stripComments(code, nonExempt);
    expect(stripped).toBe(`const x = 1;\nconst y = 2;\n`);
  });

  it("removes block comment (multi-line)", async () => {
    const code = `const a = 1;\n/* block\n   comment */\nconst b = 2;\n`;
    const r = await findComments(code, "typescript");
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const stripped = stripComments(code, nonExempt);
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
      const stripped = stripComments(code, nonExempt);
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
    const stripped = stripComments(text, nonExempt);
    const strippedLines = stripped.split("\n");

    expect(strippedLines).toContain(line292);
    expect(strippedLines).toContain(line672);
  });

  it("stripped probe.sh re-parses cleanly", async () => {
    const text = await Bun.file(path.join(PROBE_DIR, "probe.sh")).text();
    const r = await findComments(text, "bash");
    if (!r.ok) throw new Error(r.reason);
    const nonExempt = r.comments.filter(c => !c.exempt);
    const stripped = stripComments(text, nonExempt);
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
