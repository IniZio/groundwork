import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookInput } from "../../src/hooks/lib/transcript-schemas.ts";

const HOOK = new URL("../../src/hooks/question-ledger.ts", import.meta.url).pathname;

let dir: string;
let n = 0;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ql-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

interface TextPart { type: "text"; text: string | number }
type Part =
  | TextPart
  | { type: "tool_use"; id: string; name: string; input: Record<string, never> }
  | { type: "tool_result"; tool_use_id: string; content: string | TextPart[] };
type Content = string | Part[];
interface Entry { type: string; isSidechain?: boolean; message?: { content: Content } }

const asst = (...content: Part[]): Entry => ({ type: "assistant", message: { content } });
const text = (t: string): TextPart => ({ type: "text", text: t });
const user = (c: Content): Entry => ({ type: "user", message: { content: c } });
function markLive(sessionId: string) {
  const qdir = join(dir, ".claude", "groundwork", "questions");
  mkdirSync(qdir, { recursive: true });
  writeFileSync(join(qdir, `${sessionId}.json`), "{}");
}

function hook(entries: Entry[], extra: HookInput = {}, { live = true, env = {} }: { live?: boolean; env?: Record<string, string> } = {}) {
  const tp = join(dir, `t${n++}.jsonl`);
  writeFileSync(tp, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const input = { session_id: `s-${n}`, hook_event_name: "Stop", transcript_path: tp, agent_transcript_path: tp, ...extra };
  if (live) markLive(input.session_id);
  return spawnSync("bun", [HOOK], {
    input: JSON.stringify(input), encoding: "utf8",
    env: { ...process.env, HOME: dir, TMPDIR: dir, CLAUDE_CODE_ENTRYPOINT: "", ...env },
  });
}
const blocked = (r: { stdout: string }) => r.stdout.includes('"decision":"block"');

describe("question-ledger", () => {
  it("prose question without a recommendation blocks and names the reply shape", () => {
    const r = hook([user("hi"), asst(text("Should I proceed?"))]);
    expect(r.status).toBe(0);
    expect(blocked(r)).toBe(true);
    expect(r.stdout).toContain("Should I proceed?");
    expect(r.stdout).toContain("Recommend: <answer>");
    expect(r.stdout).not.toContain("mcp__groundwork__ask");
  });

  it("a question line with a recommendation allows, in plain, list, bold and legacy #N forms", () => {
    for (const t of [
      "Ship it? Recommend: yes",
      "- Squash the stack? Recommend: no",
      "**Merge #920 first?** Recommend: yes",
      "#3 Ship it? Recommend: yes",
    ]) expect(hook([user("hi"), asst(text(t))]).stdout).toBe("");
  });

  it("a #N citation alone no longer covers a question", () => {
    expect(blocked(hook([user("hi"), asst(text("Per #3, ship it?"))]))).toBe(true);
    expect(blocked(hook([user("hi"), asst(text("Merge #920 now?"))]))).toBe(true);
  });

  it("no mod marker for the session allows silently, even with a prose question", () => {
    const r = hook([user("hi"), asst(text("Should I proceed?"))], {}, { live: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("a recommended question before the final reply blocks, since the band records only the final reply", () => {
    const r = hook([user("hi"), asst(text("Ship it? Recommend: yes")), asst({ type: "tool_use", id: "t1", name: "Bash", input: {} }), asst(text("Done."))]);
    expect(blocked(r)).toBe(true);
    expect(r.stdout).toContain("Ship it? Recommend: yes");
  });

  it("an empty recommendation does not cover", () => {
    expect(blocked(hook([user("hi"), asst(text("Ship it? Recommend: "))]))).toBe(true);
  });

  it("questions in fence, heading, table row, blockquote do not count", () => {
    const t = "```\nis this a q?\n```\n# Why again?\n| a? | b |\n> quoted?\nplain statement.";
    expect(hook([user("hi"), asst(text(t))]).stdout).toBe("");
  });

  it("tool_result-only and task-notification entries do not reset the window", () => {
    const r = hook([
      user("hi"), asst(text("Which one?")),
      user([{ type: "tool_result", tool_use_id: "x", content: "ok" }]),
      user("<task-notification>done</task-notification>"),
      user([{ type: "text", text: "<system-reminder>x</system-reminder>" }]),
    ]);
    expect(blocked(r)).toBe(true);
  });

  it("question before a genuine user message is outside the window", () => {
    const r = hook([user("hi"), asst(text("Which one?")), user("the first"), asst(text("Done."))]);
    expect(r.stdout).toBe("");
  });

  it("sidechain entries are ignored", () => {
    const r = hook([user("hi"), { ...asst(text("Which one?")), isSidechain: true }]);
    expect(r.stdout).toBe("");
  });

  it("SubagentStop reads agent_transcript_path", () => {
    const main = join(dir, "main.jsonl");
    writeFileSync(main, JSON.stringify(user("hi")) + "\n");
    const r = hook([user("go"), asst(text("Which one?"))], {
      hook_event_name: "SubagentStop", agent_id: "a1", transcript_path: main,
    });
    expect(blocked(r)).toBe(true);
  });

  it("third consecutive block becomes allow with a systemMessage", () => {
    const entries = [user("hi"), asst(text("Which one?"))];
    const tp = join(dir, "loop.jsonl");
    markLive("loop");
    writeFileSync(tp, entries.map((e) => JSON.stringify(e)).join("\n"));
    const run = () => spawnSync("bun", [HOOK], {
      input: JSON.stringify({ session_id: "loop", hook_event_name: "Stop", transcript_path: tp }),
      encoding: "utf8", env: { ...process.env, HOME: dir, TMPDIR: dir, CLAUDE_CODE_ENTRYPOINT: "" },
    });
    expect(blocked(run())).toBe(true);
    expect(blocked(run())).toBe(true);
    const third = run();
    expect(blocked(third)).toBe(false);
    expect(third.stdout).toContain("question-ledger: 1 question(s) without a recommendation");
    expect(blocked(run())).toBe(true);
  });

  it("malformed stdin exits 0 with no output", () => {
    const r = spawnSync("bun", [HOOK], { input: "{not json", encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("SDK entrypoint allows", () => {
    const r = hook([user("hi"), asst(text("Which one?"))], {}, { env: { CLAUDE_CODE_ENTRYPOINT: "sdk-js" } });
    expect(r.stdout).toBe("");
  });

  it("blocks when spawned by path with NODE_PATH unset from a cwd outside the repo", () => {
    const tp = join(dir, "t-outside.jsonl");
    markLive("s-outside");
    writeFileSync(tp, [user("hi"), asst(text("Should I proceed?"))].map((e) => JSON.stringify(e)).join("\n") + "\n");
    const { NODE_PATH: _unset, ...env } = process.env;
    const r = spawnSync("bun", [HOOK], {
      cwd: dir, encoding: "utf8",
      input: JSON.stringify({ session_id: "s-outside", hook_event_name: "Stop", transcript_path: tp }),
      env: { ...env, HOME: dir, TMPDIR: dir, CLAUDE_CODE_ENTRYPOINT: "" },
    });
    expect(r.status).toBe(0);
    expect(blocked(r)).toBe(true);
  });

  it("skips a schema-invalid line instead of reading it", () => {
    const bad: Entry = { type: "assistant", message: { content: [{ type: "text", text: 42 }] } };
    const r = hook([user("hi"), bad, asst(text("Fine statement."))]);
    expect(r.status).toBe(0);
    expect(blocked(r)).toBe(false);
    const badQuestion = { type: "assistant", message: { content: "Should I proceed?" } };
    expect(blocked(hook([user("hi"), badQuestion]))).toBe(false);
  });

  const toolOnly = asst({ type: "tool_use", id: "toolu_x", name: "Bash", input: {} });
  const withLast = (entries: Entry[], last: string) => hook(entries, { last_assistant_message: last });


  it("final reply only in last_assistant_message is checked", () => {
    const r = withLast([user("hi"), toolOnly], "Should I proceed?");
    expect(blocked(r)).toBe(true);
    expect(r.stdout).toContain("Should I proceed?");
  });

  it("last_assistant_message with a recommendation allows", () => {
    expect(withLast([user("hi"), toolOnly], "Ship it? Recommend: yes").stdout).toBe("");
  });

  it("final text already in the transcript is reported once", () => {
    const r = withLast([user("hi"), asst(text("Should I proceed?"))], "Should I proceed?");
    expect(blocked(r)).toBe(true);
    expect(r.stdout.split("Should I proceed?").length - 1).toBe(1);
  });

  it("a reply with no question allows", () => {
    expect(withLast([user("hi"), toolOnly], "All done. The change is in place.").stdout).toBe("");
  });

  it("mid-line question blocks", () => {
    const r = hook([user("hi"), asst(text("Do you want X instead? I can switch it."))]);
    expect(blocked(r)).toBe(true);
  });

  it("self-answered, bold-answered and quoted question marks allow", () => {
    for (const t of [
      "**Is X needed?** Yes, because it is.",
      "- **Q5 (A over ssh?):** Yes.",
      'it asks "what can this do?", not "why?".',
      "it asks \u201cwhat can this do?\u201d, not \u201cwhy?\u201d.",
    ]) expect(hook([user("hi"), asst(text(t))]).stdout).toBe("");
  });

  it("SubagentStop allows a subagent question that carries a recommendation", () => {
    const r = hook([user("go"), toolOnly], {
      hook_event_name: "SubagentStop", agent_id: "a1", last_assistant_message: "Which one? Recommend: A",
    });
    expect(r.stdout).toBe("");
  });
});
