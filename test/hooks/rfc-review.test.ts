/**
 * Tests for hooks/rfc-review.mjs (T12 review sidecar CLI)
 *
 * AC coverage map:
 *   AC1 → "generate creates reviews/<date>-<name>.comments.json with needs-changes and rfc_digest"
 *          "generate warns when body_digest is null (draft RFC)"
 *   AC2 → "add assigns monotonic RC-NNN ids"
 *          "add ids are monotonic across multiple reviewer files"
 *   AC3 → "resolve warns when rfc_digest mismatches current body_digest"
 *   AC4 → "set-status accepted refuses when overall_verdict is not approved"
 *          "set-status accepted refuses and lists offending blocking comment ids"
 *          "set-status accepted succeeds after all blocking comments resolved/wont-fix"
 *          "set-status accepted fails closed on malformed comments file"
 *   AC5 → "parse-criticmarkup converts {>> <<} marks to sidecar with anchor type quote"
 *          "parse-criticmarkup captures preceding text as quote"
 *   AC6 → "rfc export exits 2 as unknown command (negative requirement)"
 */

import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI = path.resolve(import.meta.dirname, "..", "..", "hooks", "rfc.mjs");

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(path.join(tmpdir(), "gw-rfc-review-test-"));
});
afterEach(() => rmSync(projectDir, { recursive: true, force: true }));

/** Run `node hooks/rfc.mjs` with CLAUDE_PROJECT_DIR set. */
function run(
  args: string[],
): { code: number; stdout: string; stderr: string } {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: projectDir };
  const result = spawnSync("node", [CLI, ...args], { env, encoding: "utf8" });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function rfcsDir() {
  return path.join(projectDir, ".groundwork", "rfcs");
}

/** Create a new RFC and return its directory path. */
function createRfc(slug = "test-feature", extraArgs: string[] = []) {
  const r = run(["new", slug, ...extraArgs]);
  expect(r.code).toBe(0);
  const match = r.stdout.match(/Created (.+)/);
  expect(match).toBeTruthy();
  return match![1].trim();
}

/** Read a comments file as parsed JSON. */
function readCommentsFile(filePath: string) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/** Find the first *.comments.json in rfcDir/reviews/. */
function firstReviewFile(rfcDir: string) {
  const { readdirSync } = require("node:fs");
  const rev = path.join(rfcDir, "reviews");
  const files = readdirSync(rev).filter((f: string) =>
    f.endsWith(".comments.json"),
  );
  if (files.length === 0) throw new Error("No review files found");
  return path.join(rev, files[0]);
}

// ---------------------------------------------------------------------------
// AC 1: generate
// ---------------------------------------------------------------------------

describe("rfc review generate (AC 1)", () => {
  it("creates reviews/<date>-<name>.comments.json with needs-changes and rfc_digest", () => {
    const rfcDir = createRfc("gen-test");
    const r = run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Created .+alice\.comments\.json/);

    const filePath = r.stdout.match(/Created (.+)/)?.[1].trim()!;
    const obj = readCommentsFile(filePath);

    expect(obj.schema).toBe(1);
    expect(obj.reviewer).toBe("alice");
    expect(obj.overall_verdict).toBe("needs-changes");
    expect(obj.comments).toEqual([]);
    // RFC is draft so body_digest is null — rfc_digest should be null
    expect(obj.rfc_digest).toBeNull();
  });

  it("warns when body_digest is null (draft RFC)", () => {
    const rfcDir = createRfc("draft-warn");
    const r = run(["review", "generate", rfcDir, "--reviewer", "bob"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/body_digest is null/);
  });

  it("captures rfc_digest once RFC is in review status", () => {
    const rfcDir = createRfc("review-digest");
    // Promote to review — stamps body_digest
    run(["set-status", rfcDir, "review"]);
    const r = run(["review", "generate", rfcDir, "--reviewer", "carol"]);
    expect(r.code).toBe(0);
    const filePath = r.stdout.match(/Created (.+)/)?.[1].trim()!;
    const obj = readCommentsFile(filePath);
    expect(typeof obj.rfc_digest).toBe("string");
    expect(obj.rfc_digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("exits 2 when --reviewer is missing", () => {
    const rfcDir = createRfc("no-reviewer");
    const r = run(["review", "generate", rfcDir]);
    expect(r.code).toBe(2);
  });

  it("exits 1 when review file already exists", () => {
    const rfcDir = createRfc("duplicate");
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    const r = run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("already exists");
  });
});

// ---------------------------------------------------------------------------
// AC 2: add — monotonic RC-NNN
// ---------------------------------------------------------------------------

describe("rfc review add — monotonic RC-NNN (AC 2)", () => {
  it("assigns RC-001, RC-002, RC-003 in order", () => {
    const rfcDir = createRfc("monotonic");
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);

    const r1 = run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "First comment",
    ]);
    expect(r1.code).toBe(0);
    expect(r1.stdout).toContain("RC-001");

    const r2 = run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "Second comment",
    ]);
    expect(r2.code).toBe(0);
    expect(r2.stdout).toContain("RC-002");

    const r3 = run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "Third comment",
    ]);
    expect(r3.code).toBe(0);
    expect(r3.stdout).toContain("RC-003");

    const filePath = firstReviewFile(rfcDir);
    const obj = readCommentsFile(filePath);
    expect(obj.comments.map((c: any) => c.id)).toEqual([
      "RC-001",
      "RC-002",
      "RC-003",
    ]);
  });

  it("ids are monotonic ACROSS multiple reviewer files", () => {
    const rfcDir = createRfc("cross-reviewer");
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "Alice comment",
    ]);

    run(["review", "generate", rfcDir, "--reviewer", "bob"]);
    const r = run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "bob",
      "--text",
      "Bob comment",
    ]);
    expect(r.code).toBe(0);
    // Bob's first comment should be RC-002 (continuing from alice's RC-001)
    expect(r.stdout).toContain("RC-002");
  });

  it("assigns anchor type from --anchor-type", () => {
    const rfcDir = createRfc("anchor-test");
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "req comment",
      "--anchor-type",
      "requirement",
      "--anchor-ref",
      "REQ-1",
    ]);
    const filePath = firstReviewFile(rfcDir);
    const obj = readCommentsFile(filePath);
    expect(obj.comments[0].anchor.type).toBe("requirement");
    expect(obj.comments[0].anchor.ref).toBe("REQ-1");
  });

  it("defaults to non-blocking severity and global anchor", () => {
    const rfcDir = createRfc("defaults");
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "plain comment",
    ]);
    const filePath = firstReviewFile(rfcDir);
    const obj = readCommentsFile(filePath);
    expect(obj.comments[0].severity).toBe("non-blocking");
    expect(obj.comments[0].anchor.type).toBe("global");
    expect(obj.comments[0].status).toBe("open");
  });

  it("exits 2 on invalid --severity", () => {
    const rfcDir = createRfc("bad-severity");
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    const r = run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "x",
      "--severity",
      "critical",
    ]);
    expect(r.code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC 3: resolve warns on digest mismatch
// ---------------------------------------------------------------------------

describe("rfc review resolve — digest mismatch warning (AC 3)", () => {
  it("warns when rfc_digest doesn't match current body_digest", () => {
    const rfcDir = createRfc("digest-mismatch");
    // Promote to review — stamps body_digest
    run(["set-status", rfcDir, "review"]);
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "a comment",
    ]);

    // Manually overwrite rfc_digest in the comments file to a stale value
    const filePath = firstReviewFile(rfcDir);
    const obj = readCommentsFile(filePath);
    obj.rfc_digest = "deadbeef".repeat(8); // fake stale digest
    writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");

    const r = run(["review", "resolve", rfcDir, "--id", "RC-001"]);
    expect(r.code).toBe(0); // resolves despite mismatch
    expect(r.stderr).toMatch(/written against older/i);
  });

  it("does NOT warn when digests match", () => {
    const rfcDir = createRfc("digest-match");
    run(["set-status", rfcDir, "review"]);
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "a comment",
    ]);
    const r = run(["review", "resolve", rfcDir, "--id", "RC-001"]);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/older/);
  });

  it("does NOT warn when rfc_digest is null (draft RFC)", () => {
    const rfcDir = createRfc("null-digest");
    // generate on draft (rfc_digest=null in file)
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "a comment",
    ]);
    const r = run(["review", "resolve", rfcDir, "--id", "RC-001"]);
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/older/);
  });
});

// ---------------------------------------------------------------------------
// AC 4: set-status accepted gate
// ---------------------------------------------------------------------------

describe("rfc set-status accepted — review gate (AC 4)", () => {
  it("refuses when overall_verdict is needs-changes, lists offending", () => {
    const rfcDir = createRfc("gate-needs-changes");
    run(["set-status", rfcDir, "review"]);
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    // overall_verdict is needs-changes (default) and no comments

    const r = run(["set-status", rfcDir, "accepted"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/review gate failed/i);
    expect(r.stderr).toMatch(/needs-changes/);
  });

  it("refuses and lists offending blocking comment ids", () => {
    const rfcDir = createRfc("gate-blocking");
    run(["set-status", rfcDir, "review"]);
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "critical issue",
      "--severity",
      "blocking",
    ]);

    const r = run(["set-status", rfcDir, "accepted"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/RC-001/);
    expect(r.stderr).toMatch(/blocking/);
  });

  it("succeeds once all reviews approved and blocking comments resolved", () => {
    const rfcDir = createRfc("gate-success");
    run(["set-status", rfcDir, "review"]);
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "fix this",
      "--severity",
      "blocking",
    ]);

    // Resolve the blocking comment
    run(["review", "resolve", rfcDir, "--id", "RC-001"]);

    // Set overall_verdict to approved
    const filePath = firstReviewFile(rfcDir);
    const obj = readCommentsFile(filePath);
    obj.overall_verdict = "approved";
    writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");

    const r = run(["set-status", rfcDir, "accepted"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("review → accepted");
  });

  it("succeeds when blocking comment is wont-fix and verdict is approved", () => {
    const rfcDir = createRfc("gate-wontfix");
    run(["set-status", rfcDir, "review"]);
    run(["review", "generate", rfcDir, "--reviewer", "alice"]);
    run([
      "review",
      "add",
      rfcDir,
      "--reviewer",
      "alice",
      "--text",
      "won't fix this",
      "--severity",
      "blocking",
    ]);
    run(["review", "resolve", rfcDir, "--id", "RC-001", "--wont-fix"]);

    const filePath = firstReviewFile(rfcDir);
    const obj = readCommentsFile(filePath);
    obj.overall_verdict = "approved";
    writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n");

    const r = run(["set-status", rfcDir, "accepted"]);
    expect(r.code).toBe(0);
  });

  it("succeeds (no review files = gate passes) when reviews/ is empty", () => {
    // No review files at all — gate should pass (no blocking evidence)
    const rfcDir = createRfc("gate-no-reviews");
    run(["set-status", rfcDir, "review"]);
    const r = run(["set-status", rfcDir, "accepted"]);
    // Empty reviews/ dir — no reviews to block acceptance
    expect(r.code).toBe(0);
  });

  it("fails closed on malformed comments file", () => {
    const rfcDir = createRfc("gate-malformed");
    run(["set-status", rfcDir, "review"]);
    // Write an invalid JSON file
    const revDir = path.join(rfcDir, "reviews");
    mkdirSync(revDir, { recursive: true });
    writeFileSync(
      path.join(revDir, "2026-07-26-alice.comments.json"),
      "not valid json {{{",
    );

    const r = run(["set-status", rfcDir, "accepted"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/MALFORMED/i);
  });
});

// ---------------------------------------------------------------------------
// AC 5: parse-criticmarkup
// ---------------------------------------------------------------------------

describe("rfc review parse-criticmarkup (AC 5)", () => {
  it("converts {>> <<} marks to comments with anchor type quote", () => {
    const rfcDir = createRfc("criticmarkup-test");
    const inputFile = path.join(rfcDir, "notes", "draft.md");
    mkdirSync(path.join(rfcDir, "notes"), { recursive: true });
    writeFileSync(
      inputFile,
      `# Section 1\n\nThis is the first paragraph.{>> This needs clarification <<}\n\nAnother sentence.{>> Consider removing <<}`,
    );

    const r = run([
      "review",
      "parse-criticmarkup",
      inputFile,
      "--rfc-dir",
      rfcDir,
      "--reviewer",
      "alice",
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Created .+alice\.comments\.json \(2 comment\(s\)\)/);

    const filePath = r.stdout.match(/Created (.+) \(/)?.[1].trim()!;
    const obj = readCommentsFile(filePath);

    expect(obj.comments).toHaveLength(2);
    expect(obj.comments[0].id).toBe("RC-001");
    expect(obj.comments[0].anchor.type).toBe("quote");
    expect(obj.comments[0].text).toBe("This needs clarification");
    expect(obj.comments[1].id).toBe("RC-002");
    expect(obj.comments[1].text).toBe("Consider removing");
    expect(obj.overall_verdict).toBe("needs-changes");
  });

  it("captures preceding text as the quote field", () => {
    const rfcDir = createRfc("quote-capture");
    const inputFile = path.join(rfcDir, "notes", "text.md");
    mkdirSync(path.join(rfcDir, "notes"), { recursive: true });
    writeFileSync(
      inputFile,
      `Some preceding text here.{>> comment mark <<}`,
    );

    const r = run([
      "review",
      "parse-criticmarkup",
      inputFile,
      "--rfc-dir",
      rfcDir,
      "--reviewer",
      "bob",
    ]);
    expect(r.code).toBe(0);
    const filePath = r.stdout.match(/Created (.+) \(/)?.[1].trim()!;
    const obj = readCommentsFile(filePath);
    expect(obj.comments[0].anchor.quote).toMatch(/Some preceding text here/);
  });

  it("warns when no comment marks found", () => {
    const rfcDir = createRfc("no-marks");
    const inputFile = path.join(rfcDir, "notes", "plain.md");
    mkdirSync(path.join(rfcDir, "notes"), { recursive: true });
    writeFileSync(inputFile, `No comment marks here.`);

    const r = run([
      "review",
      "parse-criticmarkup",
      inputFile,
      "--rfc-dir",
      rfcDir,
      "--reviewer",
      "carol",
    ]);
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/no CriticMarkup/i);
  });

  it("exits 2 when input file argument is missing", () => {
    const r = run(["review", "parse-criticmarkup"]);
    expect(r.code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC 6: rfc export is unknown command (negative requirement)
// ---------------------------------------------------------------------------

describe("rfc export — negative requirement (AC 6)", () => {
  it("exits 2 with unknown command when 'rfc export' is invoked", () => {
    const r = run(["export"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/unknown command/i);
  });

  it("review subcommand does not have an 'export' sub-subcommand", () => {
    const rfcDir = createRfc("no-export");
    const r = run(["review", "export", rfcDir]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/unknown subcommand/i);
  });
});
