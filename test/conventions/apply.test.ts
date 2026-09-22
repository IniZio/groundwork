import { describe, it, expect, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { apply } from "../../src/conventions/apply.js";
import type { Finding } from "../../src/conventions/detect.js";

const TMP = "/tmp/gw-apply-test";
mkdirSync(TMP, { recursive: true });
const repos: string[] = [];

function makeRepo(label: string): string {
  const dir = path.join(TMP, `${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  repos.push(dir);
  return dir;
}

function hashTree(dir: string): Map<string, string> {
  const result = new Map<string, string>();
  function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      result.set(path.relative(dir, full), readFileSync(full).toString("base64"));
    }
  }
  walk(dir);
  return result;
}

afterEach(() => {
  for (const r of repos) { try { rmSync(r, { recursive: true, force: true }); } catch { /* ok */ } }
  repos.length = 0;
});

const SAMPLE_FINDINGS: Finding[] = [
  { id: "commit-conventional", kind: "commit-style", evidence: "test", proposed_write: { path: ".gitmessage", content: "<type>: subject\n" } },
  { id: "pr-template", kind: "pr-template", evidence: "test", proposed_write: { path: ".github/pull_request_template.md", content: "## Summary\n" } },
  { id: "code-rules", kind: "code-rule", evidence: "test", proposed_write: { path: "Makefile", content: "# groundwork-rule: no-console-log\n" } },
];

describe("apply — declined run writes nothing", () => {
  it("empty accept set → seeded files unchanged, tree identical before/after", () => {
    const repo = makeRepo("declined");
    writeFileSync(path.join(repo, ".gitmessage"), "existing commit template\n");
    writeFileSync(path.join(repo, "Makefile"), ".PHONY: test\ntest:\n\techo ok\n");
    const before = hashTree(repo);
    const result = apply(repo, SAMPLE_FINDINGS, new Set());
    const after = hashTree(repo);
    expect(result.written).toHaveLength(0);
    expect(result.skipped.length).toBe(SAMPLE_FINDINGS.length);
    for (const [k, v] of before) expect(after.get(k)).toBe(v);
    for (const [k] of after) expect(before.has(k)).toBe(true);
    expect(readFileSync(path.join(repo, ".gitmessage"), "utf8")).toBe("existing commit template\n");
  });

  it("CLI with absent --accept writes nothing (porcelain-equivalent tree)", () => {
    const repo = makeRepo("cli-declined");
    writeFileSync(path.join(repo, ".gitmessage"), "existing\n");
    writeFileSync(path.join(repo, "Makefile"), "# existing\n");
    const before = hashTree(repo);
    const findingsFile = path.join(repo, "_findings.json");
    writeFileSync(findingsFile, JSON.stringify(SAMPLE_FINDINGS));
    const root = path.resolve(import.meta.dir, "../..");
    execSync(`bun src/conventions/apply.ts ${repo} --findings ${findingsFile}`, { cwd: root, encoding: "utf8" });
    const after = hashTree(repo);
    for (const [k, v] of before) {
      if (k === "_findings.json") continue;
      expect(after.get(k)).toBe(v);
    }
    expect(existsSync(path.join(repo, ".github/pull_request_template.md"))).toBe(false);
  });
});

describe("apply — only allowed paths written", () => {
  it("accepts all SAMPLE_FINDINGS → writes to .gitmessage, .github/..., Makefile", () => {
    const repo = makeRepo("allowed");
    const accept = new Set(SAMPLE_FINDINGS.map(f => f.id));
    const result = apply(repo, SAMPLE_FINDINGS, accept);
    expect(result.refused).toHaveLength(0);
    expect(result.written).toContain(".gitmessage");
    expect(result.written).toContain(".github/pull_request_template.md");
    expect(result.written).toContain("Makefile");
    expect(existsSync(path.join(repo, ".gitmessage"))).toBe(true);
  });

  it("refuses .groundwork.db — FORBIDDEN", () => {
    const repo = makeRepo("refuse-db");
    const findings: Finding[] = [
      { id: "bad", kind: "test", evidence: "test", proposed_write: { path: ".groundwork.db", content: "x" } }
    ];
    const result = apply(repo, findings, new Set(["bad"]));
    expect(result.refused.length).toBeGreaterThan(0);
    expect(result.refused[0]).toMatch(/FORBIDDEN/);
    expect(existsSync(path.join(repo, ".groundwork.db"))).toBe(false);
  });

  it("refuses .groundwork/ subpath — FORBIDDEN", () => {
    const repo = makeRepo("refuse-gw");
    const findings: Finding[] = [
      { id: "bad2", kind: "test", evidence: "test", proposed_write: { path: ".groundwork/secrets.md", content: "x" } }
    ];
    const result = apply(repo, findings, new Set(["bad2"]));
    expect(result.refused.length).toBeGreaterThan(0);
    expect(existsSync(path.join(repo, ".groundwork/secrets.md"))).toBe(false);
  });

  it("refuses arbitrary path not in allowed set", () => {
    const repo = makeRepo("refuse-arb");
    const findings: Finding[] = [
      { id: "bad3", kind: "test", evidence: "test", proposed_write: { path: "src/injected.ts", content: "x" } }
    ];
    const result = apply(repo, findings, new Set(["bad3"]));
    expect(result.refused.length).toBeGreaterThan(0);
  });

  it("allows CLAUDE.md only when fallback:true", () => {
    const repo = makeRepo("fallback");
    const findings: Finding[] = [
      { id: "f1", kind: "test", evidence: "test", fallback: true, proposed_write: { path: "CLAUDE.md", content: "# rules\n" } }
    ];
    const result = apply(repo, findings, new Set(["f1"]));
    expect(result.refused).toHaveLength(0);
    expect(result.written).toContain("CLAUDE.md");
  });

  it("refuses CLAUDE.md when fallback not set", () => {
    const repo = makeRepo("no-fallback");
    const findings: Finding[] = [
      { id: "f2", kind: "test", evidence: "test", proposed_write: { path: "CLAUDE.md", content: "# rules\n" } }
    ];
    const result = apply(repo, findings, new Set(["f2"]));
    expect(result.refused.length).toBeGreaterThan(0);
  });
});

describe("apply — handbook sibling path", () => {
  it("../hb/x.md with --handbook <sibling> is written", () => {
    const repo = makeRepo("hb-allowed");
    const hb = makeRepo("hb-sibling");
    const hbRelPath = path.relative(repo, path.join(hb, "x.md"));
    const findings: Finding[] = [
      { id: "hb1", kind: "test", evidence: "test", proposed_write: { path: hbRelPath, content: "# page\n" } }
    ];
    const result = apply(repo, findings, new Set(["hb1"]), hb);
    expect(result.refused).toHaveLength(0);
    expect(result.written).toContain(hbRelPath);
    expect(existsSync(path.join(hb, "x.md"))).toBe(true);
  });

  it("../hb/x.md without --handbook is refused, nothing written", () => {
    const repo = makeRepo("hb-no-hb");
    const hb = makeRepo("hb-no-hb-sib");
    const hbRelPath = path.relative(repo, path.join(hb, "x.md"));
    const findings: Finding[] = [
      { id: "hb2", kind: "test", evidence: "test", proposed_write: { path: hbRelPath, content: "# page\n" } }
    ];
    const result = apply(repo, findings, new Set(["hb2"]));
    expect(result.refused.length).toBeGreaterThan(0);
    expect(existsSync(path.join(hb, "x.md"))).toBe(false);
  });

  it("with --handbook <hb>, ../elsewhere/x.md is refused", () => {
    const repo = makeRepo("hb-elsewhere-repo");
    const hb = makeRepo("hb-elsewhere-hb");
    const elsewhere = makeRepo("hb-elsewhere-else");
    const elseRelPath = path.relative(repo, path.join(elsewhere, "x.md"));
    const findings: Finding[] = [
      { id: "hb3", kind: "test", evidence: "test", proposed_write: { path: elseRelPath, content: "x" } }
    ];
    const result = apply(repo, findings, new Set(["hb3"]), hb);
    expect(result.refused.length).toBeGreaterThan(0);
    expect(existsSync(path.join(elsewhere, "x.md"))).toBe(false);
  });
});

describe("apply — path traversal is refused, nothing written", () => {
  it("refuses .claude/rules/../../../x with fallback:true", () => {
    const repo = makeRepo("traversal-fallback");
    const findings: Finding[] = [
      { id: "t1", kind: "test", evidence: "test", fallback: true, proposed_write: { path: ".claude/rules/../../../x", content: "x" } }
    ];
    const result = apply(repo, findings, new Set(["t1"]));
    expect(result.refused.length).toBeGreaterThan(0);
    expect(existsSync(path.join(path.dirname(repo), "x"))).toBe(false);
  });

  it("refuses .claude/rules/../../.groundwork/x with fallback:true", () => {
    const repo = makeRepo("traversal-gw");
    const findings: Finding[] = [
      { id: "t2", kind: "test", evidence: "test", fallback: true, proposed_write: { path: ".claude/rules/../../.groundwork/x", content: "x" } }
    ];
    const result = apply(repo, findings, new Set(["t2"]));
    expect(result.refused.length).toBeGreaterThan(0);
    expect(existsSync(path.join(repo, ".groundwork/x"))).toBe(false);
  });
});
