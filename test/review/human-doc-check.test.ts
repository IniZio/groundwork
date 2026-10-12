import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const SCRIPT = path.join(ROOT, "src/review/human-doc-check.ts");
const TPL = path.join(ROOT, "templates/doc-types");
const tmp = mkdtempSync(path.join(tmpdir(), "hdc-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const env = { ...process.env } as Record<string, string>;
delete env.CLAUDE_PROJECT_DIR;

function run(file: string) {
  return spawnSync("bun", [SCRIPT, file], { encoding: "utf8", env });
}
const tpl = (name: string) => readFileSync(path.join(TPL, name), "utf8");
const SUM = "## Summary\n\nOne sentence.\n\n";
let seq = 0;
function write(name: string, content: string) {
  const dir = path.join(tmp, String(seq++));
  mkdirSync(dir);
  const p = path.join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("human-doc-check", () => {
  test("dirty pr body flags baseline claim and code-blocked path", () => {
    const doc = tpl("pr-body.md").replace(
      "## Proof",
      "Ran make lint and all tests pass. The parser lives in `src/foo.ts` now.\n\n## Proof",
    );
    const r = run(write("dirty.md", doc));
    expect(r.status).toBe(1);
    const lines = r.stdout.split("\n");
    expect(lines).toContain('- "Ran make lint and all tests pass." — states the CI baseline');
    expect(lines).toContain('- "src/foo.ts" — code-blocked path; use a commit-pinned GitHub permalink');
    expect(lines.filter((l) => l.startsWith("- ")).length).toBe(2);
  });

  test("agent-only heading is flagged", () => {
    const doc = tpl("pr-body.md").replace("## Proof", "## Files\n\nstuff\n\n## Proof");
    const r = run(write("heading.md", doc));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('- "## Files" — agent-only content');
  });

  test("path inside a non-mermaid fence is flagged", () => {
    const r = run(write("fence.md", "## What\n\n```\nsrc/foo/bar.ts\n```\n"));
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('- "src/foo/bar.ts" — code-blocked path');
  });

  for (const name of ["pr-body.md"]) {
    test(`clean template ${name} passes`, () => {
      const r = run(write("pr-body.md", SUM + tpl(name)));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });
  }

  describe("pr-body prose length", () => {
    const OVER13 = "pr-body prose 13 lines > 12 (Why, Changes, Impact; headings, fenced blocks and tables excluded)";
    const prose = (n: number) =>
      "## Changes\n\n" + Array.from({ length: n }, (_, i) => `Line ${i + 1} of prose.`).join("\n");
    const fenced = "```ts\n" + Array.from({ length: 30 }, (_, i) => `const a${i} = ${i};`).join("\n") + "\n```";

    test("12 prose lines plus a 30-line fenced block passes", () => {
      const r = run(write("pr-body.md", SUM + `${prose(12)}\n\n${fenced}\n`));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });

    test("13 prose lines is flagged", () => {
      const r = run(write("pr-body.md", SUM + `${prose(13)}\n`));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(OVER13);
    });

    const table =
      "| Decision | Constraint |\n| --- | --- |\n" +
      Array.from({ length: 10 }, (_, i) => `| d${i} | c${i} |`).join("\n");
    const pipeFence = "```\n| a | b |\n| c | d |\n| e | f |\n```";

    test("12 prose lines plus a 10-row table passes", () => {
      const r = run(write("pr-body.md", SUM + `${prose(12)}\n\n${table}\n`));
      expect(r.stdout).not.toContain("pr-body prose");
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });

    test("13 prose lines plus a table is flagged at 13", () => {
      const r = run(write("pr-body.md", SUM + `${prose(13)}\n\n${table}\n`));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(OVER13);
    });

    test("pipe lines inside a fence are not counted", () => {
      const ok = run(write("pr-body.md", SUM + `${prose(12)}\n\n${pipeFence}\n`));
      expect(ok.stdout.trim()).toBe("PASS");
      expect(ok.status).toBe(0);
      const over = run(write("pr-body.md", SUM + `${prose(13)}\n\n${pipeFence}\n`));
      expect(over.status).toBe(1);
      expect(over.stdout).toContain(OVER13);
    });

    const argument = (n: number) => {
      const why = Array.from({ length: 4 }, (_, i) => `- Why claim ${i + 1}.`);
      const impact = Array.from({ length: 4 }, (_, i) => `- Impact claim ${i + 1}.`);
      const changes = Array.from({ length: n - 8 }, (_, i) => `Changes line ${i + 1}.`);
      return `## Why\n\n${why.join("\n")}\n\n## Changes\n\n${changes.join("\n")}\n\n## Impact\n\n${impact.join("\n")}\n`;
    };
    const focus = (n: number) => Array.from({ length: n }, (_, i) => `- https://example.com/blob/abc/f${i}#L1 focus ${i}`).join("\n");

    test("12 argument lines plus Review focus and Proof lines pass", () => {
      const proof = "- Proof one.\n- Proof two.\n- Proof three.";
      const r = run(write("pr-body.md", SUM + `${argument(12)}\n## Review focus\n\n${focus(5)}\n\n## Proof\n\n${proof}\n`));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });

    test("13 argument lines are flagged, quoting the 13th argument line", () => {
      const r = run(write("pr-body.md", SUM + `${argument(13)}\n## Review focus\n\n${focus(5)}\n`));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('- "- Impact claim 4." — pr-body prose 13 lines > 12 (Why, Changes, Impact; headings, fenced blocks and tables excluded)');
    });

    test("30 lines only in Review focus pass", () => {
      const r = run(write("pr-body.md", SUM + `## Why\n\n- A claim.\n\n## Changes\n\nOne line.\n\n## Impact\n\n- Another claim.\n\n## Review focus\n\n${focus(30)}\n`));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });

    test("13 prose lines in a file not named pr-body.md is not flagged", () => {
      const r = run(write("notes.md", `${prose(13)}\n`));
      expect(r.stdout).not.toContain("pr-body prose");
      expect(r.status).toBe(0);
    });

    test("real template copied to pr-body.md passes", () => {
      const r = run(write("pr-body.md", SUM + tpl("pr-body.md")));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });
  });

  describe("pr-body v3 rules", () => {
    const out = (doc: string) => run(write("pr-body.md", SUM + doc)).stdout.split("\n");
    const pass = (doc: string) => {
      const r = run(write("pr-body.md", SUM + doc));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    };

    test("headings are excluded from the prose count", () => {
      const prose = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of prose.`).join("\n");
      pass(`## Changes\n\n### B\n\n#### C\n\n${prose}\n\n## D\n`);
      const r = run(write("pr-body.md", SUM + `## Changes\n\n${prose}\nLine 13 of prose.\n`));
      expect(r.stdout).toContain('- "Line 13 of prose." — pr-body prose 13 lines > 12 (Why, Changes, Impact; headings, fenced blocks and tables excluded)');
    });

    test("Why and Impact need one bullet per claim", () => {
      pass("## Why\n\n- Some line.\n\n## Impact\n\n- Other line.\n");
      expect(out("## Why\n\nSome line.\n")).toContain('- "Some line." — pr-body Why: use one bullet per claim');
      expect(out("## Impact\n\n- Ok.\nLoose line.\n")).toContain('- "Loose line." — pr-body Impact: use one bullet per claim');
      expect(out("## Why\n\n### Sub\n\nNot bullet.\n")).toContain('- "Not bullet." — pr-body Why: use one bullet per claim');
      pass("## Changes\n\nFree prose here.\n");
    });

    test("colon and semicolon joined clauses are flagged", () => {
      const reason = "split ':'/';' joined clauses into separate bullets";
      expect(out("## Why\n\n- Two claims; one bullet.\n")).toContain(`- "- Two claims; one bullet." — pr-body Why: ${reason}`);
      expect(out("## Impact\n\n- Breaks: the parser.\n")).toContain(`- "- Breaks: the parser." — pr-body Impact: ${reason}`);
      expect(out("## Impact\n\n- Breaks:\n")).toContain(`- "- Breaks:" — pr-body Impact: ${reason}`);
      pass("## Why\n\n- Runs `a: b; c` fine.\n");
      pass("## Why\n\n- See https://example.com:8080/x for more.\n");
      pass("## Why\n\n- **Label:** one claim only.\n");
    });

    test("visual directly after a heading needs a lead sentence", () => {
      pass("### Area\n\nLead sentence.\n\n```diff\n- a\n+ b\n```\n\n### Rows\n\nLead.\n\n| a | b |\n| - | - |\n");
      expect(out("### Area\n\n```diff\n- a\n+ b\n```\n")).toContain('- "```diff" — pr-body: add a lead sentence before this visual');
      expect(out("### Rows\n\n| a | b |\n| - | - |\n| c | d |\n")).toContain('- "| a | b |" — pr-body: add a lead sentence before this visual');
    });
  });

  describe("PH-6b rules", () => {
    const lines = (r: { stdout: string }) => r.stdout.split("\n");
    const passes = (file: string) => {
      const r = run(file);
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    };
    const flags = (file: string, finding: string) => {
      const r = run(file);
      expect(r.status).toBe(1);
      expect(lines(r)).toContain(finding);
      return r;
    };
    const MISSING = (q: string) => `- "${q}" — pr-body: start with ## Summary`;
    const REFLINK = (q: string) => `- "${q}" — pr-body: file reference must be a rendered link`;
    const VOCAB = (m: string) =>
      `- "${m}" — groundwork vocabulary "${m}": write from the reviewer's view of the repo`;

    test("Summary missing: first heading is quoted", () => {
      const r = flags(write("pr-body.md", "## Why\n\n- A claim.\n"), MISSING("## Why"));
      expect(lines(r).filter((l) => l.startsWith("- "))).toEqual([MISSING("## Why")]);
    });
    test("Summary missing with no heading quotes empty", () => {
      flags(write("pr-body.md", "Just prose.\n"), MISSING(""));
    });
    test("Summary first passes", () => {
      passes(write("pr-body.md", "## Summary\n\nOne sentence.\n\n## Why\n\n- A claim.\n"));
    });
    test("pr/ directory segment marks a pr body", () => {
      const dir = path.join(tmp, String(seq++), "pr");
      mkdirSync(dir, { recursive: true });
      const p = path.join(dir, "01-x.md");
      writeFileSync(p, "## Why\n\n- A claim.\n");
      flags(p, MISSING("## Why"));
    });
    test("non-pr-body md without Summary is not flagged", () => {
      passes(write("notes.md", "## Why\n\n- A claim.\n"));
    });

    test("Summary with 4 sentences is flagged with joined prose", () => {
      const prose = "One. Two. Three. Four.";
      flags(
        write("pr-body.md", `## Summary\n\nOne. Two.\nThree. Four.\n`),
        `- "${prose}" — pr-body Summary: 1-3 sentences`,
      );
    });
    test("Summary with 3 sentences passes", () => {
      passes(write("pr-body.md", "## Summary\n\nOne. Two! Three?\n"));
    });
    test("Summary with no prose is flagged", () => {
      const r = run(write("pr-body.md", "## Summary\n\n## Why\n\n- A claim.\n"));
      expect(r.status).toBe(1);
      expect(lines(r)).toContain('- "" — pr-body Summary: 1-3 sentences');
    });

    test("bare path:line is flagged", () => {
      flags(write("pr-body.md", SUM + "## Changes\n\nSee src/a.ts:12 for it.\n"), REFLINK("src/a.ts:12"));
    });
    test("path@sha:line is flagged", () => {
      flags(write("pr-body.md", SUM + "## Changes\n\nSee src/a.ts@abc1234:12 for it.\n"), REFLINK("src/a.ts@abc1234:12"));
    });
    test("backticked path is flagged as a reference", () => {
      const r = flags(write("pr-body.md", SUM + "## Changes\n\nThe parser lives in `src/foo.ts` now.\n"), REFLINK("src/foo.ts"));
      expect(lines(r)).toContain('- "src/foo.ts" — code-blocked path; use a commit-pinned GitHub permalink');
    });
    test("rendered link file reference passes", () => {
      passes(
        write(
          "pr-body.md",
          SUM + "## Changes\n\nSee [src/a.ts:12](https://github.com/o/r/blob/abc1234/src/a.ts#L12) for it.\n",
        ),
      );
    });

    test("vocabulary in a pr body is flagged", () => {
      flags(write("pr-body.md", SUM + "## Changes\n\nWrites a ledger entry.\n"), VOCAB("ledger"));
    });
    test("vocabulary in a non-pr file is flagged", () => {
      flags(write("README.md", "# Readme\n\nSee the DECISION event for details.\n"), VOCAB("DECISION event"));
      flags(write("README.md", "# Readme\n\nPlans live in slice PH-6 now.\n"), VOCAB("PH-6"));
      flags(write("README.md", "# Readme\n\nRuns the stop-gate hook.\n"), VOCAB("stop-gate"));
    });
    test("plain prose passes vocabulary check", () => {
      passes(write("README.md", "# Readme\n\nPlain description of the parser.\n"));
    });
    test("SHA-256, UTF-8, ISO-8601 and bare gate do not flag", () => {
      passes(write("README.md", "# Readme\n\nUses SHA-256, UTF-8 and ISO-8601. The gate opens.\n"));
    });
    test("vocabulary inside a fenced block does not flag", () => {
      passes(write("README.md", "# Readme\n\n```\nledger motive DECISION event\n```\n"));
    });

    test("link into .groundwork/ is flagged", () => {
      flags(
        write("README.md", "# Readme\n\nSee [notes](.groundwork/work/x.md) here.\n"),
        '- ".groundwork/work/x.md" — link into .groundwork/: state the constraint in one line instead',
      );
      flags(
        write("README.md", "# Readme\n\nSee [notes](../../.groundwork/work/x.md) here.\n"),
        '- "../../.groundwork/work/x.md" — link into .groundwork/: state the constraint in one line instead',
      );
    });
    test("link to a normal target passes", () => {
      passes(write("README.md", "# Readme\n\nSee [notes](docs/x.md) here.\n"));
    });

    test("real pr-body template checked by path: passes with no findings", () => {
      const r = run(path.join(TPL, "pr-body.md"));
      expect(r.status).toBe(0);
      const found = lines(r).filter((l) => l.startsWith("- "));
      expect(found).toEqual([]);
    });
  });

  describe("path detection", () => {
    const found = (body: string) => run(write("p.md", body)).stdout.split("\n").filter((l) => l.startsWith("- "));
    test("extensionless non-existent token like `moor/1` is not a path", () => {
      expect(found("## What\n\nSee `moor/1` for details.\n")).toEqual([]);
    });
    test("token with file extension is a path", () => {
      expect(found("## What\n\nSee `src/foo.ts` now.\n")).toEqual([
        '- "src/foo.ts" — code-blocked path; use a commit-pinned GitHub permalink',
      ]);
    });
    test("existing extensionless path is a path", () => {
      expect(found("## What\n\nSee `src/cli` now.\n")).toEqual([
        '- "src/cli" — code-blocked path; use a commit-pinned GitHub permalink',
      ]);
    });
  });

  describe("glossary-aware vocabulary", () => {
    const VOCAB = (m: string) =>
      `- "${m}" — groundwork vocabulary "${m}": write from the reviewer's view of the repo`;
    function repoDoc(doc: string, glossary?: string, name = "a.md") {
      const repo = path.join(tmp, String(seq++));
      mkdirSync(path.join(repo, ".git"), { recursive: true });
      mkdirSync(path.join(repo, "doc"));
      if (glossary !== undefined) writeFileSync(path.join(repo, "GLOSSARY.md"), glossary);
      const p = path.join(repo, "doc", name);
      writeFileSync(p, doc);
      return p;
    }
    const finds = (r: { stdout: string }) => r.stdout.split("\n").filter((l) => l.startsWith("- "));
    const MOTIVE_DOC = "Each motive groups slices.\n";

    test("term defined in repo GLOSSARY.md is not flagged", () => {
      const r = run(repoDoc(MOTIVE_DOC, "**Motive**:\nA unit of intent.\n"));
      expect(r.stdout.trim()).toBe("PASS");
      expect(r.status).toBe(0);
    });
    test("same doc in a repo without GLOSSARY.md flags motive", () => {
      const r = run(repoDoc(MOTIVE_DOC));
      expect(finds(r)).toEqual([VOCAB("motive")]);
      expect(r.status).toBe(1);
    });
    test("glossary defining only another term still flags motive", () => {
      const r = run(repoDoc(MOTIVE_DOC, "**Slice**:\nA piece.\n"));
      expect(finds(r)).toEqual([VOCAB("motive")]);
      expect(r.status).toBe(1);
    });
    test("_Avoid_ line is not a glossary term", () => {
      const r = run(repoDoc("Read the ledger.\n", "**Motive**:\nIntent.\n_Avoid_: Ledger\n"));
      expect(finds(r)).toEqual([VOCAB("ledger")]);
      expect(r.status).toBe(1);
    });
    test("inline code span and table rows are not flagged without a glossary", () => {
      const code = run(repoDoc("Run `gw gate approve` for the `motive`.\n"));
      expect(code.stdout.trim()).toBe("PASS");
      expect(code.status).toBe(0);
      const table = run(repoDoc("The columns below.\n\n| motive | ledger |\n|---|---|\n| a | b |\n"));
      expect(table.stdout.trim()).toBe("PASS");
      expect(table.status).toBe(0);
    });
    test("glossary with Motive does not exempt H2", () => {
      const r = run(repoDoc("Approve the H2 spec.\n", "**Motive**:\nIntent.\n"));
      expect(finds(r)).toEqual([VOCAB("H2")]);
      expect(r.status).toBe(1);
    });
    test("multiple files: per-file PASS and findings, exit 1", () => {
      const good = repoDoc("Plain text.\n", undefined, "good.md");
      const bad = repoDoc(MOTIVE_DOC, undefined, "bad.md");
      const r = spawnSync("bun", [SCRIPT, good, bad], { encoding: "utf8", env });
      const out = r.stdout.split("\n");
      expect(out).toContain(`${good}: PASS`);
      expect(out.indexOf(`${bad}:`)).toBeGreaterThanOrEqual(0);
      expect(out[out.indexOf(`${bad}:`) + 1]).toBe(VOCAB("motive"));
      expect(r.status).toBe(1);
    });
  });

  test("missing arg and unreadable file exit 2", () => {
    expect(spawnSync("bun", [SCRIPT], { encoding: "utf8", env }).status).toBe(2);
    expect(run(path.join(tmp, "nope.md")).status).toBe(2);
  });
});
