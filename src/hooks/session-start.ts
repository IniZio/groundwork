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
  const pluginRoot = env.CLAUDE_PLUGIN_ROOT
    ?? path.resolve(new URL(import.meta.url).pathname, "..", "..", "..");
  const gwNote = env.CLAUDE_PLUGIN_ROOT ? "" : " (path from hook; CLAUDE_PLUGIN_ROOT not set)";

  const additionalContext = `# groundwork v2

Classify, delegate, review. Never implement directly.

## gw

\`GW="bun ${pluginRoot}/src/cli/main.ts"\`${gwNote}

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
