import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildJournald } from "../../src/store/scope-notify.js";
import { parsePointer } from "../../src/store/scope-pointer.js";

const DOC = path.join(import.meta.dir, "..", "..", "doc", "spec", "nested-work-scope.md");
const doc = readFileSync(DOC, "utf8");

function example(): Record<string, unknown> {
  const m = /```json\n([\s\S]*?)```/.exec(doc);
  if (!m) throw new Error("no json example in doc");
  return JSON.parse(m[1]);
}

function tableRows(): { name: string; required: boolean }[] {
  const lines = doc.split("\n");
  const start = lines.findIndex((l) => /^\|\s*Field\s*\|/.test(l));
  if (start < 0) throw new Error("no field table in doc");
  const rows: { name: string; required: boolean }[] = [];
  for (const l of lines.slice(start + 2)) {
    if (!l.startsWith("|")) break;
    const c = l.split("|").map((s) => s.trim());
    rows.push({ name: c[1], required: c[3] === "yes" });
  }
  return rows;
}

describe("scope pointer doc", () => {
  it("json example parses through parsePointer", () => {
    expect(() => parsePointer(example())).not.toThrow();
  });

  it("example uses exactly the documented fields", () => {
    expect(Object.keys(example()).sort()).toEqual(tableRows().map((r) => r.name).sort());
  });

  it("field table matches the keys parsePointer reads", () => {
    const full = example();
    const parsed = parsePointer(full) as unknown as Record<string, unknown>;
    const accepted = Object.keys(parsed).sort();
    expect(tableRows().map((r) => r.name).sort()).toEqual(accepted);
    for (const { name, required } of tableRows()) {
      const copy = { ...full };
      delete copy[name];
      if (required) expect(() => parsePointer(copy)).toThrow();
      else expect(() => parsePointer(copy)).not.toThrow();
    }
  });

  it("higher version is a hard error", () => {
    expect(() => parsePointer({ ...example(), v: 2 })).toThrow();
  });

  it("Notifications table matches the journald fields emitted", () => {
    const sec = /## Notifications\n([\s\S]*?)\n## /.exec(doc);
    if (!sec) throw new Error("no Notifications section");
    const documented = [...sec[1].matchAll(/^\| (CE_\w+|MESSAGE) \|/gm)].map((m) => m[1]);
    const emitted = buildJournald({
      id: "i", type: "groundwork.child_gate", source: "s", linkId: "l", time: "t", message: "{}",
    })!.trimEnd().split("\n").map((l) => l.split("=")[0]);
    expect(documented).toEqual(emitted);
    expect(sec[1]).toContain("/run/systemd/journal/socket");
    expect(sec[1]).toContain("/dev/log");
    expect(sec[1]).toContain("ce@32473");
  });
});
