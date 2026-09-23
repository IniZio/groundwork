import path from "node:path";

function isEmbedded(env: Record<string, string | undefined>): boolean {
  return env.CLAUDE_CODE_ENTRYPOINT === "sdk-py" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-js";
}

async function main() {
  if (isEmbedded(process.env as Record<string, string | undefined>)) {
    process.exit(0);
  }

  let input: Record<string, unknown> = {};
  try {
    const raw = await new Response(Bun.stdin.stream()).text();
    if (raw.trim()) input = JSON.parse(raw);
  } catch { /* proceed without session identity */ }

  const sessionId = typeof input.session_id === "string" ? input.session_id : "";
  const transcriptPath = typeof input.transcript_path === "string" ? input.transcript_path : "";

  const identityLines: string[] = [];
  if (sessionId) identityLines.push(`session_id: ${sessionId}`);
  if (transcriptPath) identityLines.push(`transcript_path: ${transcriptPath}`);

  const identityBlock = identityLines.length
    ? `\n\n## Session identity\n${identityLines.map(l => `- ${l}`).join("\n")}`
    : "";

  const env = process.env as Record<string, string | undefined>;

  // Derive root from this hook's own location — CLAUDE_PLUGIN_ROOT is unreliable
  // when multiple plugins are installed (resolves to whichever ran last).
  // File is at <root>/src/hooks/session-start.ts → root = 3 levels up.
  const pluginRoot = path.resolve(new URL(import.meta.url).pathname, "..", "..", "..");

  // Cross-check env; warn in output if they differ (signals a stale CLAUDE_PLUGIN_ROOT).
  const envRoot = env.CLAUDE_PLUGIN_ROOT ? path.resolve(env.CLAUDE_PLUGIN_ROOT) : null;
  const rootMismatchLine = envRoot && envRoot !== pluginRoot
    ? `> [groundwork] CLAUDE_PLUGIN_ROOT mismatch: env=${envRoot} hook=${pluginRoot} — using hook root\n\n`
    : "";

  // Version from plugin manifest (fail silently — cache copies may not have git).
  let version = "v2";
  try {
    const manifest = JSON.parse(await Bun.file(path.join(pluginRoot, ".claude-plugin/plugin.json")).text()) as Record<string, unknown>;
    if (typeof manifest.version === "string") version = `v${manifest.version}`;
  } catch { /* ignore */ }

  // Git sha — only when the root is a git checkout (cache copies may lack .git).
  let sha = "";
  try {
    const r = Bun.spawnSync(["git", "-C", pluginRoot, "rev-parse", "--short", "HEAD"], { stdout: "pipe", stderr: "pipe" });
    if (r.exitCode === 0) sha = r.stdout.toString().trim();
  } catch { /* not a git checkout */ }

  const shaLabel = sha ? ` (${sha})` : "";

  const additionalContext = `${rootMismatchLine}# groundwork ${version}${shaLabel} — ${pluginRoot}

Classify, delegate, review. Never implement directly.

## gw

\`GW="bun ${pluginRoot}/src/cli/main.ts"\`

\`$GW init\` → write token T. \`$GW slice add <id> --acceptance "..." --token T\`. \`$GW slice complete <id> --token T\`. \`$GW slice status\`. \`$GW gate approve --citation "file:line" --token T\`. \`$GW compile\` → resume view.

## Stop-gate

Blocks session end while any slice ≠ complete OR no GATE_APPROVE event. After 4 blocked attempts, releases with warning. Call \`$GW gate approve\` after advisor APPROVE.

## New-code-gate

Blocks on \`git diff HEAD\` violations of Makefile rules (\`# groundwork-rule: <name>\`). No active rules → always allows.

## Available mattpocock skills

\`mattpocock-skills:research\` · \`mattpocock-skills:tdd\` · \`mattpocock-skills:diagnosing-bugs\` · \`mattpocock-skills:code-review\` · \`mattpocock-skills:improve-codebase-architecture\` · \`mattpocock-skills:prototype\` · \`mattpocock-skills:grilling\` · \`mattpocock-skills:to-tickets\` · \`mattpocock-skills:handoff\`${identityBlock}`;

  const out = {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext,
    },
  };

  process.stdout.write(JSON.stringify(out) + "\n");
}

main().catch(err => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
