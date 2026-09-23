import path from "node:path";
import os from "node:os";

function isEmbedded(env: Record<string, string | undefined>): boolean {
  return env.CLAUDE_CODE_ENTRYPOINT === "sdk-py" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-js";
}

async function isCavemanActive(claudeDir: string): Promise<boolean> {
  try {
    const flag = await Bun.file(path.join(claudeDir, ".caveman-active")).text();
    const mode = flag.trim();
    return mode.length > 0 && mode !== "off";
  } catch {
    return false;
  }
}

const DELEGATION = "Bug→debugger; unknown loc→explore; fan-out 1 msg; end turn.";
const STYLE_PREFIX = "No articles/filler. ";

async function main() {
  const env = process.env as Record<string, string | undefined>;

  if (isEmbedded(env)) {
    process.exit(0);
  }

  if (env.GW_PROMPT_REMINDER_DISABLE === "1") {
    process.exit(0);
  }

  // Drain stdin (payload not used beyond caveman check)
  try {
    await new Response(Bun.stdin.stream()).text();
  } catch { /* ignore */ }

  const claudeDir = env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  const caveman = await isCavemanActive(claudeDir);

  // Caveman active: skip style half (caveman handles it), keep delegation.
  const line = caveman ? DELEGATION : STYLE_PREFIX + DELEGATION;

  const out = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: line,
    },
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch(() => process.exit(0));
