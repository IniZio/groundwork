import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LANGUAGE_ADAPTERS, LANGUAGES } from "../../src/hooks/languages/registry.js";
import type { LanguageDetection, LanguageGrammar } from "../../src/hooks/languages/registry.js";

const PLUGIN_DIR = path.resolve(import.meta.dir, "../..");
const README = path.join(PLUGIN_DIR, "README.md");
const START = "<!-- languages:start -->";
const END = "<!-- languages:end -->";

function renderDetectedBy(detect: LanguageDetection): string {
  const parts: string[] = [detect.extensions.map((e) => `\`${e}\``).join(", ")];
  if (detect.basenames?.length) parts.push("basenames: " + detect.basenames.map((b) => `\`${b}\``).join(", "));
  if (detect.basenamePrefixes?.length) parts.push("prefixes: " + detect.basenamePrefixes.map((p) => `\`${p}\``).join(", "));
  if (detect.shebangInterpreters?.length) parts.push("shebang: " + detect.shebangInterpreters.map((s) => `\`${s}\``).join(", "));
  return parts.join("; ");
}

function renderGrammarSource(grammar: LanguageGrammar): string {
  if (grammar.vendor) return `vendored from \`${grammar.vendor.package}\``;
  return `built from source by \`${grammar.build}\``;
}

function renderLanguagesTable(): string {
  const rows = LANGUAGES.map((id) => {
    const { detect, grammar } = LANGUAGE_ADAPTERS[id];
    return `| ${id} | ${renderDetectedBy(detect)} | ${renderGrammarSource(grammar)} |`;
  });
  return [
    "| Language | Detected by | Grammar source |",
    "|---|---|---|",
    ...rows,
    "",
    "Files in other languages are not measured.",
  ].join("\n");
}

function extractSection(readme: string): string {
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx === -1 || endIdx === -1) return "";
  return readme.slice(startIdx + START.length + 1, endIdx - 1);
}

describe("README languages section", () => {
  it("matches the registry exactly", () => {
    const readme = readFileSync(README, "utf8");
    const section = extractSection(readme);
    const expected = renderLanguagesTable();
    const missing = LANGUAGES.filter((id) => !section.includes(`| ${id} |`));
    const hint = missing.length > 0 ? ` Missing: ${missing.join(", ")}.` : "";
    expect(
      section,
      `README languages table is out of date with the registry — update the section between ${START} and ${END}.${hint}`,
    ).toBe(expected);
  });

  it("contains each registry id as exactly one table row", () => {
    const readme = readFileSync(README, "utf8");
    const startIdx = readme.indexOf(START);
    const endIdx = readme.indexOf(END);
    const section = startIdx !== -1 && endIdx !== -1 ? readme.slice(startIdx, endIdx + END.length) : "";
    for (const id of LANGUAGES) {
      const rowMatches = (section.match(new RegExp(`^\\| ${id} \\|`, "mg")) ?? []).length;
      expect(rowMatches, `language id "${id}" should appear as exactly one table row in the README languages section`).toBe(1);
    }
  });
});
