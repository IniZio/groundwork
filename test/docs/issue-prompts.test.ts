/**
 * Issue prompt conformance
 *
 * The `ticket` doc type was replaced by `issue`. Prompts must point agents to
 * a doc-type template, and no prompt may still prescribe the old ticket form.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");

const TEMPLATE_REF = /templates\/doc-types\/[a-z0-9-]+\.md/g;

const PROMPTS = [
  "doc/agents/issue-tracker.md",
  "doc/agents/triage-labels.md",
  "skills/pause/SKILL.md",
  "agents/researcher.md",
  "agents/planner.md",
];

/** Return a description of each old-ticket-form hit found in the text. */
export function findOldTicketForm(text: string): string[] {
  const hits: string[] = [];
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const n = i + 1;
    if (/templates\/doc-types\/ticket\.md/.test(line)) {
      hits.push(`${n}: ticket template path`);
    } else if (/(^|[^A-Za-z0-9_-])ticket\.md\b/.test(line)) {
      hits.push(`${n}: bare ticket.md reference`);
    }
    // Capital-S `Status:` is the old body line; lowercase `status:` is frontmatter.
    if (/`Status:`/.test(line) || /^\s*Status:/.test(line)) {
      hits.push(`${n}: Status: line prescription`);
    }
  });
  return hits;
}

function walkMd(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkMd(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

describe("issue prompts", () => {
  for (const rel of PROMPTS) {
    it(`${rel} names an existing doc-type template`, () => {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      const refs = text.match(TEMPLATE_REF) ?? [];
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(existsSync(path.join(ROOT, ref))).toBe(true);
      }
    });
  }

  it("no prompt under doc/, rules/, skills/, agents/ prescribes the old ticket form", () => {
    const files = ["doc", "rules", "skills", "agents"].flatMap((d) =>
      walkMd(path.join(ROOT, d)),
    );
    expect(files.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      for (const hit of findOldTicketForm(readFileSync(file, "utf8"))) {
        failures.push(`${rel}:${hit}`);
      }
    }
    expect(failures.join("\n")).toBe("");
  });

  describe("matcher positive control", () => {
    it("flags a Status: line prescription", () => {
      expect(
        findOldTicketForm("Default five roles, recorded as a `Status:` line.")
          .length,
      ).toBeGreaterThan(0);
    });
    it("flags the ticket template path", () => {
      expect(
        findOldTicketForm("Create it from templates/doc-types/ticket.md.")
          .length,
      ).toBeGreaterThan(0);
    });
    it("flags a Status: line inside an example", () => {
      expect(findOldTicketForm("Status: ready-for-agent").length).toBeGreaterThan(0);
    });
    it("does not flag lowercase frontmatter status", () => {
      expect(findOldTicketForm("status: todo")).toEqual([]);
    });
    it("does not flag the issue template path", () => {
      expect(findOldTicketForm("templates/doc-types/issue.md")).toEqual([]);
    });
  });
});
