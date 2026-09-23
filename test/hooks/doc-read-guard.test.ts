/**
 * test/hooks/doc-read-guard.test.ts
 *
 * AC map:
 *   AC 2  — full Read (no offset/limit) of over-budget doc-class → deny; hint names Grep + Read offset/limit
 *   AC 2b — Read with offset or limit → always allow (progressive-disclosure path)
 *   AC 3  — Bash cat/head/less of over-budget doc-class → deny; same hint
 *   AC 4  — Grep/Edit/Write/MultiEdit never denied
 *   AC 6  — fail-open on any error
 *   Bite  — within-budget → allow; over-budget → deny (proves threshold)
 *   Subprocess — hook spawned by path (bun <path>) matches plugin.json invocation; deny JSON on stdout
 *   Hint-clean — no "doc" or "gw" CLI verbs appear in any denial hint
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { check } from "../../src/hooks/doc-read-guard.js";

const HOOK_PATH = path.resolve(import.meta.dirname, "..", "..", "src", "hooks", "doc-read-guard.ts");

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "doc-read-guard-"));
  mkdirSync(path.join(tmpDir, ".groundwork", "plans"), { recursive: true });
  // NOTE: no process.chdir() — rootDir passed explicitly to check()
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function prdPath(name: string): string {
  return path.join(tmpDir, ".groundwork", "plans", name);
}

/** plan budget = 3000 tokens. 11000 ASCII bytes ≈ 3143 tokens — over budget. */
function bigContent(): string { return "x".repeat(11000); }
function smallContent(): string { return "# Doc\n\n## Section\n\nShort.\n"; }
function sid(): string { return `test-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function decision(r: ReturnType<typeof check>): string {
  const s = r.stdout.trim();
  if (!s) return "allow";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } })
      .hookSpecificOutput.permissionDecision;
  } catch { return `parse-error(${s.slice(0, 60)})`; }
}

function reason(r: ReturnType<typeof check>): string {
  const s = r.stdout.trim();
  if (!s) return "";
  try {
    return (JSON.parse(s) as { hookSpecificOutput: { permissionDecisionReason: string } })
      .hookSpecificOutput.permissionDecisionReason ?? "";
  } catch { return ""; }
}

// ---------------------------------------------------------------------------
// Allow fixture
// ---------------------------------------------------------------------------

describe("doc-read-guard — allow", () => {
  it("ALLOW: full Read of within-budget doc-class file", () => {
    const fp = prdPath(`small-${Date.now()}.md`);
    writeFileSync(fp, smallContent());
    const r = check({ tool_name: "Read", tool_input: { file_path: fp } }, tmpDir);
    expect(decision(r)).not.toBe("deny");
    expect(r.exit).toBe(0);
  });

  it("ALLOW: Read with offset set (AC 2b — progressive disclosure)", () => {
    const fp = prdPath(`offset-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Read", tool_input: { file_path: fp, offset: 10 } }, tmpDir);
    expect(decision(r)).not.toBe("deny");
  });

  it("ALLOW: Read with limit set (AC 2b — progressive disclosure)", () => {
    const fp = prdPath(`limit-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Read", tool_input: { file_path: fp, limit: 50 } }, tmpDir);
    expect(decision(r)).not.toBe("deny");
  });

  it("ALLOW: Read with both offset and limit set", () => {
    const fp = prdPath(`both-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Read", tool_input: { file_path: fp, offset: 5, limit: 20 } }, tmpDir);
    expect(decision(r)).not.toBe("deny");
  });

  it("ALLOW: Read of unclassified file (outside plan dir)", () => {
    const fp = path.join(tmpDir, "random.md");
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Read", tool_input: { file_path: fp } }, tmpDir);
    expect(decision(r)).not.toBe("deny");
  });

  it("ALLOW: Grep never denied (AC 4)", () => {
    const fp = prdPath(`grep-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Grep", tool_input: { pattern: "x", path: fp } }, tmpDir);
    expect(decision(r)).not.toBe("deny");
  });

  it("ALLOW: Edit never denied (AC 4)", () => {
    const fp = prdPath(`edit-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Edit", tool_input: { file_path: fp, old_string: "x", new_string: "y" } }, tmpDir);
    expect(decision(r)).not.toBe("deny");
  });

  it("ALLOW: Write never denied (AC 4)", () => {
    const fp = prdPath(`write-${Date.now()}.md`);
    const r = check({ tool_name: "Write", tool_input: { file_path: fp, content: bigContent() } }, tmpDir);
    expect(decision(r)).not.toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// Deny fixture
// ---------------------------------------------------------------------------

describe("doc-read-guard — deny", () => {
  it("DENY: full Read of over-budget doc-class file (AC 2)", () => {
    const fp = prdPath(`big-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Read", tool_input: { file_path: fp }, session_id: sid() }, tmpDir);
    expect(decision(r)).toBe("deny");
    expect(r.exit).toBe(0);
  });

  it("DENY: hint contains 'Grep' and 'offset' (real tools, AC 2)", () => {
    const fp = prdPath(`hint-read-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Read", tool_input: { file_path: fp }, session_id: sid() }, tmpDir);
    const msg = reason(r);
    expect(msg).toContain("Grep");
    expect(msg).toContain("offset");
  });

  it("DENY: Bash cat of over-budget doc-class file (AC 3)", () => {
    const fp = prdPath(`cat-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Bash", tool_input: { command: `cat ${fp}` }, session_id: sid() }, tmpDir);
    expect(decision(r)).toBe("deny");
  });

  it("DENY: Bash head of over-budget doc-class file (AC 3)", () => {
    const fp = prdPath(`head-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Bash", tool_input: { command: `head -n 50 ${fp}` }, session_id: sid() }, tmpDir);
    expect(decision(r)).toBe("deny");
  });

  it("DENY: Bash less of over-budget doc-class file (AC 3)", () => {
    const fp = prdPath(`less-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Bash", tool_input: { command: `less ${fp}` }, session_id: sid() }, tmpDir);
    expect(decision(r)).toBe("deny");
  });

  it("DENY: Bash cat hint contains 'Grep' and 'offset' (AC 3)", () => {
    const fp = prdPath(`cat-hint-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const r = check({ tool_name: "Bash", tool_input: { command: `cat ${fp}` }, session_id: sid() }, tmpDir);
    const msg = reason(r);
    expect(msg).toContain("Grep");
    expect(msg).toContain("offset");
  });
});

// ---------------------------------------------------------------------------
// Bite proof
// ---------------------------------------------------------------------------

describe("doc-read-guard — bite proof", () => {
  it("BITE: within-budget → allow; same file grown past budget → deny", () => {
    const fp = prdPath(`bite-${Date.now()}.md`);

    writeFileSync(fp, "x".repeat(5000)); // ≈1429 tokens, within 3000 budget
    const r1 = check({ tool_name: "Read", tool_input: { file_path: fp } }, tmpDir);
    expect(decision(r1)).not.toBe("deny");

    writeFileSync(fp, "x".repeat(11000)); // ≈3143 tokens, over budget
    const r2 = check({ tool_name: "Read", tool_input: { file_path: fp } }, tmpDir);
    expect(decision(r2)).toBe("deny");
  });
});

// ---------------------------------------------------------------------------
// Subprocess test — spawns hook by path, as plugin.json does (AC requirement 5)
// ---------------------------------------------------------------------------

describe("doc-read-guard — subprocess entrypoint", () => {
  it("SUBPROCESS: bun <hook-path> with over-budget Read JSON on stdin → deny on stdout, exit 0", () => {
    const fp = prdPath(`subprocess-${Date.now()}.md`);
    writeFileSync(fp, bigContent());

    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: fp },
      session_id: sid(),
    });

    const result = spawnSync("bun", [HOOK_PATH], {
      input: payload,
      encoding: "utf8",
      cwd: tmpDir, // hook uses process.cwd() as rootDir when no explicit rootDir
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).not.toBe("");
    const parsed = JSON.parse(result.stdout.trim()) as { hookSpecificOutput: { permissionDecision: string } };
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
  });

  it("SUBPROCESS: bun <hook-path> with within-budget Read JSON → empty stdout, exit 0", () => {
    const fp = prdPath(`subprocess-small-${Date.now()}.md`);
    writeFileSync(fp, smallContent());

    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: fp },
      session_id: sid(),
    });

    const result = spawnSync("bun", [HOOK_PATH], {
      input: payload,
      encoding: "utf8",
      cwd: tmpDir,
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Hint-clean: no doc/gw CLI verbs in any denial message
// ---------------------------------------------------------------------------

describe("doc-read-guard — hint cleanliness", () => {
  it("HINT-CLEAN: denial hint contains no 'doc toc', 'doc show', or 'gw' verbs", () => {
    const fp = prdPath(`hint-clean-${Date.now()}.md`);
    writeFileSync(fp, bigContent());

    const readResult = check({ tool_name: "Read", tool_input: { file_path: fp } }, tmpDir);
    const bashResult = check({ tool_name: "Bash", tool_input: { command: `cat ${fp}` } }, tmpDir);

    for (const r of [readResult, bashResult]) {
      const msg = reason(r);
      expect(msg).not.toMatch(/\bdoc toc\b/);
      expect(msg).not.toMatch(/\bdoc show\b/);
      expect(msg).not.toMatch(/\bgw\b/);
      // Must mention actual tools
      expect(msg).toContain("Grep");
    }
  });
});

// ---------------------------------------------------------------------------
// Fail-open (AC 6)
// ---------------------------------------------------------------------------

describe("doc-read-guard — fail-open (AC 6)", () => {
  it("fail-open: malformed input — allow, exit 0", () => {
    const r = check("not-an-object");
    expect(r.exit).toBe(0);
    expect(decision(r)).not.toBe("deny");
  });

  it("fail-open: non-existent doc-class file — allow, exit 0", () => {
    const fp = prdPath(`nonexistent-${Date.now()}.md`);
    const r = check({ tool_name: "Read", tool_input: { file_path: fp } }, tmpDir);
    expect(r.exit).toBe(0);
    expect(decision(r)).not.toBe("deny");
  });

  it("fail-open: SDK embedded agent — allow, exit 0", () => {
    const fp = prdPath(`sdk-${Date.now()}.md`);
    writeFileSync(fp, bigContent());
    const orig = process.env.CLAUDE_CODE_ENTRYPOINT;
    process.env.CLAUDE_CODE_ENTRYPOINT = "sdk-js";
    try {
      const r = check({ tool_name: "Read", tool_input: { file_path: fp } }, tmpDir);
      expect(r.exit).toBe(0);
      expect(decision(r)).not.toBe("deny");
    } finally {
      if (orig === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT;
      else process.env.CLAUDE_CODE_ENTRYPOINT = orig;
    }
  });
});
