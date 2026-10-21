import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const PLUGIN_ROOT = resolve(import.meta.dir, "../..");

export const CONVENTIONAL = { rules: { "commit-message": ["error", { preset: "conventional" }] } };

export const GIT_ENV: Record<string, string> = {
  ...(process.env as Record<string, string>),
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "T",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "T",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

export function git(cwd: string, args: string[], input?: string) {
  return spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", input });
}

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeRepo(config: object | null = CONVENTIONAL): string {
  const dir = tempDir("hr-commit-");
  git(dir, ["init", "-q", "-b", "main"]);
  if (config !== null) {
    writeFileSync(join(dir, ".house-rules.json"), JSON.stringify(config));
    git(dir, ["add", ".house-rules.json"]);
  }
  git(dir, ["commit", "-q", "--allow-empty", "-m", "chore: initial"]);
  return dir;
}

export function pluginHookCommand(event: string, script: string): string[] {
  const manifest = JSON.parse(readFileSync(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"), "utf8"));
  for (const group of manifest.hooks?.[event] ?? []) {
    for (const h of group.hooks ?? []) {
      if (typeof h.command === "string" && h.command.includes(script)) {
        return h.command.replaceAll("${CLAUDE_PLUGIN_ROOT}", PLUGIN_ROOT).split(" ");
      }
    }
  }
  throw new Error(`plugin.json has no ${event} hook running ${script}`);
}

export function runPluginHook(event: string, script: string, cwd: string, payload: Record<string, unknown>) {
  const [cmd, ...args] = pluginHookCommand(event, script);
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...GIT_ENV, CLAUDE_PROJECT_DIR: cwd, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    input: JSON.stringify({ hook_event_name: event, cwd, session_id: "test", ...payload }),
    encoding: "utf8",
  });
  return { stdout: r.stdout, stderr: r.stderr, exit: r.status };
}
