import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/approve-guard.ts");

function run(command: string, tool = "Bash"): { stdout: string; exit: number } {
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT } as Record<string, string | undefined>;
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const r = spawnSync("bun", [HOOK], { input: JSON.stringify({ tool_name: tool, tool_input: { command } }), env: env as NodeJS.ProcessEnv, cwd: ROOT, timeout: 15_000 });
  return { stdout: r.stdout?.toString() ?? "", exit: r.status ?? 1 };
}
function decision(stdout: string): string {
  const s = stdout.trim();
  if (!s) return "allow";
  return (JSON.parse(s) as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision;
}

const DENY = [
  "echo $'\\' #'; gw approve spec",
  "gw approve charter --token T",
  "gw approve spec --token T",
  "$GW approve spec --token T",
  '"$GW" approve charter',
  "${GW} approve spec",
  "/home/u/.local/bin/gw approve spec --token T",
  "bun /x/src/cli/main.ts approve charter --token T",
  "bun run /x/src/cli/main.ts approve spec",
  "FOO=1 gw approve spec",
  "env -i /usr/bin/gw approve spec",
  "cd /x && gw approve spec --token T",
  "true; gw approve charter",
  "echo hi | gw approve spec",
  'bash -c "gw approve spec --token T"',
  "sh -c 'gw approve charter'",
  "echo $(gw approve spec)",
  "gw approve spec --auto-not --token T",
  "gw approve   spec",
  "echo --auto; gw approve spec",
  "gw approve spec\ngw approve spec --auto",
  "gw approve spec # --auto",
  'gw approve "sp""ec"',
  'gw appr""ove spec',
  "x=spec; gw approve $x",
  "echo ' #'; gw approve spec",
  'echo "a #"; gw approve spec',
  "x=' #'; gw approve spec --token T",
  "bash -c 'gw approve spec --token T' --auto",
  "gw approve spec --token T > --auto",
  "H='#'; bash -c \"gw approve spec --token T $H --auto\"",
  "H='#'; eval gw approve spec --token T ${H} --auto",
  "gw approve spec --token T --auto",
  "gw approve $K --auto",
  "gw approve spec --auto > /dev/null",
  "bash -lc 'gw approve spec --auto'",
];

describe("approve-guard by path", () => {
  it("positive control: plain `gw approve spec` denies with `!` guidance", () => {
    const r = run("gw approve spec");
    expect(r.exit).toBe(0);
    expect(decision(r.stdout)).toBe("deny");
    expect(r.stdout).toContain("`!`");
  });
  for (const c of DENY) it(`deny: ${JSON.stringify(c)}`, () => expect(decision(run(c).stdout)).toBe("deny"));

  const ALLOW = [
    "gw approve spec --auto --token T",
    "gw approve charter --auto",
    'gw approve "spec" --auto',
    "$GW approve spec --auto",
    "$GW approve spec --auto --token T",
    '"$GW" approve spec --auto --token T',
    "${GW} approve spec --auto --token T",
    "bun /x/src/cli/main.ts approve spec --auto",
    "/usr/bin/gw approve spec --auto",
    "gw approve spec --auto # done",
    "gw approve spec --auto # note",
    "gw gate status",
    "ls approve",
  ];
  for (const c of ALLOW) it(`allow: ${JSON.stringify(c)}`, () => expect(decision(run(c).stdout)).toBe("allow"));

  it("non-Bash tool is ignored", () => expect(decision(run("gw approve spec", "Read").stdout)).toBe("allow"));
});
