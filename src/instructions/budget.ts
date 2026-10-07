import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dir, "../..");
export const DOC = path.join(ROOT, "doc/instruction-budget.md");

export const FILE_ROWS: { surface: string; relPath: string }[] = [
  { surface: "orchestrator.md",          relPath: "agents/orchestrator.md" },
  { surface: "general-purpose / implementer.md", relPath: "agents/implementer.md" },
  { surface: "advisor.md",               relPath: "agents/advisor.md" },
  { surface: "qa.md",                    relPath: "agents/qa.md" },
  { surface: "implement/SKILL.md",       relPath: "skills/implement/SKILL.md" },
  { surface: "vertical-slice/SKILL.md",  relPath: "skills/vertical-slice/SKILL.md" },
  { surface: "advisor-gate/SKILL.md",    relPath: "skills/advisor-gate/SKILL.md" },
  { surface: "pause/SKILL.md",           relPath: "skills/pause/SKILL.md" },
  { surface: "continue/SKILL.md",        relPath: "skills/continue/SKILL.md" },
  { surface: "motive/SKILL.md",          relPath: "skills/motive/SKILL.md" },
];

export const INJECTION = "SessionStart injection";
export const REMINDER = "Per-turn reminder (UserPromptSubmit)";
export const REMINDER_TURN = "Per-turn reminder (per prompt)";
export const UPDATE_CMD = "bun run budget:update";

export const tokensOf = (bytes: number): number => Math.round(bytes / 4);

/** Spawn env with ambient hook-suppressing variables removed, so measurement never depends on the caller. */
function measureEnv(extra: Record<string, string>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, ...extra };
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.GW_PROMPT_REMINDER_DISABLE;
  return env;
}

export function injectionBytes(): number {
  const empty = mkdtempSync(path.join(tmpdir(), "budget-empty-"));
  const env = measureEnv({ CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PROJECT_DIR: empty });
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync("bun", [path.join(ROOT, "src/hooks/session-start.ts")], { input: "{}", env, cwd: empty });
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  if (result.status !== 0) throw new Error(`session-start hook exited ${result.status}: ${String(result.stderr)}`);
  const out = JSON.parse(String(result.stdout)) as { hookSpecificOutput: { additionalContext: string } };
  const rootEscaped = ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const norm = out.hookSpecificOutput.additionalContext
    .replace(new RegExp(rootEscaped, "g"), "/GROUNDWORK_ROOT")
    .replace(/\([0-9a-f]{7,40}\)/g, "(XXXXXXX)")
    .replace(/(?<=^# groundwork v)\d+\.\d+\.\d+/m, "X.Y.Z");
  return Buffer.byteLength(norm, "utf8");
}

/** Bytes of the UserPromptSubmit additionalContext, measured with no caveman flag (style half included). */
export function reminderBytes(): number {
  const empty = mkdtempSync(path.join(tmpdir(), "budget-empty-"));
  const env = measureEnv({ CLAUDE_CONFIG_DIR: empty, CLAUDE_PROJECT_DIR: empty });
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync("bun", [path.join(ROOT, "src/hooks/prompt-reminder.ts")], { input: "{}", env, cwd: empty });
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
  if (result.status !== 0) throw new Error(`prompt-reminder hook exited ${result.status}: ${String(result.stderr)}`);
  const out = JSON.parse(String(result.stdout)) as { hookSpecificOutput: { additionalContext: string } };
  return Buffer.byteLength(out.hookSpecificOutput.additionalContext, "utf8");
}

export function computeBytes(): Map<string, number> {
  const m = new Map<string, number>();
  for (const { surface, relPath } of FILE_ROWS) m.set(surface, statSync(path.join(ROOT, relPath)).size);
  m.set(INJECTION, injectionBytes());
  m.set(REMINDER, reminderBytes());
  return m;
}

const cells = (line: string) => line.split("|").slice(1, -1).map(c => c.trim());

/** Rewrite every computed row of the budget doc; unknown rows pass through. */
export function renderDoc(doc: string, bytes: Map<string, number>): string {
  const lines = doc.split("\n");
  const tok = (s: string) => tokensOf(bytes.get(s)!);
  const total = tok(INJECTION) + tok("orchestrator.md") + tok(REMINDER);
  const leaf = tok("general-purpose / implementer.md");
  let table = "";
  return lines.map(line => {
    if (line.startsWith("###")) table = line;
    if (!line.startsWith("|")) return line;
    const c = cells(line);
    const name = c[0];
    if (c.length === 3 && bytes.has(name)) return `| ${name} | ${bytes.get(name)} | ${tok(name)} |`;
    if (c.length !== 2) return line;
    if (name === "**Total (session start)**") return `| ${name} | **${total}** |`;
    if (name === "**Total**" && /per-leaf/i.test(table)) return `| ${name} | **${leaf}** |`;
    const key = name === "implementer / general-purpose.md" ? "general-purpose / implementer.md"
      : name === REMINDER_TURN ? REMINDER : name;
    return bytes.has(key) ? `| ${name} | ${tok(key)} |` : line;
  }).join("\n");
}

export const readDoc = (): string => readFileSync(DOC, "utf8");
