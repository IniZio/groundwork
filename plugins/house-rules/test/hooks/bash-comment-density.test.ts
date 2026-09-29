/**
 * Bash comment-density rule/autofix-level tests.
 *
 * Covers:
 *   fixEntryFor("bash").stability === "stable"
 *   autoFix strips over-budget prose comments, code survives byte-identical, no lines joined
 *   Never stripped: shebang, `# shellcheck`, vim/emacs modelines,
 *                   '#' in heredoc bodies (<<EOF, <<-'EOF'), quoted strings,
 *                   ${var#prefix}, ${#arr[@]}, $#, case patterns
 *   Stripped output passes `bash -n`
 *   Under-budget bash passes through unchanged
 */
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { autoFix } from "../../src/hooks/lib/comment-density.js";
import { fixEntryFor } from "../../rules/comment-density/languages.js";
import { languageForPath } from "../../src/hooks/languages/registry.js";

function removableBlock(n: number): string {
  return Array.from({ length: n }, (_, i) => `# prose comment ${i} that is removable`).join("\n");
}

function allRows(text: string): Set<number> {
  return new Set(text.split("\n").map((_, i) => i));
}

async function fix(text: string): Promise<string> {
  const r = await autoFix(text, "bash", allRows(text));
  if (!r.ok) throw new Error(r.reason);
  return r.fixed;
}

function bashN(src: string): { status: number | null; stderr: string } {
  const r = spawnSync("bash", ["-n"], { input: src, encoding: "utf8" });
  return { status: r.status, stderr: r.stderr };
}

describe("fixEntryFor(bash) is stable", () => {
  it("stability === stable", () => {
    expect(fixEntryFor("bash").stability).toBe("stable");
  });
});

describe("language detection reaches bash", () => {
  it(".sh and .bash", () => {
    expect(languageForPath("/x/a.sh")).toBe("bash");
    expect(languageForPath("/x/a.bash")).toBe("bash");
  });
  it("extensionless with a shebang first line", () => {
    expect(languageForPath("/x/commit-msg", "#!/bin/bash")).toBe("bash");
    expect(languageForPath("/x/run", "#!/usr/bin/env bash")).toBe("bash");
    expect(languageForPath("/x/run")).toBeNull();
  });
});

describe("autoFix(bash): over-budget prose removed, code survives", () => {
  const CODE = ["set -euo pipefail", 'echo "hello"', "ls -la", 'name="world"', "exit 0"];
  const src = ["#!/usr/bin/env bash", ...CODE, "", removableBlock(30), ""].join("\n");

  it("prose gone, every code line kept in order, nothing joined", async () => {
    const out = await fix(src);
    expect(out).not.toContain("removable");
    const lines = out.split("\n");
    expect(lines.filter((l) => l !== "")).toEqual(["#!/usr/bin/env bash", ...CODE]);
    expect(bashN(out).status).toBe(0);
  });
});

describe("autoFix(bash): directives never stripped", () => {
  const src = [
    "#!/bin/bash",
    "# shellcheck disable=SC2086",
    "# shellcheck source=lib/common.sh",
    "# vim: set ts=2 sw=2 et :",
    "# -*- mode: sh -*-",
    ...Array.from({ length: 12 }, (_, i) => `v${i}=${i}`),
    removableBlock(12),
    "echo done",
    "",
  ].join("\n");

  it("shebang, shellcheck, modelines survive; prose removed", async () => {
    const out = await fix(src);
    const hashLines = out.split("\n").filter((l) => l.startsWith("#"));
    expect(hashLines).toEqual([
      "#!/bin/bash",
      "# shellcheck disable=SC2086",
      "# shellcheck source=lib/common.sh",
      "# vim: set ts=2 sw=2 et :",
      "# -*- mode: sh -*-",
    ]);
    expect(bashN(out).status).toBe(0);
  });
});

describe("autoFix(bash): '#' in non-comment positions never stripped", () => {
  const HAZARDS = [
    'echo "${1#*/}"',
    'echo "${#arr[@]}"',
    'echo "argc=$#"',
    `printf '%s # %s' a b`,
    'echo "a # not a comment"',
    "echo foo#bar",
    "case \"$1\" in",
    "  '#') echo literal ;;",
    "  \\#*) echo escaped ;;",
    "esac",
    "cat > out.json <<'EOF'",
    "# heredoc data one",
    "{}",
    "# heredoc data two",
    "EOF",
    "cat <<-'EOT'",
    "\t# tab heredoc data",
    "\tEOT",
    "cat <<UNQ",
    "# unquoted heredoc data ${x:-y}",
    "UNQ",
  ];
  const src = ["#!/bin/bash", "arr=(a b)", "set -- x", ...HAZARDS, removableBlock(30), ""].join("\n");

  it("every hazard line byte-identical and in order; prose removed", async () => {
    const out = await fix(src);
    expect(out).not.toContain("removable");
    const lines = out.split("\n");
    const start = lines.indexOf(HAZARDS[0]);
    expect(start).toBeGreaterThan(0);
    expect(lines.slice(start, start + HAZARDS.length)).toEqual(HAZARDS);
    expect(bashN(out).status).toBe(0);
  });
});

describe("autoFix(bash): inline trailing comments", () => {
  const src = [
    "#!/bin/bash",
    'a=1 # trailing prose one',
    'b=2 # trailing prose two',
    'c=3 # trailing prose three',
    'd=4 # trailing prose four',
    "e=5",
    "",
  ].join("\n");

  it("code kept, lines not joined, bash -n ok", async () => {
    const out = await fix(src);
    const lines = out.split("\n").map((l) => l.trimEnd());
    for (const c of ["a=1", "b=2", "c=3", "d=4", "e=5"]) expect(lines).toContain(c);
    expect(lines.length).toBe(src.split("\n").length);
    expect(bashN(out).status).toBe(0);
  });
});

describe("autoFix(bash): under-budget is unchanged", () => {
  const src = ["#!/bin/bash", "# one small note", ...Array.from({ length: 40 }, (_, i) => `v${i}=${i}`), ""].join("\n");
  it("identity", async () => {
    expect(await fix(src)).toBe(src);
  });
});

describe("autoFix(bash): only added rows are candidates", () => {
  const src = ["#!/bin/bash", "x=1", removableBlock(20), "y=2", ""].join("\n");
  it("no added rows -> comments kept", async () => {
    const r = await autoFix(src, "bash", new Set());
    if (!r.ok) throw new Error(r.reason);
    expect(r.fixed).toBe(src);
  });
});
