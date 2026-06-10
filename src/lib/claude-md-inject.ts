import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MARKER_START = "<!-- GW:START -->";
const MARKER_END = "<!-- GW:END -->";

/**
 * Injects content into a project's CLAUDE.md within GW:START/END markers.
 * - If markers exist: replaces content between them in-place
 * - If no markers: appends the bounded block
 * - If file doesn't exist: creates it with just the bounded block
 * - Never modifies content outside the markers
 */
export function injectClaudeMd(projectDir: string, content: string): void {
  if (content.includes(MARKER_START) || content.includes(MARKER_END)) {
    throw new Error("injected content must not contain GW marker strings");
  }

  const filePath = join(projectDir, "CLAUDE.md");
  const block = `${MARKER_START}\n${content}\n${MARKER_END}`;

  if (!existsSync(filePath)) {
    writeFileSync(filePath, block + "\n", "utf8");
    return;
  }

  const existing = readFileSync(filePath, "utf8");
  const startIdx = existing.indexOf(MARKER_START);
  const endIdx = existing.indexOf(MARKER_END);
  const markersValid = startIdx !== -1 && endIdx !== -1 && startIdx < endIdx;

  if (!markersValid) {
    // No markers (or malformed ordering): append
    const separator = existing.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(filePath, existing + separator + block + "\n", "utf8");
    return;
  }

  // Replace in-place: preserve before-marker and after-marker content
  const before = existing.slice(0, startIdx);
  const after = existing.slice(endIdx + MARKER_END.length);
  writeFileSync(filePath, before + block + after, "utf8");
}
