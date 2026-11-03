import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOOK = new URL("../../src/hooks/question-ledger.ts", import.meta.url).pathname;

let dir: string;
let n = 0;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ql-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const asst = (...content: object[]) => ({ type: "assistant", message: { content } });
const text = (t: string) => ({ type: "text", text: t });
const user = (c: unknown) => ({ type: "user", message: { content: c } });
const createQ = (id: string) => asst({ type: "tool_use", id, name: "TaskCreate", input: { subject: "q", metadata: { kind: "question" } } });
const created = (id: string, num: number) => user([{ type: "tool_result", tool_use_id: id, content: `Task #${num} created successfully: ❓ q` }]);
const anyCreate = createQ("toolu_pad");

function hook(entries: object[], extra: Record<string, unknown> = {}, env: Record<string, string> = {}) {
  const tp = join(dir, `t${n++}.jsonl`);
  writeFileSync(tp, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const input = { session_id: `s-${dir}-${n}`, hook_event_name: "Stop", transcript_path: tp, agent_transcript_path: tp, ...extra };
  return spawnSync("bun", [HOOK], {
    input: JSON.stringify(input), encoding: "utf8",
    env: { ...process.env, TMPDIR: dir, CLAUDE_CODE_ENTRYPOINT: "", ...env },
  });
}
const blocked = (r: { stdout: string }) => r.stdout.includes('"decision":"block"');

describe("question-ledger", () => {
  it("prose question without a task blocks", () => {
    const r = hook([user("hi"), anyCreate, asst(text("Should I proceed?"))]);
    expect(r.status).toBe(0);
    expect(blocked(r)).toBe(true);
    expect(r.stdout).toContain("Should I proceed?");
  });

  it("recorded question task cited as #N allows", () => {
    const r = hook([user("hi"), createQ("toolu_1"), created("toolu_1", 3), asst(text("Per #3, ship it? Recommend: yes"))]);
    expect(r.stdout).toBe("");
  });

  it("a PR number that is not a question id does not cover", () => {
    const r = hook([user("hi"), createQ("toolu_1"), created("toolu_1", 3), asst(text("Merge #920 now?"))]);
    expect(blocked(r)).toBe(true);
  });

  it("the reply format `#N question?` is checked: recorded id allows, PR number blocks", () => {
    const pre = [user("hi"), createQ("toolu_1"), created("toolu_1", 3)];
    expect(hook([...pre, asst(text("#3 Ship it? Recommend: yes"))]).stdout).toBe("");
    expect(blocked(hook([...pre, asst(text("#920 merge it?"))]))).toBe(true);
  });

  it("no TaskCreate anywhere allows silently", () => {
    const r = hook([user("hi"), asst(text("Should I proceed?"))]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("questions in fence, heading, table row, blockquote do not count", () => {
    const t = "```\nis this a q?\n```\n# Why again?\n| a? | b |\n> quoted?\nplain statement.";
    expect(hook([user("hi"), anyCreate, asst(text(t))]).stdout).toBe("");
  });

  it("tool_result-only and task-notification entries do not reset the window", () => {
    const r = hook([
      user("hi"), anyCreate, asst(text("Which one?")),
      user([{ type: "tool_result", tool_use_id: "x", content: "ok" }]),
      user("<task-notification>done</task-notification>"),
      user([{ type: "text", text: "<system-reminder>x</system-reminder>" }]),
    ]);
    expect(blocked(r)).toBe(true);
  });

  it("question before a genuine user message is outside the window", () => {
    const r = hook([user("hi"), anyCreate, asst(text("Which one?")), user("the first"), asst(text("Done."))]);
    expect(r.stdout).toBe("");
  });

  it("sidechain entries are ignored", () => {
    const r = hook([user("hi"), anyCreate, { ...asst(text("Which one?")), isSidechain: true }]);
    expect(r.stdout).toBe("");
  });

  it("SubagentStop reads agent_transcript_path", () => {
    const main = join(dir, "main.jsonl");
    writeFileSync(main, JSON.stringify(user("hi")) + "\n");
    const r = hook([user("go"), anyCreate, asst(text("Which one?"))], {
      hook_event_name: "SubagentStop", agent_id: "a1", transcript_path: main,
    });
    expect(blocked(r)).toBe(true);
  });

  it("third consecutive block becomes allow with a systemMessage", () => {
    const entries = [user("hi"), anyCreate, asst(text("Which one?"))];
    const tp = join(dir, "loop.jsonl");
    writeFileSync(tp, entries.map((e) => JSON.stringify(e)).join("\n"));
    const run = () => spawnSync("bun", [HOOK], {
      input: JSON.stringify({ session_id: "loop", hook_event_name: "Stop", transcript_path: tp }),
      encoding: "utf8", env: { ...process.env, TMPDIR: dir, CLAUDE_CODE_ENTRYPOINT: "" },
    });
    expect(blocked(run())).toBe(true);
    expect(blocked(run())).toBe(true);
    const third = run();
    expect(blocked(third)).toBe(false);
    expect(third.stdout).toContain("question-ledger: 1 question(s) not recorded as tasks");
    expect(blocked(run())).toBe(true);
  });

  it("malformed stdin exits 0 with no output", () => {
    const r = spawnSync("bun", [HOOK], { input: "{not json", encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("SDK entrypoint allows", () => {
    const r = hook([user("hi"), anyCreate, asst(text("Which one?"))], {}, { CLAUDE_CODE_ENTRYPOINT: "sdk-js" });
    expect(r.stdout).toBe("");
  });
});
