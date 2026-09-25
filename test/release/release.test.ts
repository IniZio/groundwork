import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REL = join(
  import.meta.dir,
  "../../.claude/skills/release/scripts/release.ts"
);

function runRelease(cwd: string, args: string[]) {
  const r = spawnSync("bun", [REL, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    stdout: (r.stdout ?? "").trim(),
    stderr: (r.stderr ?? "").trim(),
    exitCode: r.status ?? 1,
  };
}

function gitIn(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeDualPluginRepo(
  tmpDir: string,
  opts?: {
    gwVersion?: string;
    hrVersion?: string;
    hrDepRange?: string;
  }
): string {
  const gw = opts?.gwVersion ?? "1.0.0";
  const hr = opts?.hrVersion ?? "0.1.0";

  gitIn(tmpDir, "init", "-b", "main");
  gitIn(tmpDir, "config", "user.name", "Fixture");
  gitIn(tmpDir, "config", "user.email", "fixture@example.invalid");
  gitIn(tmpDir, "config", "commit.gpgsign", "false");
  gitIn(tmpDir, "config", "core.hooksPath", "/dev/null");

  mkdirSync(join(tmpDir, ".claude-plugin"), { recursive: true });
  mkdirSync(join(tmpDir, "plugins/house-rules/.claude-plugin"), {
    recursive: true,
  });

  const deps = opts?.hrDepRange
    ? [{ name: "house-rules", version: opts.hrDepRange }]
    : [];

  writeFileSync(
    join(tmpDir, "package.json"),
    JSON.stringify({ name: "groundwork", version: gw }, null, 2) + "\n"
  );
  writeFileSync(
    join(tmpDir, ".claude-plugin/plugin.json"),
    JSON.stringify({ name: "groundwork", version: gw, dependencies: deps }, null, 2) + "\n"
  );
  writeFileSync(
    join(tmpDir, ".claude-plugin/marketplace.json"),
    JSON.stringify(
      {
        name: "groundwork",
        metadata: { version: gw },
        plugins: [
          { name: "groundwork", source: "./", version: gw },
          { name: "house-rules", source: "./plugins/house-rules", version: hr },
        ],
      },
      null,
      2
    ) + "\n"
  );
  writeFileSync(
    join(tmpDir, "plugins/house-rules/.claude-plugin/plugin.json"),
    JSON.stringify({ name: "house-rules", version: hr }, null, 2) + "\n"
  );

  gitIn(tmpDir, "add", ".");
  gitIn(tmpDir, "commit", "-m", "chore: initial commit");
  gitIn(tmpDir, "tag", "-a", `v${gw}`, "-m", `v${gw}`);
  gitIn(tmpDir, "tag", "-a", `house-rules-v${hr}`, "-m", `house-rules-v${hr}`);

  return tmpDir;
}

// ---------------------------------------------------------------------------
// Group 1: check outputs
// ---------------------------------------------------------------------------

describe("check", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeDualPluginRepo(mkdtempSync(join(tmpdir(), "gw-test-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("check prints groundwork version", () => {
    const r = runRelease(dir, ["check"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("1.0.0");
  });

  test("check --plugin house-rules prints house-rules version", () => {
    const r = runRelease(dir, ["check", "--plugin", "house-rules"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("0.1.0");
  });
});

// ---------------------------------------------------------------------------
// Group 2: bump isolation
// ---------------------------------------------------------------------------

describe("bump --plugin house-rules isolation", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeDualPluginRepo(mkdtempSync(join(tmpdir(), "gw-test-")), {
      gwVersion: "1.0.0",
      hrVersion: "1.0.0",
    });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("bump --plugin house-rules only touches house-rules fields", () => {
    const r = runRelease(dir, ["bump", "patch", "--plugin", "house-rules"]);
    expect(r.exitCode).toBe(0);

    const hrPlugin = JSON.parse(
      readFileSync(
        join(dir, "plugins/house-rules/.claude-plugin/plugin.json"),
        "utf8"
      )
    );
    expect(hrPlugin.version).toBe("1.0.1");

    const marketplace = JSON.parse(
      readFileSync(join(dir, ".claude-plugin/marketplace.json"), "utf8")
    );
    const hrEntry = marketplace.plugins.find((p: any) => p.name === "house-rules");
    expect(hrEntry.version).toBe("1.0.1");

    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.version).toBe("1.0.0");

    const gwPlugin = JSON.parse(
      readFileSync(join(dir, ".claude-plugin/plugin.json"), "utf8")
    );
    expect(gwPlugin.version).toBe("1.0.0");

    const gwEntry = marketplace.plugins.find((p: any) => p.name === "groundwork");
    expect(gwEntry.version).toBe("1.0.0");

    expect(marketplace.metadata.version).toBe("1.0.0");
  });
});

// ---------------------------------------------------------------------------
// Group 3: suggest path filtering
// ---------------------------------------------------------------------------

describe("suggest path filtering", () => {
  let dir: string;
  beforeEach(() => {
    dir = makeDualPluginRepo(mkdtempSync(join(tmpdir(), "gw-test-")));

    mkdirSync(join(dir, "plugins/house-rules/src"), { recursive: true });
    writeFileSync(join(dir, "plugins/house-rules/src/index.ts"), "// hr only");
    gitIn(dir, "add", "plugins/house-rules/src/index.ts");
    gitIn(dir, "commit", "-m", "fix(hr): house-rules only change");

    writeFileSync(join(dir, "src.ts"), "// gw only");
    gitIn(dir, "add", "src.ts");
    gitIn(dir, "commit", "-m", "feat: groundwork only change");

    writeFileSync(join(dir, "shared.ts"), "// both");
    writeFileSync(join(dir, "plugins/house-rules/shared.ts"), "// both hr");
    gitIn(dir, "add", "shared.ts", "plugins/house-rules/shared.ts");
    gitIn(dir, "commit", "-m", "fix: touches both plugins");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("suggest --plugin house-rules shows house-rules commits, not groundwork-only", () => {
    const r = runRelease(dir, ["suggest", "--plugin", "house-rules"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("house-rules only change");
    expect(r.stdout).toContain("touches both plugins");
    expect(r.stdout).not.toContain("groundwork only change");
  });

  test("suggest --plugin groundwork shows groundwork commits, not house-rules-only", () => {
    const r = runRelease(dir, ["suggest", "--plugin", "groundwork"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("groundwork only change");
    expect(r.stdout).toContain("touches both plugins");
    expect(r.stdout).not.toContain("house-rules only change");
  });

  test("suggest with no flag shows section for each plugin with commits", () => {
    const r = runRelease(dir, ["suggest"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[groundwork]");
    expect(r.stdout).toContain("[house-rules]");
  });
});

// ---------------------------------------------------------------------------
// Group 4: dep range check
// ---------------------------------------------------------------------------

describe("check dep range", () => {
  test("check fails when house-rules version does not satisfy declared range (tilde)", () => {
    const dir = makeDualPluginRepo(mkdtempSync(join(tmpdir(), "gw-test-")), {
      gwVersion: "1.0.0",
      hrVersion: "0.1.0",
      hrDepRange: "~0.4.0",
    });
    const r = runRelease(dir, ["check"]);
    rmSync(dir, { recursive: true, force: true });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("does not satisfy");
  });

  test("check passes when house-rules version satisfies declared range (tilde)", () => {
    const dir = makeDualPluginRepo(mkdtempSync(join(tmpdir(), "gw-test-")), {
      gwVersion: "1.0.0",
      hrVersion: "0.1.0",
      hrDepRange: "~0.1.0",
    });
    const r = runRelease(dir, ["check"]);
    rmSync(dir, { recursive: true, force: true });
    expect(r.exitCode).toBe(0);
  });

  test("check passes when no dep range declared", () => {
    const dir = makeDualPluginRepo(mkdtempSync(join(tmpdir(), "gw-test-")));
    const r = runRelease(dir, ["check"]);
    rmSync(dir, { recursive: true, force: true });
    expect(r.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Smoke test: real repo
// ---------------------------------------------------------------------------

test("real repo check prints the package.json version", () => {
  const repoDir = join(import.meta.dir, "../..");
  const expectedVersion = JSON.parse(
    readFileSync(join(repoDir, "package.json"), "utf8")
  ).version as string;
  const r = runRelease(repoDir, ["check"]);
  expect(r.exitCode).toBe(0);
  expect(r.stdout).toBe(expectedVersion);
});
