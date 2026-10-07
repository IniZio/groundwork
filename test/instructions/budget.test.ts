import { describe, it, expect } from "bun:test";
import { FILE_ROWS, INJECTION, UPDATE_CMD, computeBytes, readDoc, renderDoc } from "../../src/instructions/budget.js";

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

  it("session and leaf totals are current", () => {
    expectCurrent(n => n.startsWith("Total"), "totals");
  });
});
