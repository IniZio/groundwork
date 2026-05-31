import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readGoal,
  writeGoal,
  clearGoal,
  goalReminder,
  injectGoalAndBootstrap,
} from "../../src/lib/goal.js";

const tmpDir = path.join(os.tmpdir(), "groundwork-goal-test");
const sessionID = "sess_test_123";

function makeMessage(role: string, text: string, info?: Record<string, any>) {
  return { info: { role, ...info }, parts: text ? [{ type: "text", text }] : [] };
}

describe("injectGoalAndBootstrap", () => {
  const bootstrapText = "EXTREMELY_IMPORTANT\nBootstrap content here";
  const goalReminderText = "<ACTIVE_GOAL>\nGoal: Fix the bug\n</ACTIVE_GOAL>";

  test("injects bootstrap into first user message with synthetic: true", () => {
    const messages = [makeMessage("user", "Hello world")];
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: null });
    const firstPart = messages[0].parts[0];
    expect(firstPart).toEqual({ type: "text", text: bootstrapText, synthetic: true });
  });

  test("injects goal reminder into last user message with synthetic: true", () => {
    const messages = [
      makeMessage("user", "First message"),
      makeMessage("assistant", "Response"),
      makeMessage("user", "Last message"),
    ];
    injectGoalAndBootstrap(messages, { bootstrap: null, goalReminder: goalReminderText });
    const lastUser = messages.filter((m: any) => m.info.role === "user").pop()!;
    const lastPart = lastUser.parts[lastUser.parts.length - 1];
    expect(lastPart).toEqual({ type: "text", text: goalReminderText, synthetic: true });
  });

  test("both bootstrap and goal are injected in the same call", () => {
    const messages = [
      makeMessage("user", "First message"),
      makeMessage("assistant", "Response"),
      makeMessage("user", "Last message"),
    ];
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: goalReminderText });
    const firstPart = messages[0].parts[0];
    expect(firstPart).toEqual({ type: "text", text: bootstrapText, synthetic: true });
    const lastUser = messages[2];
    const lastPart = lastUser.parts[lastUser.parts.length - 1];
    expect(lastPart).toEqual({ type: "text", text: goalReminderText, synthetic: true });
  });

  test("does not double-inject bootstrap (idempotent)", () => {
    const messages = [makeMessage("user", "EXTREMELY_IMPORTANT\nAlready injected")];
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: null });
    expect(messages[0].parts).toHaveLength(1);
    expect(messages[0].parts[0].text).toBe("EXTREMELY_IMPORTANT\nAlready injected");
  });

  test("does not double-inject goal reminder (idempotent)", () => {
    const messages = [makeMessage("user", "Already has ACTIVE_GOAL")];
    injectGoalAndBootstrap(messages, { bootstrap: null, goalReminder: goalReminderText });
    expect(messages[0].parts).toHaveLength(1);
    expect(messages[0].parts[0].text).toBe("Already has ACTIVE_GOAL");
  });

  test("no-op on empty messages", () => {
    const messages: any[] = [];
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: goalReminderText });
    expect(messages).toHaveLength(0);
  });

  test("no-op when no user messages exist", () => {
    const messages = [makeMessage("assistant", "System response")];
    injectGoalAndBootstrap(messages, { bootstrap: bootstrapText, goalReminder: goalReminderText });
    expect(messages[0].parts).toHaveLength(1);
    expect((messages[0].parts[0] as any).synthetic).toBeUndefined();
  });
});

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(path.join(tmpDir, ".opencode", "goals"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("Goal Persistence", () => {
  test("readGoal returns null when no goal file exists", () => {
    expect(readGoal(tmpDir, sessionID)).toBeNull();
  });

  test("writeGoal + readGoal roundtrip", () => {
    const goal = {
      objective: "Test all routing paths",
      acceptanceCriteria: ["Path 1 works", "Path 2 works"],
      status: "active" as const,
      createdAt: "2026-05-20T00:00:00.000Z",
      updatedAt: "2026-05-20T00:00:00.000Z",
    };
    writeGoal(tmpDir, sessionID, goal);
    const read = readGoal(tmpDir, sessionID);
    expect(read).not.toBeNull();
    expect(read!.objective).toBe("Test all routing paths");
    expect(read!.acceptanceCriteria).toEqual(["Path 1 works", "Path 2 works"]);
    expect(read!.status).toBe("active");
  });

  test("clearGoal removes the goal file", () => {
    const goal = {
      objective: "Test",
      acceptanceCriteria: ["Criterion"],
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    writeGoal(tmpDir, sessionID, goal);
    expect(readGoal(tmpDir, sessionID)).not.toBeNull();
    expect(clearGoal(tmpDir, sessionID)).toBe(true);
    expect(readGoal(tmpDir, sessionID)).toBeNull();
  });

  test("goalReminder produces ACTIVE_GOAL block", () => {
    const goal = {
      objective: "Build the thing",
      acceptanceCriteria: ["Criterion A", "Criterion B"],
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const reminder = goalReminder(goal);
    expect(reminder).toContain("<ACTIVE_GOAL>");
    expect(reminder).toContain("</ACTIVE_GOAL>");
    expect(reminder).toContain("Build the thing");
    expect(reminder).toContain("1. Criterion A");
    expect(reminder).toContain("2. Criterion B");
  });

  test("readGoal returns null on malformed JSON", () => {
    writeFileSync(
      path.join(tmpDir, ".opencode", "goals", `${sessionID}.json`),
      "not json{{{",
    );
    expect(readGoal(tmpDir, sessionID)).toBeNull();
  });
});
