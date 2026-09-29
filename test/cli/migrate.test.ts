import { describe, it, expect, afterAll } from "bun:test";
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync,
  readdirSync, statSync, lstatSync, readlinkSync, symlinkSync, utimesSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");
const INSTALLER = path.resolve(import.meta.dir, "../../src/hooks/session-commit-msg-installer.ts");
const root = mkdtempSync(path.join(tmpdir(), "gw-migrate-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const baseEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
} as Record<string, string>;
delete baseEnv.GROUNDWORK_DB;
delete baseEnv.CLAUDE_PROJECT_DIR;

let n = 0;
interface Ctx { d: string; gwd: string; env: Record<string, string>; token: string }

function run(cmd: string, args: string[], c: { d: string; env: Record<string, string> }) {
  return spawnSync(cmd, args, { cwd: c.d, env: c.env, encoding: "utf8", timeout: 30000 });
}
const git = (c: Ctx, ...a: string[]) => run("git", a, c);
const gw = (c: Ctx, ...a: string[]) => run("bun", [MAIN, ...a], c);
const AR = "→";

const MOTIVE_A = "---\nstatus: complete\ncreated: 2026-03-05\n---\n# a\nbody a\n";
const MOTIVE_B = "---\nstatus: active\ncreated: 2026-04-01\n---\n# bravo\n";
const MOTIVE_C = "---\ncreated: 2026-05-02\n---\n# c\n";
const SPEC_F = "# spec f\nline\n";

function put(c: Ctx, rel: string, body: string) {
  const f = path.join(c.gwd, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, body);
}

/** Temp git repo, initialised via `gw init`, with the pre-migration layout seeded. */
function makeRepo(): Ctx {
  const base = path.join(root, `r${n++}`);
  const d = path.join(base, "repo");
  mkdirSync(d, { recursive: true });
  const env = { ...baseEnv, XDG_CONFIG_HOME: path.join(base, "xdg") };
  const c = { d, gwd: path.join(d, ".groundwork"), env, token: "" } as Ctx;
  git(c, "init", "-q");
  const init = gw(c, "init");
  expect(init.status).toBe(0);
  const m = /token: (\S+)/.exec(init.stdout);
  expect(m).not.toBeNull();
  c.token = m![1];

  put(c, "motives/a/motive.md", MOTIVE_A);
  put(c, "motives/a/notes.md", "notes a\n");
  put(c, "motives/bravo-unit/motive.md", MOTIVE_B);
  put(c, "motives/c/motive.md", MOTIVE_C);
  const sf = path.join(c.d, ".scratch/f/spec.md");
  mkdirSync(path.dirname(sf), { recursive: true });
  writeFileSync(sf, SPEC_F);
  put(c, "handoffs/h.md", "handoff\n");
  put(c, "research/r.md", "research\n");
  put(c, "specs/s.md", "spec s\n");
  put(c, "archive/motives/old-zulu-unit/motive.md", "---\ncreated: 2025-01-01\n---\n# old\n");
  put(c, "pause-state.md", "paused\n");
  // never-touch entries
  if (!existsSync(path.join(c.gwd, "work.db"))) put(c, "work.db", "SQLITEDATA");
  put(c, "work.db-wal", "wal");
  put(c, "stop-gate.json", "{}\n");
  put(c, "profile.md", "profile\n");
  put(c, "unknowns.md", "unknowns\n");
  put(c, "skills/x/SKILL.md", "skill\n");
  put(c, "work/existing/motive.md", "---\ncreated: 2026-01-01\n---\n# existing\n");
  put(c, "archive/2026-01/z/motive.md", "---\ncreated: 2026-01-01\n---\n# z\n");
  put(c, "archive/legacy/prev/x.md", "prev\n");
  return c;
}

/** Every path (files and dirs) plus file content hash; independent of mtimes. */
function snapshot(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${e}` : e;
    const full = path.join(dir, r);
    // Links are recorded by target text, never followed.
    if (lstatSync(full).isSymbolicLink()) { out.push(`L ${r} ${readlinkSync(full)}`); continue; }
    if (statSync(full).isDirectory()) { out.push(`D ${r}`, ...snapshot(dir, r)); }
    else out.push(`F ${r} ${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
  }
  return out;
}
const treeHash = (c: Ctx) =>
  createHash("sha256").update(snapshot(c.d).filter(l => !/^. \.git(\/|$)/.test(l)).join("\n")).digest("hex");
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const lines = (s: string) => s.split("\n").filter(l => l !== "");
const rd = (c: Ctx, rel: string) => readFileSync(path.join(c.gwd, rel), "utf8");
const has = (c: Ctx, rel: string) => existsSync(path.join(c.gwd, rel));

const PLAN = [
  `motives/a ${AR} archive/2026-03/a`,
  `motives/bravo-unit ${AR} work/bravo-unit`,
  `motives/c ${AR} work/c [unclassified]`,
  `.scratch/f ${AR} work/f`,
  `archive/motives ${AR} archive/legacy/motives`,
  `handoffs ${AR} archive/legacy/handoffs`,
  `pause-state.md ${AR} archive/legacy/pause-state.md`,
  `research ${AR} archive/legacy/research`,
  `specs ${AR} archive/legacy/specs`,
];

const NEVER = [
  "work.db", "work.db-wal", "stop-gate.json", "profile.md", "unknowns.md",
  "skills/x/SKILL.md", "work/existing/motive.md",
  "archive/2026-01/z/motive.md", "archive/legacy/prev/x.md",
];

describe("gw migrate", () => {
  it("AC1: dry run prints the exact ordered plan, exits 0 and changes nothing", () => {
    const c = makeRepo();
    const before = treeHash(c);
    const r = gw(c, "migrate");
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual(PLAN);
    expect(r.stdout).not.toContain("left in place");
    expect(treeHash(c)).toBe(before);
  });

  it("AC2: never-touch paths are absent from the plan and unchanged after apply", () => {
    const c = makeRepo();
    // The token check opens work.db as SQLite, which may drop the fake -wal; only presence is asserted for those.
    const bytes = NEVER.filter(f => !f.startsWith("work.db"));
    const before = new Map(bytes.map(f => [f, sha(path.join(c.gwd, f))]));
    const dry = gw(c, "migrate");
    for (const l of lines(dry.stdout)) {
      for (const p of ["work.db", "stop-gate", "profile.md", "unknowns.md", "skills", "work/existing", "2026-01", "legacy/prev"]) {
        expect(l.split(` ${AR} `)[0]).not.toContain(p);
      }
    }
    const r = gw(c, "migrate", "--apply", "--token", c.token);
    expect(r.status).toBe(0);
    for (const f of bytes) expect(sha(path.join(c.gwd, f))).toBe(before.get(f)!);
    expect(has(c, "work.db")).toBe(true);
  });

  it("AC3: apply prints the dry-run plan, legacy content byte-identical, sources gone", () => {
    const c = makeRepo();
    const legacyBefore: Record<string, string> = {
      "archive/legacy/handoffs/h.md": sha(path.join(c.gwd, "handoffs/h.md")),
      "archive/legacy/research/r.md": sha(path.join(c.gwd, "research/r.md")),
      "archive/legacy/motives/old-zulu-unit/motive.md": sha(path.join(c.gwd, "archive/motives/old-zulu-unit/motive.md")),
      "archive/legacy/pause-state.md": sha(path.join(c.gwd, "pause-state.md")),
      "archive/legacy/specs/s.md": sha(path.join(c.gwd, "specs/s.md")),
    };
    const dry = gw(c, "migrate");
    const r = gw(c, "migrate", "--apply", "--token", c.token);
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual(lines(dry.stdout));
    for (const [f, h] of Object.entries(legacyBefore)) expect(sha(path.join(c.gwd, f))).toBe(h);
    expect(has(c, "motives")).toBe(false);
    expect(existsSync(path.join(c.d, ".scratch"))).toBe(false);
    expect(has(c, "archive/motives")).toBe(false);
    expect(rd(c, "archive/2026-03/a/motive.md")).toBe(MOTIVE_A);
    expect(rd(c, "archive/2026-03/a/notes.md")).toBe("notes a\n");
    expect(rd(c, "work/bravo-unit/motive.md")).toBe(MOTIVE_B);
    expect(rd(c, "work/c/motive.md")).toBe(MOTIVE_C);
    expect(rd(c, "work/f/spec.md")).toBe(SPEC_F);
  });

  describe("AC4: commit-msg guard rejects migrated slugs", () => {
    const c = makeRepo();
    let installed = false;
    // Registered SessionStart command: `bun src/hooks/session-commit-msg-installer.ts`, then git runs the hook.
    function commit(subject: string) {
      return git(c, "commit", "--allow-empty", "-m", subject);
    }
    it("AC4: subjects naming a work slug and a legacy slug are rejected, a neutral subject is not", () => {
      expect(gw(c, "migrate", "--apply", "--token", c.token).status).toBe(0);
      const inst = run("bun", [INSTALLER], c);
      expect(inst.status).toBe(0);
      installed = existsSync(path.join(c.d, ".git/hooks/commit-msg"));
      expect(installed).toBe(true);

      const work = commit("Add bravo-unit support");
      expect(work.status).not.toBe(0);
      expect(work.stderr).toContain('motive slug "bravo-unit"');

      const legacy = commit("Add old-zulu-unit support");
      expect(legacy.status).not.toBe(0);
      expect(legacy.stderr).toContain('motive slug "old-zulu-unit"');

      const ok = commit("Add widget support");
      expect(ok.stderr).not.toContain("motive slug");
      expect(ok.status).toBe(0);
    });
  });

  it("AC5: a second apply reports nothing to migrate", () => {
    const c = makeRepo();
    expect(gw(c, "migrate", "--apply", "--token", c.token).status).toBe(0);
    const after = treeHash(c);
    const r = gw(c, "migrate", "--apply", "--token", c.token);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("nothing to migrate\n");
    expect(treeHash(c)).toBe(after);
  });

  it("AC6: collision is reported and skipped, existing content kept, others still migrate", () => {
    const c = makeRepo();
    put(c, "work/f/keep.md", "existing f\n");
    const expected = PLAN.map(l => l.startsWith(".scratch/f") ? `.scratch/f ${AR} work/f [collision: skipped]` : l);
    const dry = gw(c, "migrate");
    expect(dry.status).toBe(1);
    expect(lines(dry.stdout)).toEqual(expected);

    const r = gw(c, "migrate", "--apply", "--token", c.token);
    expect(r.status).not.toBe(0);
    expect(lines(r.stdout)).toEqual(expected);
    expect(rd(c, "work/f/keep.md")).toBe("existing f\n");
    expect(has(c, "work/f/spec.md")).toBe(false);
    expect(readFileSync(path.join(c.d, ".scratch/f/spec.md"), "utf8")).toBe(SPEC_F);
    expect(has(c, "archive/2026-03/a/motive.md")).toBe(true);
    expect(has(c, "motives")).toBe(false);
  });

  it("AC7: missing created is inferred from oldest mtime, flagged, merged or injected on apply", () => {
    const c = makeRepo();
    // Replace b and c with motives lacking `created:`: b has frontmatter, c has none.
    rmSync(path.join(c.gwd, "motives/bravo-unit"), { recursive: true });
    rmSync(path.join(c.gwd, "motives/c"), { recursive: true });
    const withFm = "---\nstatus: active\n---\n# bravo\nbody\n";
    const noFm = "# c heading\nplain\n";
    put(c, "motives/bravo-unit/motive.md", withFm);
    put(c, "motives/c/motive.md", noFm);
    put(c, "motives/c/extra.md", "newer\n");
    const old = new Date(2024, 1, 3, 12, 0, 0);
    const newer = new Date(2025, 5, 9, 12, 0, 0);
    utimesSync(path.join(c.gwd, "motives/bravo-unit/motive.md"), old, old);
    utimesSync(path.join(c.gwd, "motives/c/motive.md"), old, old);
    utimesSync(path.join(c.gwd, "motives/c/extra.md"), newer, newer);

    const dry = gw(c, "migrate");
    expect(dry.status).toBe(0);
    const out = lines(dry.stdout);
    expect(out[1]).toBe(`motives/bravo-unit ${AR} work/bravo-unit [created inferred]`);
    expect(out[2]).toBe(`motives/c ${AR} work/c [unclassified] [created inferred]`);
    expect(rd(c, "motives/bravo-unit/motive.md")).toBe(withFm);

    const r = gw(c, "migrate", "--apply", "--token", c.token);
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual(out);
    expect(rd(c, "work/bravo-unit/motive.md")).toBe("---\nstatus: active\ncreated: 2024-02-03\n---\n# bravo\nbody\n");
    expect(rd(c, "work/c/motive.md")).toBe(`---\ncreated: 2024-02-03\n---\n${noFm}`);
    expect(rd(c, "work/c/extra.md")).toBe("newer\n");
  });

  it("left in place: unplanned entries are reported and never moved", () => {
    const uuid = "a2f49e92-6706-4e3d-91c5-020a94b83f0f";
    const c = makeRepo();
    // Reduce to: one planned entry (handoffs) + never-touch entries + three unplanned ones.
    for (const e of ["motives", "research", "specs", "pause-state.md", "archive/motives"]) {
      rmSync(path.join(c.gwd, e), { recursive: true });
    }
    rmSync(path.join(c.d, ".scratch"), { recursive: true });
    put(c, "pilots/p.md", "pilot\n");
    put(c, `${uuid}/f.txt`, "uuid file\n");
    put(c, "struggle-signals.jsonl", "{}\n");
    const kept = ["pilots/p.md", `${uuid}/f.txt`, "struggle-signals.jsonl"];
    const before = new Map(kept.map(f => [f, sha(path.join(c.gwd, f))]));
    const LEFT = [`left in place: ${uuid}`, "left in place: pilots", "left in place: struggle-signals.jsonl"];
    const plan = [`handoffs ${AR} archive/legacy/handoffs`];

    const dry = gw(c, "migrate");
    expect(dry.status).toBe(0);
    expect(lines(dry.stdout)).toEqual([...plan, ...LEFT]);

    const r = gw(c, "migrate", "--apply", "--token", c.token);
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual([...plan, ...LEFT]);
    for (const f of kept) expect(sha(path.join(c.gwd, f))).toBe(before.get(f)!);
    expect(has(c, "handoffs")).toBe(false);

    const again = gw(c, "migrate", "--apply", "--token", c.token);
    expect(again.status).toBe(0);
    expect(lines(again.stdout)).toEqual(["nothing to migrate", ...LEFT]);
    for (const f of kept) expect(sha(path.join(c.gwd, f))).toBe(before.get(f)!);
  });

  describe("symlinks", () => {
    const LINKS = ["left in place: research (symlink)", "left in place: specs (symlink)"];

    it("symlinks: top-level links are reported, never moved or followed", () => {
      const c = makeRepo();
      for (const e of ["motives/bravo-unit", "motives/c", "specs", "research", "pause-state.md", "archive/motives"]) {
        rmSync(path.join(c.gwd, e), { recursive: true });
      }
      rmSync(path.join(c.d, ".scratch"), { recursive: true });
      const outside = { "doc/specs/s.md": "outside spec\n", "elsewhere/e.md": "outside e\n" };
      for (const [f, body] of Object.entries(outside)) {
        mkdirSync(path.dirname(path.join(c.d, f)), { recursive: true });
        writeFileSync(path.join(c.d, f), body);
      }
      symlinkSync("../doc/specs", path.join(c.gwd, "specs"));
      symlinkSync("../elsewhere", path.join(c.gwd, "research"));
      const plan = [`motives/a ${AR} archive/2026-03/a`, `handoffs ${AR} archive/legacy/handoffs`];
      const before = treeHash(c);
      const targets = Object.keys(outside).map(f => [f, sha(path.join(c.d, f))] as const);

      const dry = gw(c, "migrate");
      expect(dry.status).toBe(0);
      expect(lines(dry.stdout)).toEqual([...plan, ...LINKS]);
      expect(treeHash(c)).toBe(before);

      const checkLinks = () => {
        expect(lstatSync(path.join(c.gwd, "specs")).isSymbolicLink()).toBe(true);
        expect(lstatSync(path.join(c.gwd, "research")).isSymbolicLink()).toBe(true);
        expect(readlinkSync(path.join(c.gwd, "specs"))).toBe("../doc/specs");
        expect(readlinkSync(path.join(c.gwd, "research"))).toBe("../elsewhere");
        for (const [f, h] of targets) expect(sha(path.join(c.d, f))).toBe(h);
        expect(has(c, "archive/legacy/specs")).toBe(false);
        expect(has(c, "archive/legacy/research")).toBe(false);
      };

      const r = gw(c, "migrate", "--apply", "--token", c.token);
      expect(r.status).toBe(0);
      expect(lines(r.stdout)).toEqual([...plan, ...LINKS]);
      checkLinks();
      expect(has(c, "archive/legacy/handoffs/h.md")).toBe(true);

      const again = gw(c, "migrate", "--apply", "--token", c.token);
      expect(again.status).toBe(0);
      expect(lines(again.stdout)).toEqual(["nothing to migrate", ...LINKS]);
      checkLinks();
    });

    it("symlinks: nested motive links are skipped and reported", () => {
      const c = makeRepo();
      mkdirSync(path.join(c.d, "elsewhere"), { recursive: true });
      writeFileSync(path.join(c.d, "elsewhere/motive.md"), MOTIVE_A);
      symlinkSync("../../elsewhere", path.join(c.gwd, "motives/linked"));
      const target = sha(path.join(c.d, "elsewhere/motive.md"));
      const line = "left in place: motives/linked (symlink)";

      const dry = gw(c, "migrate");
      expect(dry.status).toBe(0);
      expect(lines(dry.stdout)).toEqual([...PLAN, line]);

      const r = gw(c, "migrate", "--apply", "--token", c.token);
      expect(r.status).toBe(0);
      expect(lines(r.stdout)).toEqual([...PLAN, line]);
      expect(readlinkSync(path.join(c.gwd, "motives/linked"))).toBe("../../elsewhere");
      expect(sha(path.join(c.d, "elsewhere/motive.md"))).toBe(target);
      expect(has(c, "archive/2026-03/linked")).toBe(false);
      expect(has(c, "work/linked")).toBe(false);
    });
  });

  it("token: apply without --token exits 1 and changes nothing", () => {
    const c = makeRepo();
    const before = treeHash(c);
    const r = gw(c, "migrate", "--apply");
    expect(r.status).toBe(1);
    expect(treeHash(c)).toBe(before);
  });
});
