import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, symlinkSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../../src/monitors/pr-conflict-watch.ts", import.meta.url).pathname;
const BUN_DIR = join(process.execPath, "..");
// PATH holds only the fake bin dir and bun, so a real gh never leaks in.
const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

type State = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
const pr = (mergeable: State, number = 940) => ({
  number, title: "Add thing", mergeable, baseRefName: "develop", headRefName: "feat", url: `https://github.com/o/r/pull/${number}`,
});

// Fake gh: `pr list` returns the Nth scripted JSON (last one repeats); other subcommands succeed.
function setup(opts: { sequence?: unknown[]; git?: boolean; gh?: boolean }) {
  const root = mkdtempSync(join(tmpdir(), "gw-prs-"));
  roots.push(root);
  const bin = join(root, "bin");
  const repo = join(root, "repo");
  mkdirSync(bin);
  mkdirSync(repo);
  if (opts.git !== false) spawnSync("git", ["init", "-q"], { cwd: repo });
  symlinkSync(Bun.which("git")!, join(bin, "git"));
  if (opts.gh !== false) {
    writeFileSync(join(root, "seq.json"), JSON.stringify(opts.sequence ?? [[]]));
    writeFileSync(join(root, "count"), "0");
    const gh = `#!/bin/sh
[ "$1" = pr ] || exit 0
exec ${JSON.stringify(process.execPath)} -e 'const fs=require("fs");const [d]=process.argv.slice(1);const n=+fs.readFileSync(d+"/count","utf8");fs.writeFileSync(d+"/count",String(n+1));const s=JSON.parse(fs.readFileSync(d+"/seq.json","utf8"));const v=s[Math.min(n,s.length-1)];if(v==="ERR"){console.error("HTTP 502");process.exit(1)}console.log(JSON.stringify(v))' "${root}"
`;
    writeFileSync(join(bin, "gh"), gh);
    chmodSync(join(bin, "gh"), 0o755);
  }
  return { bin, repo };
}

function watch(env: ReturnType<typeof setup>, polls: number) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: env.repo,
    encoding: "utf8",
    env: { HOME: env.repo, PATH: `${env.bin}:${BUN_DIR}`, GW_PRS_POLL_MS: "20", GW_PRS_MAX_POLLS: String(polls) },
    timeout: 20_000,
  });
  return { lines: r.stdout.split("\n").filter(Boolean), code: r.status };
}

describe("pr-conflict-watch", () => {
  it("emits exactly one line on MERGEABLE -> CONFLICTING", () => {
    const r = watch(setup({ sequence: [[pr("MERGEABLE")], [pr("CONFLICTING")], [pr("CONFLICTING")]] }), 4);
    expect(r.code).toBe(0);
    expect(r.lines).toEqual(["gw-prs: #940 CONFLICTING against develop: Add thing https://github.com/o/r/pull/940"]);
  });

  it("treats UNKNOWN as no change", () => {
    const r = watch(setup({ sequence: [[pr("MERGEABLE")], [pr("UNKNOWN")], [pr("MERGEABLE")]] }), 4);
    expect(r.lines).toEqual([]);
    const c = watch(setup({ sequence: [[pr("MERGEABLE")], [pr("UNKNOWN")], [pr("CONFLICTING")]] }), 4);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]).toContain("#940 CONFLICTING against develop");
  });

  it("emits one summary line when conflicting at start, then no repeats", () => {
    const r = watch(setup({ sequence: [[pr("CONFLICTING"), pr("MERGEABLE", 941)]] }), 4);
    expect(r.lines).toEqual(["gw-prs: 1 conflicting at start: #940 against develop"]);
  });

  it("prints one line and exits 0 outside a git repo", () => {
    const r = watch(setup({ git: false }), 2);
    expect(r.code).toBe(0);
    expect(r.lines).toEqual(["gw-prs: not a git repository; PR conflict watch is off"]);
  });

  it("prints one line and exits 0 when gh is missing", () => {
    const r = watch(setup({ gh: false }), 2);
    expect(r.code).toBe(0);
    expect(r.lines).toEqual(["gw-prs: gh is not installed; PR conflict watch is off"]);
  });

  it("emits one resolved line on CONFLICTING -> MERGEABLE", () => {
    const r = watch(setup({ sequence: [[pr("CONFLICTING")], [pr("MERGEABLE")]] }), 4);
    expect(r.lines).toEqual([
      "gw-prs: 1 conflicting at start: #940 against develop",
      "gw-prs: #940 resolved (now MERGEABLE): Add thing https://github.com/o/r/pull/940",
    ]);
  });

  it("reports a repeated error once and keeps polling", () => {
    const r = watch(setup({ sequence: [[pr("MERGEABLE")], "ERR", "ERR", [pr("CONFLICTING")]] }), 5);
    expect(r.code).toBe(0);
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toBe("gw-prs: error: HTTP 502");
    expect(r.lines[1]).toContain("#940 CONFLICTING");
  });
});
