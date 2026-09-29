import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { WorkStore } from "../../src/store/store.js";

const ROOT = path.resolve(import.meta.dir, "../..");
const HOOK = path.join(ROOT, "src/hooks/session-start.ts");

function run(payload: unknown, env: Record<string, string> = {}): { stdout: string; exit: number } {
  const r = spawnSync("bun", [HOOK], {
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, ...env },
    cwd: ROOT,
  });
  return { stdout: r.stdout?.toString() ?? "", exit: r.status ?? 1 };
}

describe("session-start hook", () => {
  it("emits SessionStart hookEventName", () => {
    const { stdout, exit } = run({ session_id: "test-123" });
    expect(exit).toBe(0);
    const out = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(out.hookSpecificOutput.hookEventName).toBe("SessionStart");
  });

  it("additionalContext defines GW invocation and uses $GW commands", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toMatch(/GW="bun .+\/src\/cli\/main\.ts"/);
    expect(out.hookSpecificOutput.additionalContext).toContain("$GW init");
    expect(out.hookSpecificOutput.additionalContext).toContain("$GW slice complete");
    expect(out.hookSpecificOutput.additionalContext).toContain("$GW gate approve");
  });

  it("additionalContext contains stop-gate, new-code-gate, and house-rules enforcement info", () => {
    const { stdout } = run({});
    const ctx = (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("Stop-gate");
    expect(ctx).toContain("New-code-gate");
    expect(ctx).toContain("house-rules enforcement");
    expect(ctx).toContain("house-rules");
    expect(ctx).not.toContain("Comment-density-gate");
  });

  it("house-rules paragraph names artifact-structure, sibling coexistence, not 'denies creation of synonym dirs'", () => {
    const { stdout } = run({});
    const ctx = (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("artifact-structure");
    expect(ctx).not.toContain("stray-artifacts");
    expect(ctx).toMatch(/sibling|coexist/i);
    expect(ctx).not.toContain("denies creation of synonym dirs");
  });

  it("additionalContext contains mattpocock skills", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("mattpocock-skills:");
  });

  it("includes session_id when present", () => {
    const { stdout } = run({ session_id: "abc-456", transcript_path: "/tmp/t.jsonl" });
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).toContain("abc-456");
    expect(out.hookSpecificOutput.additionalContext).toContain("/tmp/t.jsonl");
  });

  it("omits identity block when payload empty", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    expect(out.hookSpecificOutput.additionalContext).not.toContain("session_id:");
  });

  it("exits 0 silently for sdk-py embedded agent", () => {
    const { stdout, exit } = run({}, { CLAUDE_CODE_ENTRYPOINT: "sdk-py" });
    expect(exit).toBe(0);
    expect(stdout).toBe("");
  });

  it("exits 0 silently for sdk-js embedded agent", () => {
    const { stdout, exit } = run({}, { CLAUDE_CODE_ENTRYPOINT: "sdk-js" });
    expect(exit).toBe(0);
    expect(stdout).toBe("");
  });

  // AC: CLAUDE_PLUGIN_ROOT pointing at a foreign dir must not affect the GW path.
  // Bite proof: if we revert to env.CLAUDE_PLUGIN_ROOT ?? import.meta, this fails.
  it("GW path uses hook root even when CLAUDE_PLUGIN_ROOT is a foreign dir", () => {
    const { stdout } = run({}, { CLAUDE_PLUGIN_ROOT: "/tmp/foreign-plugin-root" });
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = out.hookSpecificOutput.additionalContext;
    // GW must point at the hook's actual root, not the foreign dir
    expect(ctx).toMatch(new RegExp(`GW="bun ${ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/src/cli/main\\.ts"`));
    expect(ctx).not.toContain("/tmp/foreign-plugin-root/src/cli/main.ts");
    // Mismatch warning must appear
    expect(ctx).toContain("CLAUDE_PLUGIN_ROOT mismatch");
  });

  it("additionalContext names version and root", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = out.hookSpecificOutput.additionalContext;
    // Header line: groundwork v<semver> [optionally (sha)] — <root>
    expect(ctx).toMatch(/# groundwork v\d+\.\d+\.\d+/);
    expect(ctx).toContain(ROOT);
  });

  it("additionalContext injects routing rules from rules/routing.md", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = out.hookSpecificOutput.additionalContext;
    // Routing section header
    expect(ctx).toContain("## Routing");
    // Dispatch rules
    expect(ctx).toContain("groundwork:debugger");
    expect(ctx).toContain("groundwork:explore");
    expect(ctx).toContain("Fan out agents in ONE message");
    expect(ctx).toContain("end turn");
    // A row from the routing table
    expect(ctx).toContain("groundwork:advisor");
  });

  it("additionalContext contains house-rules autofix and do-not-re-add sentences", () => {
    const { stdout } = run({});
    const ctx = (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("autofix, not another agent");
    expect(ctx).toContain("do not re-add the removed comments");
  });

  it("additionalContext injects authoring rules from rules/authoring-rules.md", () => {
    const { stdout } = run({});
    const out = JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } };
    const ctx = out.hookSpecificOutput.additionalContext;
    // Rules section header must be present
    expect(ctx).toContain("## Authoring rules");
    // The forbidden zones must appear
    expect(ctx).toMatch(/Negations inviolable/i);
    expect(ctx).toMatch(/Modality preserved/i);
    expect(ctx).toMatch(/Evidence verbatim/i);
    expect(ctx).toMatch(/Sequencing prose/i);
    expect(ctx).toMatch(/invented abbreviations/i);
  });

  it("additionalContext points at house-rules config and configure skill", () => {
    const { stdout } = run({});
    const ctx = (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).toContain("house-rules config");
    expect(ctx).toContain("house-rules:configure");
    expect(ctx).toContain("5 per 100");
    expect(ctx).not.toContain("default 5 per 100");
    expect(ctx).not.toContain("comment cap and stray-artifact rules come from");
    expect(ctx).toContain("Commit style comes from `.house-rules.json`");
  });

  it("additionalContext mentions no bypass route", () => {
    const bypass = /kill.?switch|bypass|GROUNDWORK_COMMIT|no-verify/i;
    expect(bypass.test("Set a kill-switch or use --no-verify to bypass the hook")).toBe(true);
    const { stdout } = run({});
    const ctx = (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;
    expect(ctx).not.toMatch(bypass);
  });
});

describe("session-start Where docs go", () => {
  const dirs: string[] = [];
  const NOTE = "not enforced — $GW recipe prints the .house-rules.json block";
  const HOST = {
    rules: {
      "artifact-structure": [
        "error",
        {
          types: {
            note: { tier: "working", generates: "notes/{slug}/note.md", description: "A note" },
          },
          forbidden: [{ pattern: "tmp/**", redirect: "Use notes/{slug}/" }],
        },
      ],
    },
  };

  function repo(seed?: string, houseRules?: unknown | string): string {
    const d = mkdtempSync(path.join(tmpdir(), "ss-docs-"));
    dirs.push(d);
    if (seed !== undefined) {
      mkdirSync(path.join(d, ".groundwork"), { recursive: true });
      const store = new WorkStore(path.join(d, ".groundwork", "work.db"));
      store.setActiveMotive(seed);
      store.close();
    }
    if (houseRules !== undefined) {
      writeFileSync(path.join(d, ".house-rules.json"), typeof houseRules === "string" ? houseRules : JSON.stringify(houseRules));
    }
    return d;
  }

  function spawnHook(dir: string): { ctx: string; exit: number } {
    const cmd = (JSON.parse(require("node:fs").readFileSync(path.join(ROOT, ".claude-plugin/plugin.json"), "utf8")) as {
      hooks: { SessionStart: { hooks: { command: string }[] }[] };
    }).hooks.SessionStart.flatMap(g => g.hooks.map(h => h.command)).find(c => c.includes("session-start.ts"))!;
    const env: Record<string, string | undefined> = { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PROJECT_DIR: dir };
    delete env.CLAUDE_CODE_ENTRYPOINT;
    const r = spawnSync("sh", ["-c", cmd], { input: "{}", env: env as NodeJS.ProcessEnv, cwd: dir });
    const out = r.stdout?.toString() ?? "";
    const ctx = out ? (JSON.parse(out) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext : "";
    return { ctx, exit: r.status ?? 1 };
  }

  function section(ctx: string): string[] {
    const after = ctx.split("## Where docs go\n")[1];
    if (after === undefined) return [];
    const lines: string[] = [];
    for (const l of after.split("\n")) {
      if (l.startsWith("#")) break;
      if (l.trim()) lines.push(l);
    }
    return lines;
  }

  const cleanup = () => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); };

  it("AC1 registered command emits Where docs go with <=8 lines and registry fallback note", () => {
    const d = repo("foo");
    const { ctx, exit } = spawnHook(d);
    expect(exit).toBe(0);
    const lines = section(ctx);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(lines).toContain(NOTE);
    expect(lines.join("\n")).toContain("motive (working)");
    cleanup();
  });

  it("AC1 host manifest with types is used and no fallback note appears", () => {
    const d = repo("foo", HOST);
    const lines = section(spawnHook(d).ctx);
    expect(lines).toContain("note (working): notes/foo/note.md — A note");
    expect(lines.join("\n")).not.toContain("not enforced");
    cleanup();
  });

  it("AC2 parity with house-rules structure output capped at 8 lines, {slug} substituted", () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 10; i++) many[`t${i}`] = { tier: "working", generates: `d${i}/{slug}/x.md`, description: `type ${i}` };
    const d = repo("foo", { rules: { "artifact-structure": ["error", { types: many }] } });
    spawnSync("git", ["init", "-q"], { cwd: d });
    const cli = spawnSync(path.join(ROOT, "plugins/house-rules/bin/house-rules"), ["structure"], { cwd: d, env: { ...process.env, CLAUDE_PROJECT_DIR: d } });
    expect(cli.status).toBe(0);
    let expected = cli.stdout.toString().trimEnd().split("\n");
    if (expected.length > 8) expected = [...expected.slice(0, 7), `… ${expected.length - 7} more; run \`house-rules structure\` for all`];
    expected = expected.map(l => l.replaceAll("{slug}", "foo"));
    expect(section(spawnHook(d).ctx)).toEqual(expected);
    cleanup();
  });

  it("AC3 active motive slug appears per repo, no ambient leak", () => {
    const a = repo("foo");
    const b = repo("bar");
    const ca = spawnHook(a).ctx;
    const cb = spawnHook(b).ctx;
    expect(section(ca).join("\n")).toContain(".groundwork/work/foo/");
    expect(section(cb).join("\n")).toContain(".groundwork/work/bar/");
    expect(section(cb).join("\n")).not.toContain("foo");
    expect(section(ca).join("\n")).not.toContain("bar");
    cleanup();
  });

  it("AC4 unseeded repo tells agent to select a motive, never work/default/", () => {
    const d = repo();
    const s = section(spawnHook(d).ctx);
    expect(s.length).toBeLessThanOrEqual(8);
    expect(s.join("\n")).toContain("$GW motive use <slug>");
    expect(s.join("\n")).not.toContain("work/default/");
    cleanup();
  });

  it("AC4 repo seeded default tells agent to select a motive, never work/default/", () => {
    const d = repo("default");
    const s = section(spawnHook(d).ctx);
    expect(s.length).toBeLessThanOrEqual(8);
    expect(s.join("\n")).toContain("$GW motive use <slug>");
    expect(s.join("\n")).not.toContain("work/default/");
    cleanup();
  });

  it("AC6 invalid host config omits the table but exits 0 with the rest of the context", () => {
    const d = repo("foo", "{ not json");
    const { ctx, exit } = spawnHook(d);
    expect(exit).toBe(0);
    expect(ctx).not.toContain("## Where docs go");
    expect(ctx).toContain("## Stop-gate");
    cleanup();
  });
});
