import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const KEY = "mattpocock-skills@mattpocock";
const REPO = "mattpocock/skills";

function fail(msg: string): never {
  console.error(`upstream:check ERROR: ${msg}`);
  process.exit(2);
}

let installed: { version: string; gitCommitSha: string };
try {
  const file = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json");
  const entries = JSON.parse(readFileSync(file, "utf8")).plugins?.[KEY];
  if (!entries?.length) fail(`${KEY} not installed`);
  installed = entries[0];
} catch (e) {
  fail(`cannot read installed plugins: ${(e as Error).message}`);
}

let upstreamSha: string;
let upstreamVersion: string;
try {
  const ls = Bun.spawnSync(["git", "ls-remote", `https://github.com/${REPO}.git`, "HEAD"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (ls.exitCode !== 0) fail(`git ls-remote failed: ${ls.stderr.toString().trim()}`);
  upstreamSha = ls.stdout.toString().split(/\s/)[0];
  if (!/^[0-9a-f]{40}$/.test(upstreamSha)) fail("git ls-remote returned no HEAD sha");
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${upstreamSha}/.claude-plugin/plugin.json`);
  if (!res.ok) fail(`fetch plugin.json failed: HTTP ${res.status}`);
  upstreamVersion = (await res.json()).version;
} catch (e) {
  fail(`network failure: ${(e as Error).message}`);
}

console.log(`installed: ${installed.version} ${installed.gitCommitSha}`);
console.log(`upstream:  ${upstreamVersion} ${upstreamSha}`);
if (installed.gitCommitSha === upstreamSha && installed.version === upstreamVersion) {
  console.log("verdict: OK, installed matches upstream HEAD");
} else {
  console.log("verdict: DRIFT, installed differs from upstream HEAD");
  process.exit(1);
}
