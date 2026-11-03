import { spawnSync } from "node:child_process";
import type { Pr } from "./pr-schemas.js";
import { isPrList } from "./generated/pr-validators.mjs";

const PREFIX = "gw-prs:";
const out = (line: string) => process.stdout.write(`${line}\n`);

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 60_000 });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: (r.stderr ?? "").trim() || String(r.error ?? "") };
}

function conflictLine(pr: Pr) {
  return `${PREFIX} #${pr.number} CONFLICTING against ${pr.baseRefName}: ${pr.title} ${pr.url}`;
}

function listPrs() {
  const r = run("gh", [
    "pr", "list", "--author", "@me", "--state", "open",
    "--json", "number,title,mergeable,baseRefName,headRefName,url",
  ]);
  if (!r.ok) return { error: r.stderr.split("\n")[0] || "gh pr list failed" };
  let json: unknown;
  try { json = JSON.parse(r.stdout); } catch { return { error: "gh pr list returned invalid JSON" }; }
  return isPrList(json) ? { prs: json } : { error: "gh pr list returned an unexpected shape" };
}

async function main() {
  const intervalMs = Number(process.env.GW_PRS_POLL_MS ?? 120_000);
  const maxPolls = Number(process.env.GW_PRS_MAX_POLLS ?? Infinity);
  const projectDir = process.argv[2];
  if (projectDir) process.chdir(projectDir);

  if (!run("git", ["rev-parse", "--is-inside-work-tree"]).ok) {
    out(`${PREFIX} not a git repository; PR conflict watch is off`);
    return;
  }
  if (!Bun.which("gh")) {
    out(`${PREFIX} gh is not installed; PR conflict watch is off`);
    return;
  }
  if (!run("gh", ["auth", "status"]).ok) {
    out(`${PREFIX} gh is not authenticated; run gh auth login. PR conflict watch is off`);
    return;
  }
  if (!run("gh", ["repo", "view", "--json", "nameWithOwner"]).ok) {
    out(`${PREFIX} no GitHub remote for this repository; PR conflict watch is off`);
    return;
  }

  const known = new Map<number, boolean>();
  let lastError: string | undefined;

  for (let poll = 0; poll < maxPolls; poll++) {
    if (poll > 0) await Bun.sleep(intervalMs);
    const res = listPrs();
    if ("error" in res) {
      if (res.error !== lastError) out(`${PREFIX} error: ${res.error}`);
      lastError = res.error;
      continue;
    }
    lastError = undefined;

    const open = new Set(res.prs.map((p) => p.number));
    for (const n of known.keys()) if (!open.has(n)) known.delete(n);

    if (poll === 0) {
      const conflicting = res.prs.filter((p) => p.mergeable === "CONFLICTING");
      for (const p of res.prs) if (p.mergeable !== "UNKNOWN") known.set(p.number, p.mergeable === "CONFLICTING");
      if (conflicting.length > 0) {
        const list = conflicting.map((p) => `#${p.number} against ${p.baseRefName}`).join(", ");
        out(`${PREFIX} ${conflicting.length} conflicting at start: ${list}`);
      }
      continue;
    }

    for (const p of res.prs) {
      if (p.mergeable === "UNKNOWN") continue;
      const now = p.mergeable === "CONFLICTING";
      const was = known.get(p.number);
      known.set(p.number, now);
      if (now && !was) out(conflictLine(p));
      else if (!now && was) out(`${PREFIX} #${p.number} resolved (now ${p.mergeable}): ${p.title} ${p.url}`);
    }
  }
}

await main();
