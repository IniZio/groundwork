import { describe, it, expect, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_BUDGET_MIN, parseBudget, readBudgetDecisionsFromDb, readBudgetDecisionsFromTranscript,
  readDispatchPrompt, evaluateBudgets, budgetBlockReason,
  type BudgetTask, type BudgetDecision,
} from "../../src/hooks/stop-gate-budget.js";
import { runMigrations } from "../../src/store/migrations.js";
import { MIGRATIONS } from "../../src/store/schema.js";

const TMP = mkdtempSync(path.join(tmpdir(), "gw-budget-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const NOW = Date.parse("2026-01-01T12:00:00Z");
const minsAgo = (m: number) => NOW - m * 60000;
const task = (over: Partial<BudgetTask> = {}): BudgetTask =>
  ({ id: "a1b2", description: "Implement widget", prompt: null, startMs: minsAgo(10), ...over });

describe("parseBudget", () => {
  it("reads the first line", () => expect(parseBudget("budget: 40m\nSLICE: x")).toBe(40));
  it("ignores a budget on line 2", () => expect(parseBudget("SLICE: x\nbudget: 40m")).toBeNull());
  it("accepts case and space variants", () => {
    expect(parseBudget("  Budget:   25M rest")).toBe(25);
    expect(parseBudget("BUDGET:5m")).toBe(5);
  });
  it("rejects zero, missing unit, absent, nullish", () => {
    expect(parseBudget("budget: 0m")).toBeNull();
    expect(parseBudget("budget: 40")).toBeNull();
    expect(parseBudget("hello")).toBeNull();
    expect(parseBudget(null)).toBeNull();
    expect(parseBudget(undefined)).toBeNull();
  });
  it("default is 15", () => expect(DEFAULT_BUDGET_MIN).toBe(15));
});

function budgetDb(rows: string[], at = "2026-01-01T00:00:00Z"): string {
  const p = path.join(TMP, `work-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(p);
  runMigrations(db, MIGRATIONS);
  db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('OTHER','{}','2026-01-01T00:00:00Z')");
  for (const r of rows) db.run("INSERT INTO events (event_type,payload,created_at) VALUES ('BUDGET',?,?)", [r, at]);
  db.close();
  return p;
}

describe("readBudgetDecisionsFromDb", () => {
  it("returns valid rows in order and skips malformed ones", () => {
    const p = budgetDb([
      JSON.stringify({ task: "a1b2", action: "extend", minutes: 20, reason: "progress" }),
      "not json",
      JSON.stringify({ task: "", action: "stop", minutes: 0 }),
      JSON.stringify({ task: "x", action: "pause", minutes: 1 }),
      JSON.stringify({ task: "x", action: "extend", minutes: -3 }),
      JSON.stringify({ task: "x", action: "extend", minutes: "9" }),
      JSON.stringify({ task: " b3 ", action: "stop" }),
    ]);
    expect(readBudgetDecisionsFromDb(p)).toEqual([
      { task: "a1b2", action: "extend", minutes: 20, atMs: Date.parse("2026-01-01T00:00:00Z"), sameSession: false },
      { task: " b3 ", action: "stop", minutes: 0, atMs: Date.parse("2026-01-01T00:00:00Z"), sameSession: false },
    ]);
  });
  it("returns [] for a missing db", () => expect(readBudgetDecisionsFromDb(path.join(TMP, "nope.db"))).toEqual([]));
});

describe("readBudgetDecisionsFromTranscript", () => {
  const TS = "2026-01-01T11:00:00Z";
  const bash = (command: string) => JSON.stringify({
    type: "assistant", timestamp: TS, message: { content: [{ type: "text", text: "ok" }, { type: "tool_use", name: "Bash", input: { command } }] },
  });
  it("extracts quoted --data in transcript order", () => {
    const p = path.join(TMP, "main.jsonl");
    writeFileSync(p, [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      bash(`$GW event append --type BUDGET --data '{"task":"a1b2","action":"extend","minutes":20,"reason":"r"}'`),
      bash(`ls`),
      bash(`gw event append --type=BUDGET --data "{\\"task\\":\\"a1b2\\",\\"action\\":\\"stop\\",\\"minutes\\":0,\\"reason\\":\\"r\\"}"`),
      bash(`$GW event append --type OTHER --data '{"task":"z","action":"stop"}'`),
      "garbage line",
    ].join("\n"));
    expect(readBudgetDecisionsFromTranscript(p)).toEqual([
      { task: "a1b2", action: "extend", minutes: 20, atMs: Date.parse(TS), sameSession: true },
      { task: "a1b2", action: "stop", minutes: 0, atMs: Date.parse(TS), sameSession: true },
    ]);
  });
  it("returns [] for a missing file", () => expect(readBudgetDecisionsFromTranscript(path.join(TMP, "nope.jsonl"))).toEqual([]));
});

describe("readDispatchPrompt", () => {
  const main = path.join(TMP, "sess", "main.jsonl");
  const subDir = path.join(TMP, "sess", "sid1", "subagents");
  mkdirSync(subDir, { recursive: true });
  it("returns the first user entry text (string content)", () => {
    writeFileSync(path.join(subDir, "agent-a1b2.jsonl"), [
      JSON.stringify({ type: "queue", x: 1 }),
      JSON.stringify({ type: "user", message: { content: "budget: 40m\nSLICE: s1" } }),
      JSON.stringify({ type: "user", message: { content: "later" } }),
    ].join("\n"));
    expect(readDispatchPrompt(main, "sid1", "a1b2")).toBe("budget: 40m\nSLICE: s1");
  });
  it("handles block content and sanitises the task id", () => {
    writeFileSync(path.join(subDir, "agent-a_b.jsonl"),
      JSON.stringify({ type: "user", message: { content: [{ type: "image" }, { type: "text", text: "budget: 5m" }] } }));
    expect(readDispatchPrompt(main, "sid1", "a/b")).toBe("budget: 5m");
  });
  it("returns null when absent", () => expect(readDispatchPrompt(main, "sid1", "zzz")).toBeNull());
});

describe("evaluateBudgets", () => {
  const d = (action: "stop" | "extend", minutes = 0, t = "a1b2", over: Partial<BudgetDecision> = {}): BudgetDecision =>
    ({ task: t, action, minutes, atMs: minsAgo(5), sameSession: true, ...over });
  it("no breach under default budget", () => expect(evaluateBudgets([task()], [], NOW)).toEqual([]));
  it("no breach exactly at budget", () => expect(evaluateBudgets([task({ startMs: minsAgo(15) })], [], NOW)).toEqual([]));
  it("breaches a 1m budget after 88 s (live rehearsal)", () =>
    expect(evaluateBudgets([task({ prompt: "budget: 1m\n\nx", startMs: NOW - 88_000 })], [], NOW)).toHaveLength(1));
  it("breach over default budget", () => {
    expect(evaluateBudgets([task({ startMs: minsAgo(16) })], [], NOW)).toEqual([
      { id: "a1b2", description: "Implement widget", elapsedSec: 960, budgetMin: 15, extended: false },
    ]);
  });
  it("uses the declared budget", () => {
    const t = task({ prompt: "budget: 40m\nx", startMs: minsAgo(30) });
    expect(evaluateBudgets([t], [], NOW)).toEqual([]);
    expect(evaluateBudgets([{ ...t, startMs: minsAgo(41) }], [], NOW)[0]?.budgetMin).toBe(40);
  });
  it("stop clears", () => expect(evaluateBudgets([task({ startMs: minsAgo(90) })], [d("stop")], NOW)).toEqual([]));
  it("extend moves the budget", () => {
    const t = task({ startMs: minsAgo(20) });
    expect(evaluateBudgets([t], [d("extend", 10)], NOW)).toEqual([]);
    expect(evaluateBudgets([{ ...t, startMs: minsAgo(40) }], [d("extend", 10)], NOW)).toEqual([
      { id: "a1b2", description: "Implement widget", elapsedSec: 2400, budgetMin: 25, extended: true },
    ]);
  });
  it("second extend is ignored", () => {
    const r = evaluateBudgets([task({ startMs: minsAgo(40) })], [d("extend", 10), d("extend", 60)], NOW);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ budgetMin: 25, extended: true });
  });
  it("stop after extend clears", () =>
    expect(evaluateBudgets([task({ startMs: minsAgo(90) })], [d("extend", 20), d("stop")], NOW)).toEqual([]));
  it("matches by trimmed description", () =>
    expect(evaluateBudgets([task({ startMs: minsAgo(90) })], [d("stop", 0, "  Implement widget ")], NOW)).toEqual([]));
  it("a stop from before the run start does not clear a resumed run", () => {
    const t = task({ startMs: minsAgo(20) });
    expect(evaluateBudgets([t], [d("stop", 0, "a1b2", { atMs: minsAgo(60) })], NOW)).toHaveLength(1);
  });
  it("a decision without a timestamp is ignored", () =>
    expect(evaluateBudgets([task({ startMs: minsAgo(90) })], [d("stop", 0, "a1b2", { atMs: null })], NOW)).toHaveLength(1));
  it("an extend before the resume does not carry over", () => {
    const r = evaluateBudgets([task({ startMs: minsAgo(20) })], [d("extend", 20, "a1b2", { atMs: minsAgo(60) })], NOW);
    expect(r[0]).toMatchObject({ budgetMin: 15, extended: false });
  });
  it("db stop keyed by description does not clear", () =>
    expect(evaluateBudgets([task({ startMs: minsAgo(90) })], [d("stop", 0, "Implement widget", { sameSession: false })], NOW)).toHaveLength(1));
  it("db stop keyed by id clears", () =>
    expect(evaluateBudgets([task({ startMs: minsAgo(90) })], [d("stop", 0, "a1b2", { sameSession: false })], NOW)).toEqual([]));
  it("extend adds at most the original budget", () => {
    const r = evaluateBudgets([task({ startMs: minsAgo(40) })], [d("extend", 100000)], NOW);
    expect(r[0]).toMatchObject({ budgetMin: 30, extended: true });
  });
  it("extend cap uses the declared budget", () => {
    const r = evaluateBudgets([task({ prompt: "budget: 40m\nx", startMs: minsAgo(100) })], [d("extend", 100000)], NOW);
    expect(r[0]).toMatchObject({ budgetMin: 80 });
  });
  it("ignores decisions for other tasks", () =>
    expect(evaluateBudgets([task({ startMs: minsAgo(90) })], [d("stop", 0, "other")], NOW)).toHaveLength(1));
});

describe("budgetBlockReason", () => {
  const b = { id: "a1b2", description: "Implement widget", elapsedSec: 2400, budgetMin: 35, extended: false };
  it("names task, elapsed, budget and the command", () => {
    const m = budgetBlockReason([b]);
    expect(m.startsWith("stop-gate: ")).toBe(true);
    expect(m).toContain(`budget: task a1b2 ("Implement widget") has run 40m, over its 35m budget.`);
    expect(m).toContain("event append --type BUDGET");
    expect(m).toContain(`"task":"a1b2"`);
    expect(m).toContain("extend adds up to 35 minutes once");
  });
  it("shows elapsed seconds precisely", () => {
    expect(budgetBlockReason([{ ...b, elapsedSec: 88, budgetMin: 1 }])).toContain("has run 1m28s, over its 1m budget.");
  });
  it("says extended breaches need a stop", () => {
    expect(budgetBlockReason([{ ...b, extended: true }])).toContain("already extended once");
    expect(budgetBlockReason([b])).not.toContain("already extended once");
  });
});
