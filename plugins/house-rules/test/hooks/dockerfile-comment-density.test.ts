/**
 * Dockerfile comment-density autofix (stable) — rule/autofix-level tests.
 *
 * Kept: leading parser directives (syntax/escape/check, consecutive from row 0),
 *       hadolint/checkov markers, # inside heredoc bodies and quoted values.
 * Stripped: over-budget prose, including whole comment lines inside a
 *       backslash- or backtick-continued RUN (continuation stays intact).
 */
import { describe, it, expect } from "bun:test";
import { autoFix } from "../../src/hooks/lib/comment-density.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";

function prose(n: number): string {
  return Array.from({ length: n }, (_, i) => `# removable prose ${i} here`).join("\n");
}
function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}
async function fix(text: string): Promise<string> {
  const r = await autoFix(text, "dockerfile", allRows(text));
  if (!r.ok) throw new Error(r.reason);
  return r.fixed;
}

describe("fixEntryFor(dockerfile)", () => {
  it("stability === stable", () => {
    expect(fixEntryFor("dockerfile").stability).toBe("stable");
  });
});

describe("dockerfile per-edit autofix strips over-budget prose", () => {
  const src = `FROM alpine\nRUN echo hi\n\n${prose(20)}\n`;
  it("prose removed, instructions kept", async () => {
    const out = await fix(src);
    expect(out).not.toContain("# removable prose");
    expect(out).toContain("FROM alpine\nRUN echo hi\n");
  });
});

describe("dockerfile parser directives", () => {
  const body = `FROM alpine\nRUN echo hi\n\n${prose(20)}\n`;
  it("syntax + check on consecutive leading rows both kept", async () => {
    const head = "# syntax=docker/dockerfile:1\n# check=skip=JSONArgsRecommended\n";
    const out = await fix(head + body);
    expect(out.startsWith(head + "FROM alpine")).toBe(true);
    expect(out).not.toContain("# removable prose");
  });
  it("check= alone at row 0 kept", async () => {
    const out = await fix("# check=error=true\n" + body);
    expect(out.split("\n")[0]).toBe("# check=error=true");
  });
  it("escape=` file: directive kept, top-level prose stripped", async () => {
    const src = "# escape=`\nFROM mcr.microsoft.com/windows/servercore\nRUN echo a\n\n" + prose(20) + "\n";
    const out = await fix(src);
    expect(out.split("\n")[0]).toBe("# escape=`");
    expect(out).toContain("RUN echo a\n");
    expect(out).not.toContain("# removable prose");
  });
  it("escape=` file with comment lines inside a backtick continuation never corrupts (fails closed)", async () => {
    const src =
      "# escape=`\nFROM mcr.microsoft.com/windows/servercore\nRUN echo a `\n    # inner prose one here\n    && echo b `\n    && echo c\n\n" +
      prose(20) + "\n";
    const r = await autoFix(src, "dockerfile", allRows(src));
    if (r.ok) {
      expect(r.fixed).toContain("RUN echo a `\n    && echo b `\n    && echo c\n");
      expect(r.fixed.split("\n")[0]).toBe("# escape=`");
    }
  });
  it("directive-looking comment after the first non-directive line is not kept", async () => {
    const src = `# syntax=docker/dockerfile:1\n# ordinary note about things\n# check=skip=X\nFROM alpine\n${prose(20)}\n`;
    const out = await fix(src);
    expect(out.split("\n")[0]).toBe("# syntax=docker/dockerfile:1");
    expect(out).not.toContain("# check=skip=X");
    expect(out).not.toContain("# ordinary note");
  });
  it("syntax= after FROM is not kept", async () => {
    const src = `FROM alpine\n# syntax=late\nRUN echo hi\n${prose(20)}\n`;
    expect(await fix(src)).not.toContain("# syntax=late");
  });
});

describe("dockerfile lint markers", () => {
  it("hadolint ignore/global/shell and checkov:skip survive", async () => {
    const keep = [
      "# hadolint ignore=DL3008",
      "# hadolint global ignored=DL3059",
      "# hadolint shell=/bin/bash",
      "# checkov:skip=CKV_DOCKER_2:no healthcheck",
    ];
    const src = `FROM alpine\n${keep.join("\nRUN echo hi\n")}\nRUN echo bye\n${prose(20)}\n`;
    const out = await fix(src);
    for (const k of keep) expect(out).toContain(k);
    expect(out).not.toContain("# removable prose");
  });
  it("hadolint marker survives, neighbouring prose goes", async () => {
    const src = `FROM alpine\n# prose next to a marker\n# hadolint ignore=DL3008\nRUN apt-get install foo\n${prose(20)}\n`;
    const out = await fix(src);
    expect(out).toContain("# hadolint ignore=DL3008");
    expect(out).not.toContain("# prose next to a marker");
  });
});

describe("dockerfile continuation comments", () => {
  it("comment lines inside a \\ continuation are removed without joining lines", async () => {
    const src =
      "FROM alpine\nRUN apk add \\\n    # inner prose one here\n    curl \\\n    # inner prose two here\n    wget\n\n" +
      prose(20) + "\n";
    const out = await fix(src);
    expect(out).toContain("RUN apk add \\\n    curl \\\n    wget\n");
    expect(out).not.toContain("inner prose");
  });
});

describe("dockerfile # that is not a comment", () => {
  it("heredoc body lines and quoted values are untouched", async () => {
    const heredoc = "RUN <<EOF\n# heredoc shell comment one\necho hi\n# heredoc shell comment two\nEOF\n";
    const env = 'ENV A="x # not a comment"\nRUN echo \'# nope\'\n';
    const out = await fix(`FROM alpine\n${heredoc}${env}\n${prose(20)}\n`);
    expect(out).toContain(heredoc);
    expect(out).toContain(env);
    expect(out).not.toContain("# removable prose");
  });
});

describe("dockerfile under-budget content passes through", () => {
  it("unchanged", async () => {
    const src = `FROM alpine\n# one note\n${Array.from({ length: 40 }, (_, i) => `RUN echo ${i}`).join("\n")}\n`;
    expect(await fix(src)).toBe(src);
  });
});
