/**
 * Parity test: every groundwork:<x> agent listed in a "## Sub-delegation" or
 * "## Allowed spawns" section of agents/*.md must be permitted by DEPTH_ALLOWLIST
 * for that caller's agent type.
 *
 * Convention (also documented in doc/agent-template.md):
 *   - Spawn/escalate targets appear inside a `## Sub-delegation` or `## Allowed spawns` section.
 *   - Mentions of groundwork:<x> OUTSIDE these sections are references only (not checked).
 *   - Callers NOT in DEPTH_ALLOWLIST are unrestricted and pass automatically.
 */
import { describe, it, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DEPTH_ALLOWLIST } from "../../src/hooks/spawn-model-guard.js";

const ROOT = path.resolve(import.meta.dir, "../..");
const AGENTS_DIR = path.join(ROOT, "agents");

const SPAWN_SECTION_RE = /^##\s+(Sub-delegation|Allowed spawns)\s*\n([\s\S]*?)(?=^##\s|\s*$)/gm;
const AGENT_REF_RE = /`(groundwork:[a-z0-9-]+)`/g;

interface Finding {
  file: string;
  caller: string;
  spawn: string;
  allowed: string[];
}

function extractFrontmatterName(content: string): string | null {
  const m = content.match(/^---\n[\s\S]*?^name:\s*([^\n]+)/m);
  return m ? m[1].trim() : null;
}

function extractSpawnTargets(content: string): string[] {
  const targets: string[] = [];
  let m: RegExpExecArray | null;
  SPAWN_SECTION_RE.lastIndex = 0;
  while ((m = SPAWN_SECTION_RE.exec(content)) !== null) {
    const sectionBody = m[2];
    AGENT_REF_RE.lastIndex = 0;
    let ref: RegExpExecArray | null;
    while ((ref = AGENT_REF_RE.exec(sectionBody)) !== null) {
      targets.push(ref[1]);
    }
  }
  return targets;
}

const agentFiles = readdirSync(AGENTS_DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ name: f, absPath: path.join(AGENTS_DIR, f) }));

describe("agent-spawn-parity: spawn targets match DEPTH_ALLOWLIST", () => {
  for (const { name, absPath } of agentFiles) {
    it(`${name}: declared spawns are permitted by DEPTH_ALLOWLIST`, () => {
      const content = readFileSync(absPath, "utf8");
      const agentName = extractFrontmatterName(content);
      expect(agentName, `${name}: could not extract frontmatter name`).not.toBeNull();

      const callerKey = `groundwork:${agentName}`;
      const allowed = DEPTH_ALLOWLIST.get(callerKey);

      // If caller is not in DEPTH_ALLOWLIST, it's unrestricted — skip.
      if (!allowed) return;

      const targets = extractSpawnTargets(content);
      const violations: Finding[] = [];

      for (const spawn of targets) {
        if (!allowed.has(spawn)) {
          violations.push({
            file: name,
            caller: callerKey,
            spawn,
            allowed: [...allowed],
          });
        }
      }

      expect(
        violations,
        violations
          .map(
            (v) =>
              `${v.file}: "${v.caller}" may not spawn "${v.spawn}" — DEPTH_ALLOWLIST allows: [${v.allowed.join(", ") || "none"}]`,
          )
          .join("\n"),
      ).toHaveLength(0);
    });
  }
});
