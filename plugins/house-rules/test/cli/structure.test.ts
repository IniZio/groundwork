import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, afterEach } from 'bun:test';
import { renderStructure } from '../../src/config/structure.mjs';
import { matchPath } from '../../src/config/manifest.mjs';

const PLUGIN_ROOT = path.resolve(import.meta.dir, '../..');
const BIN = path.join(PLUGIN_ROOT, 'bin/house-rules');
const REAL_TEMPLATE = fs.readFileSync(
  path.resolve(PLUGIN_ROOT, '../../templates/doc-types/research.md'),
  'utf8',
);

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const RESEARCH = {
  tier: 'working',
  generates: '.groundwork/work/{slug}/research/{name:kebab}.md',
  description: 'Research notes with cited sources',
  instruction: 'Cite a source for every claim.',
  // The real template has no created field; add one so the auto-filled date is observable.
  template: REAL_TEMPLATE.replace('confidence: {{confidence}}\n', 'confidence: {{confidence}}\ncreated: {{created}}\n'),
};
const DECISION = {
  tier: 'product',
  generates: 'doc/decisions/{name:kebab}.md',
  description: 'Architecture choice and rationale',
  instruction: 'State the decision and its consequences.',
  template: '# {{title}}\n',
};
const BOGUS = {
  tier: 'ephemeral',
  generates: '.groundwork/scratch/{name:kebab}.md',
  description: 'Scratch',
  template: '# {{bogus}}\n',
};
const FORBIDDEN = [{ pattern: 'NOTES.md', redirect: 'use research' }];

function makeRepo(types: Record<string, unknown>, forbidden: unknown[] = FORBIDDEN): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-st-'));
  tempDirs.push(dir);
  spawnSync('git', ['init'], { cwd: dir });
  const options: Record<string, unknown> = { types };
  if (forbidden.length) options.forbidden = forbidden;
  fs.writeFileSync(
    path.join(dir, '.house-rules.json'),
    JSON.stringify({ rules: { 'artifact-structure': ['error', options] } }),
  );
  return dir;
}

function runBIN(args: string[], cwd: string) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'CLAUDE_PROJECT_DIR' && v !== undefined) env[k] = v;
  }
  return spawnSync(BIN, args, { cwd, encoding: 'utf8', env });
}

describe('AC1: structure', () => {
  it('AC1 structure prints one line per type and per forbidden entry', () => {
    const repo = makeRepo({ research: RESEARCH, decision: DECISION });
    const r = runBIN(['structure'], repo);
    expect(r.status).toBe(0);
    expect(r.stdout.trimEnd().split('\n')).toEqual([
      'research (working): .groundwork/work/{slug}/research/{name:kebab}.md — Research notes with cited sources',
      'decision (product): doc/decisions/{name:kebab}.md — Architecture choice and rationale',
      'forbidden: NOTES.md → use research',
    ]);
  });

  it('AC1 structure with no types prints the legacy line', () => {
    const repo = makeRepo({}, []);
    const r = runBIN(['structure'], repo);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('artifact-structure: legacy (no types)');
  });
});

describe('AC2: renderStructure truncation', () => {
  it('AC2 caps output at maxLines and ends with a pointer to house-rules structure', () => {
    const types: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) {
      types[`t${i}`] = { tier: 'working', generates: `d${i}/{name:kebab}.md`, description: `type ${i}` };
    }
    const lines = renderStructure({ types } as never, { maxLines: 8 });
    expect(lines.length).toBeLessThanOrEqual(8);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[lines.length - 1]).toContain('house-rules structure');
    expect(lines[0]).toContain('t0 (working)');
  });
});

describe('AC3: where', () => {
  it('AC3 where <type> prints the generates pattern and the instruction', () => {
    const repo = makeRepo({ research: RESEARCH, decision: DECISION });
    const r = runBIN(['where', 'research'], repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(RESEARCH.generates);
    expect(r.stdout).toContain(RESEARCH.instruction);
  });

  it('AC3 where free text ranks research before other types', () => {
    // decision is declared first so ranking, not declaration order, must put research first
    const repo = makeRepo({ decision: DECISION, research: RESEARCH });
    const r = runBIN(['where', 'notes about caching'], repo);
    expect(r.status).toBe(0);
    const iResearch = r.stdout.indexOf('research');
    expect(iResearch).toBeGreaterThanOrEqual(0);
    const iDecision = r.stdout.indexOf('decision');
    if (iDecision >= 0) expect(iResearch).toBeLessThan(iDecision);
  });

  it('AC3 where unknown type exits 1 and stderr lists the type ids', () => {
    const repo = makeRepo({ research: RESEARCH, decision: DECISION });
    const r = runBIN(['where', 'nosuchtype'], repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('research');
    expect(r.stderr).toContain('decision');
  });
});

const NEW_ARGS = ['new', 'research', 'slug=foo', 'name=My Note', 'question=Q?', 'confidence=medium'];
const REL = '.groundwork/work/foo/research/my-note.md';

describe('AC4: new', () => {
  it('AC4 new writes a filled scaffold at the rendered path', () => {
    const repo = makeRepo({ research: RESEARCH, decision: DECISION });
    const r = runBIN(NEW_ARGS, repo);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(REL);
    const file = path.join(repo, REL);
    expect(fs.existsSync(file)).toBe(true);
    const body = fs.readFileSync(file, 'utf8');
    expect(body).not.toContain('{{');
    expect(body).toContain('question: Q?');
    expect(body).toContain('confidence: medium');
    expect(body).toContain('# My Note');
    expect(body).toContain('created: ' + new Date().toISOString().slice(0, 10));
    expect(matchPath(REL, { types: { research: RESEARCH } } as never)?.type).toBe('research');
  });
});

describe('AC5: new never overwrites', () => {
  it('AC5 repeat new exits 1 mentioning exists and leaves the file unchanged', () => {
    const repo = makeRepo({ research: RESEARCH });
    expect(runBIN(NEW_ARGS, repo).status).toBe(0);
    const file = path.join(repo, REL);
    const before = fs.readFileSync(file);
    const r = runBIN(['new', 'research', 'slug=foo', 'name=My Note', 'question=Different', 'confidence=high'], repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('exists');
    expect(Buffer.compare(before, fs.readFileSync(file))).toBe(0);
  });
});

describe('AC6: new validates params', () => {
  it('AC6 missing name exits 1 naming name and writes nothing', () => {
    const repo = makeRepo({ research: RESEARCH });
    const r = runBIN(['new', 'research', 'slug=foo', 'question=Q?', 'confidence=medium'], repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('name');
    expect(fs.existsSync(path.join(repo, '.groundwork'))).toBe(false);
  });

  it('AC6 missing body key exits 1 naming question', () => {
    const repo = makeRepo({ research: RESEARCH });
    const r = runBIN(['new', 'research', 'slug=foo', 'name=My Note', 'confidence=medium'], repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('question');
    expect(fs.existsSync(path.join(repo, REL))).toBe(false);
  });

  it('AC6 unknown {{key}} in a template exits 1 naming bogus', () => {
    const repo = makeRepo({ research: RESEARCH, bogus: BOGUS });
    const r = runBIN(['new', 'bogus', 'name=x'], repo);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('bogus');
  });
});
