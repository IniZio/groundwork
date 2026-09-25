import { execSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

let _resolved = false;
let _path: string | null = null;

function resolveGofmt(): string | null {
  // Env override always re-read (test seam)
  const envOverride = process.env.HOUSE_RULES_GOFMT;
  if (envOverride !== undefined) {
    return envOverride === "" ? null : envOverride;
  }

  // Cache the non-env resolution per process
  if (_resolved) return _path;
  _resolved = true;

  // Try $(go env GOROOT)/bin/gofmt
  try {
    const goroot = execSync("go env GOROOT", { encoding: "utf8", timeout: 5000 }).trim();
    if (goroot) {
      const candidate = path.join(goroot, "bin", "gofmt");
      if (existsSync(candidate)) {
        _path = candidate;
        return _path;
      }
    }
  } catch { }

  try {
    const which = execSync("command -v gofmt", {
      encoding: "utf8",
      timeout: 5000,
      shell: "/bin/sh",
    }).trim();
    if (which) {
      _path = which;
      return _path;
    }
  } catch { }

  return null;
}

export function isGofmtAvailable(): boolean {
  return resolveGofmt() !== null;
}

export async function formatGo(
  src: string,
): Promise<{ ok: true; out: string } | { ok: false; reason: string }> {
  const gofmt = resolveGofmt();
  if (gofmt === null) return { ok: false, reason: "go-gofmt-unavailable" };

  const result = spawnSync(gofmt, [], {
    input: src,
    encoding: "utf8",
    timeout: 5000,
  });

  if (result.error || result.status !== 0) {
    return { ok: false, reason: "go-gofmt-failed" };
  }

  return { ok: true, out: result.stdout as string };
}

export async function isGofmtClean(src: string): Promise<boolean> {
  const r = await formatGo(src);
  if (!r.ok) return false;
  return r.out === src;
}
