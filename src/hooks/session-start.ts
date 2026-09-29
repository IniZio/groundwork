import path from "node:path";

function isEmbedded(env: Record<string, string | undefined>): boolean {
  return env.CLAUDE_CODE_ENTRYPOINT === "sdk-py" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-js";
}

const DOCS_MAX_LINES = 8;

// Fails open: any error omits the table, never the rest of the context.
async function whereDocsGoBlock(env: Record<string, string | undefined>): Promise<string> {
  try {
    const root = env.CLAUDE_PROJECT_DIR || process.cwd();
    const { resolveConfig } = await import("../../hooks/lib/house-rules-config/resolve.mjs");
    const { renderStructure } = await import("../../hooks/lib/house-rules-config/structure.mjs");
    const { activeSlug } = await import("../store/work-units.js");

    const slug = activeSlug(root);
    const extra: string[] = [];
    if (!slug) extra.push("no active motive — select one with `$GW motive use <slug> --token T` before writing docs");

    let manifest = resolveConfig(root).rules["artifact-structure"].options as Record<string, unknown>;
    if (!Object.keys((manifest.types as object | undefined) ?? {}).length) {
      const { WORKING_TYPES, FORBIDDEN } = await import("./doc-registry.js");
      const types: Record<string, { tier: string; generates: string; description: string }> = {};
      for (const [id, t] of Object.entries(WORKING_TYPES) as [string, { tier: string; generates: string; description: string }][]) {
        types[id] = { tier: t.tier, generates: t.generates, description: t.description };
      }
      manifest = { types, forbidden: FORBIDDEN };
      extra.push("not enforced — $GW recipe prints the .house-rules.json block");
    }

    const lines = (renderStructure(manifest, { maxLines: DOCS_MAX_LINES - extra.length }) as string[])
      .map(l => l.replaceAll("{slug}", slug ?? "<slug>"));
    const noteFirst = extra.filter(l => l.startsWith("no active"));
    const noteLast = extra.filter(l => l.startsWith("not enforced"));
    return `\n\n## Where docs go\n${[...noteFirst, ...lines, ...noteLast].join("\n")}`;
  } catch {
    return "";
  }
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

  // Authoring rules — read from single source, no inline duplicate.
  let authoringRules = "";
  try {
    authoringRules = await Bun.file(path.join(pluginRoot, "rules/authoring-rules.md")).text();
  } catch { /* absent in cache copies — skip silently */ }

  const authoringRulesBlock = authoringRules
    ? `\n\n## Authoring rules\n\n${authoringRules.trim()}`
    : "";

  // Routing rules — read from single source, no inline duplicate.
  let routingRules = "";
  try {
    routingRules = await Bun.file(path.join(pluginRoot, "rules/routing.md")).text();
  } catch { /* absent in cache copies — skip silently */ }

  const routingRulesBlock = routingRules
    ? `\n\n${routingRules.trim()}`
    : "";

  const docsBlock = await whereDocsGoBlock(env);

  const additionalContext = `${rootMismatchLine}# groundwork ${version}${shaLabel} — ${pluginRoot}

Classify, delegate, review. Never implement directly.

## gw

\`GW="bun ${pluginRoot}/src/cli/main.ts"\`

\`$GW init\` → write token T. \`$GW slice add <id> --acceptance "..." --token T\`. \`$GW slice complete <id> --token T\`. \`$GW slice status\`. \`$GW gate approve --citation "file:line" --token T\`. \`$GW compile\` → resume view.

## Stop-gate

Blocks session end while any slice ≠ complete OR no GATE_APPROVE event. After 4 blocked attempts, releases with warning. Call \`$GW gate approve\` after advisor APPROVE.

## New-code-gate

Blocks on \`git diff HEAD\` violations of Makefile rules (\`# groundwork-rule: <name>\`). No active rules → always allows.

## house-rules enforcement

Comment density and artifact structure are enforced by the \`house-rules\` plugin dependency (requires Claude Code v2.1.193+). The comment-density rule caps net-new comments at 5 per 100 added lines; the per-edit guard strips over-budget comments before Write/Edit/MultiEdit for every language house-rules registers (see its README) — other languages pass through — and the gate blocks at Stop/SubagentStop. The artifact-structure rule denies writing into either synonym dir (doc/docs, test/tests, script/scripts, util/utils, lib/libs) when its sibling already exists at the same parent — a lone docs/ or doc/ is fine — and denies root scratch files (test-*.{js,mjs,ts}, *.bak, tmp*, scratch*). The gate may auto-trim over-budget comments at turn end, so a later "file changed since last Read" on such a file is expected — it is autofix, not another agent. Re-read the file before editing and do not re-add the removed comments; a comment that must stay should explain a non-obvious why.\n\nCommit style comes from \`.house-rules.json\`; run \`house-rules config\` to see active values and their source, and load \`house-rules:configure\` to change it. Loosening a rule is a human decision.${docsBlock}${routingRulesBlock}${authoringRulesBlock}${identityBlock}`;

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
