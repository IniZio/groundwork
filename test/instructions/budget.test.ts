import { describe, it, expect } from "bun:test";
import { FILE_ROWS, INJECTION, REMINDER, UPDATE_CMD, computeBytes, readDoc, renderDoc } from "../../src/instructions/budget.js";

const doc = readDoc();
const expected = renderDoc(doc, computeBytes());

const rowsOf = (text: string, match: (name: string) => boolean) =>
  text.split("\n").filter(l => l.startsWith("|") && match(l.split("|")[1].trim().replace(/\*/g, "")));

function expectCurrent(match: (name: string) => boolean, label: string) {
  const have = rowsOf(doc, match);
  expect(have.length, `${label}: row not found in doc table`).toBeGreaterThan(0);
  expect(
    have.join("\n"),
    `${label}: doc row is stale — run: ${UPDATE_CMD}`,
  ).toBe(rowsOf(expected, match).join("\n"));
}

describe("instruction-budget.md — rows match files at HEAD", () => {
  for (const { surface } of FILE_ROWS) {
    it(`${surface} byte and token counts are current`, () => {
      expectCurrent(n => n === surface || (surface === "general-purpose / implementer.md" && n === "implementer / general-purpose.md"), surface);
    });
  }

  it("SessionStart injection counts are current (normalised)", () => {
    expectCurrent(n => n === INJECTION, INJECTION);
  });

  it("per-turn reminder counts are current", () => {
    expectCurrent(n => n === REMINDER, REMINDER);
  });

  it("session and leaf totals are current", () => {
    expectCurrent(n => n.startsWith("Total"), "totals");
  });
});

describe("instruction-budget.md — totals equal the sum of their parsed component rows", () => {
  const section = (heading: string) => {
    const lines = readDoc().split("\n");
    const start = lines.findIndex(l => l.startsWith("###") && l.toLowerCase().includes(heading));
    expect(start, `section "${heading}" not found`).toBeGreaterThanOrEqual(0);
    const rows: { name: string; n: number }[] = [];
    for (const l of lines.slice(start + 1)) {
      if (l.startsWith("#")) break;
      if (!l.startsWith("|")) continue;
      const c = l.split("|").slice(1, -1).map(x => x.trim());
      const n = parseInt(c[1].replace(/\*/g, ""), 10);
      if (!Number.isNaN(n)) rows.push({ name: c[0].replace(/\*/g, ""), n });
    }
    return rows;
  };
  const check = (heading: string, totalName: string) => {
    const rows = section(heading);
    const total = rows.filter(r => r.name.startsWith(totalName));
    expect(total.length, `${heading}: exactly one "${totalName}" row`).toBe(1);
    const sum = rows.filter(r => !r.name.startsWith(totalName)).reduce((a, r) => a + r.n, 0);
    expect(total[0].n, `${heading}: bold total != sum of component rows`).toBe(sum);
  };

  it("per-leaf Total equals the sum of its component rows", () => check("per-leaf", "Total"));
  it("per-orchestrator session total equals the sum of its component rows", () => check("per-orchestrator", "Total"));
  it("session total includes the per-turn reminder row", () => {
    expect(section("per-orchestrator").some(r => r.name.startsWith("Per-turn reminder"))).toBe(true);
  });
});
