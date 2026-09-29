import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileGenerates,
  forbiddenRedirect,
  matchPath,
  nearestTypes,
  renderType,
} from "../../src/config/manifest.mjs";

const configDir = join(import.meta.dir, "../../src/config");

describe("AC3 compileGenerates", () => {
  const kebab = compileGenerates("{dir}/research/{name:kebab}.md");

  it("AC3 kebab accepts and rejects", () => {
    expect(kebab.match("foo/research/my-note.md")).toEqual({ dir: "foo", name: "my-note" });
    expect(kebab.match("foo/research/note2.md")).toEqual({ dir: "foo", name: "note2" });
    expect(kebab.match("foo/research/MyNote.md")).toBeNull();
    expect(kebab.match("MyNote.md")).toBeNull();
    expect(kebab.match("foo/research/my-note.txt")).toBeNull();
    expect(kebab.match("foo/x/research/a.md")).toBeNull();
    expect(kebab.match("foo/research/my--note.md")).toBeNull();
    expect(kebab.match("foo/research/my.note.md")).toBeNull();
    expect(kebab.match("foo/research/a/b.md")).toBeNull();
  });

  it("AC3 camel accepts and rejects", () => {
    const c = compileGenerates("docs/{name:camel}.md");
    expect(c.match("docs/myNote.md")).toEqual({ name: "myNote" });
    expect(c.match("docs/note.md")).toEqual({ name: "note" });
    expect(c.match("docs/MyNote.md")).toBeNull();
    expect(c.match("docs/my-note.md")).toBeNull();
    expect(c.match("docs/my_note.md")).toBeNull();
  });

  it("AC3 pascal accepts and rejects", () => {
    const p = compileGenerates("docs/{name:pascal}.md");
    expect(p.match("docs/MyNote.md")).toEqual({ name: "MyNote" });
    expect(p.match("docs/Note.md")).toEqual({ name: "Note" });
    expect(p.match("docs/myNote.md")).toBeNull();
    expect(p.match("docs/My-Note.md")).toBeNull();
  });

  it("AC3 placeholders never span a slash", () => {
    expect(compileGenerates("{dir}/x.md").match("a/b/x.md")).toBeNull();
    expect(compileGenerates("{dir}/x.md").match("a/x.md")).toEqual({ dir: "a" });
    expect(compileGenerates("{n:kebab}.md").match("a/b.md")).toBeNull();
    expect(compileGenerates("{n:camel}.md").match("a/b.md")).toBeNull();
    expect(compileGenerates("{n:pascal}.md").match("a/B.md")).toBeNull();
  });

  it("AC3 repeated placeholder needs equal values; unknown case throws", () => {
    const r = compileGenerates("{a:kebab}/{a:kebab}.md");
    expect(r.match("x/x.md")).toEqual({ a: "x" });
    expect(r.match("x/y.md")).toBeNull();
    expect(() => compileGenerates("{a:snake}.md")).toThrow();
  });
});

const TYPES: Record<string, { tier: "working"; generates: string }> = {
  research: { tier: "working", generates: "docs/research/{name:kebab}.md" },
  spec: { tier: "working", generates: "docs/specs/{name:pascal}.md" },
  ticket: { tier: "working", generates: "docs/tickets/{name:camel}.md" },
  adr: { tier: "working", generates: "docs/adr/{area:kebab}/{name:kebab}.md" },
  journal: { tier: "working", generates: "docs/journal/{name}.md" },
  playbook: { tier: "working", generates: "docs/playbooks/{group:pascal}-{name:kebab}.md" },
};
const manifest = { types: TYPES };
const POOL = ["alpha", "Beta", "gamma2", "Delta", "eps9", "zeta", "Eta", "theta", "io3ta", "Kappa"];
const SEPS = [" ", "-", "_", " ", "  "];

// Deterministic, letter-first values: camel/pascal cannot start with a digit.
function value(i: number, salt: number): string {
  const n = 1 + ((i + salt) % 3);
  const parts: string[] = [];
  for (let k = 0; k < n; k++) parts.push(POOL[(i * 3 + salt + k * 7) % POOL.length]);
  return parts.reduce((acc, w, k) => (k ? acc + SEPS[(i + k + salt) % SEPS.length] + w : w), "");
}

describe("AC4 round-trip", () => {
  it("AC4 renderType output matches its own type and re-renders identically (>=300 cases)", () => {
    let cases = 0;
    const seenPaths = new Set<string>();
    for (const [id, def] of Object.entries(TYPES)) {
      const names = [...def.generates.matchAll(/\{(\w+)/g)].map((m) => m[1]);
      for (let i = 0; i < 60; i++) {
        const input: Record<string, string> = {};
        names.forEach((n, j) => {
          input[n] = id === "journal" ? value(i, j).replace(/[\s]+/g, "_") : value(i, j * 5 + 1);
        });
        const path = renderType(id, input, manifest);
        const hit = matchPath(path, manifest);
        expect(hit).not.toBeNull();
        expect(hit!.type).toBe(id);
        expect(renderType(id, hit!.params, manifest)).toBe(path);
        seenPaths.add(path);
        cases++;
      }
    }
    expect(Object.keys(TYPES)).toHaveLength(6);
    expect(cases).toBeGreaterThanOrEqual(300);
    expect(seenPaths.size).toBeGreaterThan(100);
  });

  it("AC4 non-canonical spellings are rejected", () => {
    expect(matchPath("docs/research/My Note.md", manifest)).toBeNull();
    expect(matchPath("docs/specs/my-spec.md", manifest)).toBeNull();
    expect(() => renderType("nope", {}, manifest)).toThrow();
    expect(matchPath("docs/research/a.md", {})).toBeNull();
  });
});

describe("AC5 nearestTypes", () => {
  const m = {
    types: {
      spec: { tier: "working" as const, generates: "docs/specs/{name:kebab}.md" },
      ticket: { tier: "working" as const, generates: "docs/tickets/{name:kebab}.md" },
      research: { tier: "working" as const, generates: "docs/research/{name:kebab}.md" },
    },
  };

  it("AC5 ranks research first for root research-notes.md", () => {
    const r = nearestTypes("research-notes.md", m, 2);
    expect(r).toHaveLength(2);
    expect(r[0].type).toBe("research");
    expect(r[0].score).toBeGreaterThan(r[1].score);
    expect(r[0].suggestion).toBe("docs/research/research-notes.md");
  });

  it("AC5 returns [] with no types", () => {
    expect(nearestTypes("research-notes.md", {}, 2)).toEqual([]);
    expect(nearestTypes("research-notes.md", { types: {} }, 2)).toEqual([]);
  });
});

describe("AC6 forbiddenRedirect", () => {
  const m = {
    forbidden: [
      { pattern: "**/notes/**", redirect: "docs/research/{slug}.md" },
      { pattern: "tmp/*.md", redirect: "docs/{slug}.md" },
    ],
  };

  it("AC6 returns redirect with {slug} intact", () => {
    expect(forbiddenRedirect("notes/a.md", m)).toBe("docs/research/{slug}.md");
    expect(forbiddenRedirect("./a/notes/b/c.md", m)).toBe("docs/research/{slug}.md");
    expect(forbiddenRedirect("a\\notes\\b.md", m)).toBe("docs/research/{slug}.md");
    expect(forbiddenRedirect("tmp/x.md", m)).toBe("docs/{slug}.md");
  });

  it("AC6 returns null when nothing matches", () => {
    expect(forbiddenRedirect("tmp/a/x.md", m)).toBeNull();
    expect(forbiddenRedirect("src/x.md", m)).toBeNull();
    expect(forbiddenRedirect("src/x.md", {})).toBeNull();
  });
});

describe("AC8 standalone import", () => {
  it("AC8 manifest.mjs loads from a bare copy of the config dir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "manifest-"));
    try {
      const copy = join(tmp, "config");
      cpSync(configDir, copy, { recursive: true });
      const env = { ...process.env };
      delete env.CLAUDE_PROJECT_DIR;
      const file = join(copy, "manifest.mjs");
      const code =
        `const m = await import(${JSON.stringify(file)});` +
        `console.log(JSON.stringify(m.matchPath("a/b.md", {types:{t:{tier:"working",generates:"a/{n:kebab}.md"}}})));`;
      const r = spawnSync(process.execPath, ["-e", code], { cwd: tmp, env, encoding: "utf8" });
      expect(r.stderr).toBe("");
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout.trim())).toEqual({ type: "t", params: { n: "b" } });
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
