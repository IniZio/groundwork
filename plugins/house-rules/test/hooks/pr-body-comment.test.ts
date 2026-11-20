import { describe, test, expect, beforeAll } from "bun:test";
import { makeRepo, runPluginHook } from "./commit-sandbox.js";

let enabled: string;
let disabled: string;
let configured: string;

beforeAll(() => {
  enabled = makeRepo({ rules: { "pr-body": "error" } });
  disabled = makeRepo({ rules: { "pr-body": "off" } });
  configured = makeRepo({ rules: { "pr-body": ["error", { commentMarkers: ["moor-evidence"] }] } });
});

function decide(repo: string, command: string, env: Record<string, string> = {}) {
  const r = runPluginHook("PreToolUse", "pr-body-guard.ts", repo, { tool_name: "Bash", tool_input: { command } }, env);
  if (r.stdout.trim() === "") return { decision: "allow", reason: "" };
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  return { decision: (out.permissionDecision ?? "allow") as string, reason: (out.permissionDecisionReason ?? "") as string };
}

const ISSUE_COMMENTS = "repos/IniZio/moor/issues/940/comments";

describe("pr-body guard: top-level PR comments", () => {
  test("denies the moor 940 incident: live-check proof posted as a comment", () => {
    const proof = "Live check on a separate controller: start 43 s, exit 7 in 0.57 s.";
    const r = decide(enabled, `gh pr comment 940 --body "${proof}"`);
    expect(r.decision).toBe("deny");
    expect(r.reason).toContain("proof and updates belong in the PR body");
    expect(r.reason).toContain("## Verification");
    expect(r.reason).toContain("## Scope");
    expect(r.reason).toContain("gh pr edit <n> --body-file <file>");
  });

  test("denies gh pr comment with --body-file and with a heredoc", () => {
    expect(decide(enabled, "gh pr comment 940 --body-file proof.md").decision).toBe("deny");
    expect(decide(enabled, "gh pr comment 940 -F - <<'EOF'\nproof\nEOF").decision).toBe("deny");
  });

  test("denies gh api POSTs to the issues comments endpoint, explicit or implied", () => {
    expect(decide(enabled, `gh api -X POST ${ISSUE_COMMENTS} -f body=proof`).decision).toBe("deny");
    expect(decide(enabled, `gh api --method POST ${ISSUE_COMMENTS} -f body=proof`).decision).toBe("deny");
    expect(decide(enabled, `gh api --method=post ${ISSUE_COMMENTS}`).decision).toBe("deny");
    for (const flag of ["-f body=proof", "-F body=@proof.md", "--field body=proof", "--raw-field body=proof", "--input payload.json"]) {
      expect(decide(enabled, `gh api ${ISSUE_COMMENTS} ${flag}`).decision).toBe("deny");
    }
    expect(decide(enabled, `gh api -H 'Accept: application/json' ${ISSUE_COMMENTS} -f body=proof`).decision).toBe("deny");
  });

  test("allows review-thread replies, graphql mutations, reads and GET on comments", () => {
    expect(decide(enabled, "gh api repos/o/r/pulls/940/comments/55/replies -f body=ok").decision).toBe("allow");
    expect(decide(enabled, "gh api graphql -f query='mutation { addPullRequestReviewThreadReply(input: {}) { clientMutationId } }'").decision).toBe("allow");
    expect(decide(enabled, `gh api ${ISSUE_COMMENTS}`).decision).toBe("allow");
    expect(decide(enabled, `gh api -X GET ${ISSUE_COMMENTS} -f per_page=5`).decision).toBe("allow");
    expect(decide(enabled, `gh api -X PATCH repos/o/r/issues/comments/9 -f body=x`).decision).toBe("allow");
    expect(decide(enabled, "gh pr view 940 --comments").decision).toBe("allow");
  });

  test("allows gh issue comment", () => {
    expect(decide(enabled, 'gh issue comment 12 --body "triage note"').decision).toBe("allow");
  });

  test("a repo that sets pr-body to off allows the commands denied above", () => {
    expect(decide(enabled, 'gh pr comment 940 --body "proof"').decision).toBe("deny");
    expect(decide(disabled, 'gh pr comment 940 --body "proof"').decision).toBe("allow");
    expect(decide(enabled, `gh api ${ISSUE_COMMENTS} -f body=proof`).decision).toBe("deny");
    expect(decide(disabled, `gh api ${ISSUE_COMMENTS} -f body=proof`).decision).toBe("allow");
  });
});

describe("pr-body guard: marked comments", () => {
  const MARKED = "<!-- moor-evidence sha=abc123 -->\nEvidence: https://moor.example/runs/1";
  const ENV = { HOUSE_RULES_PR_COMMENT_MARKERS: "other, moor-evidence" };

  test("the deny reason never names the marker escape", () => {
    const r = decide(enabled, 'gh pr comment 940 --body "proof"');
    expect(r.decision).toBe("deny");
    expect(r.reason).not.toMatch(/marker|HOUSE_RULES|<!--/i);
  });

  test("a marker from the env allows a marked comment in every form", () => {
    expect(decide(enabled, `gh pr comment 940 --body '${MARKED}'`, ENV).decision).toBe("allow");
    expect(decide(enabled, `gh pr comment 940 -F - <<'EOF'\n${MARKED}\nEOF`, ENV).decision).toBe("allow");
    expect(decide(enabled, `gh api ${ISSUE_COMMENTS} -f body='${MARKED}'`, ENV).decision).toBe("allow");
    expect(decide(enabled, `gh api ${ISSUE_COMMENTS} --input - <<'EOF'\n${JSON.stringify({ body: MARKED })}\nEOF`, ENV).decision).toBe("allow");
  });

  test("a marker from .house-rules.json allows a marked comment without the env", () => {
    expect(decide(configured, `gh pr comment 940 --body '${MARKED}'`).decision).toBe("allow");
    expect(decide(configured, 'gh pr comment 940 --body "proof"').decision).toBe("deny");
  });

  test("a marked comment is denied when no marker is configured", () => {
    expect(decide(enabled, `gh pr comment 940 --body '${MARKED}'`).decision).toBe("deny");
    expect(decide(enabled, `gh api ${ISSUE_COMMENTS} -f body='${MARKED}'`).decision).toBe("deny");
  });

  test("an unmarked, wrongly marked or unknown body is still denied with the env set", () => {
    expect(decide(enabled, 'gh pr comment 940 --body "proof"', ENV).decision).toBe("deny");
    expect(decide(enabled, "gh pr comment 940 --body 'proof <!-- moor-evidence -->'", ENV).decision).toBe("deny");
    expect(decide(enabled, "gh pr comment 940 --body '<!-- moor-evidence-x -->'", ENV).decision).toBe("deny");
    expect(decide(enabled, 'gh pr comment 940 --body "$BODY"', ENV).decision).toBe("deny");
    expect(decide(enabled, "gh pr comment 940", ENV).decision).toBe("deny");
    expect(decide(enabled, "gh pr comment 940 --body-file missing.md", ENV).decision).toBe("deny");
  });

  test("one unmarked comment in a command denies the whole command", () => {
    const cmd = `gh pr comment 1 --body '${MARKED}' && gh pr comment 2 --body proof`;
    expect(decide(enabled, cmd, ENV).decision).toBe("deny");
  });
});
