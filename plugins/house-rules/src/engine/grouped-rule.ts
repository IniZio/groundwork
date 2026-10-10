import fs from 'node:fs';
import path from 'node:path';
import type { Node } from '../hooks/lib/tree-sitter.js';
import type { Finding, PendingEdit, EditCheckEnv, EditCheckResult, Rule, RuleCases, RuleContext, ScopedFile } from './types.js';
import { createSourceFiles, type SourceFileResult } from './source-file.js';

export interface CheckHit {
  node?: Node;
  /** 0-based row; used when no node is available. */
  row?: number;
  message: string;
}

export interface Check {
  id: string;
  upstream: string;
  tsOnly?: boolean;
  check(root: Node, source: string): CheckHit[];
}

const TS_EXT = new Set(['.ts', '.mts', '.cts', '.tsx']);
const JS_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx']);

function isScanned(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return TS_EXT.has(ext) || JS_EXT.has(ext);
}

function isJsOnly(file: string): boolean {
  return JS_EXT.has(path.extname(file).toLowerCase());
}

function discover(checksDir: string): string[] {
  const names = fs.readdirSync(checksDir)
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.cases.ts') && !n.endsWith('.d.ts'))
    .map((n) => n.slice(0, -'.ts'.length))
    .sort();
  for (const sub of names) {
    const casesFile = path.join(checksDir, `${sub}.cases.ts`);
    if (!fs.existsSync(casesFile)) {
      throw new Error(`grouped rule: check "${sub}.ts" is missing its cases file ${casesFile}`);
    }
  }
  return names;
}

async function loadChecks(checksDir: string, names: string[]): Promise<Check[]> {
  const checks: Check[] = [];
  for (const sub of names) {
    const mod = (await import(path.join(checksDir, `${sub}.ts`))) as Check;
    if (mod.id !== sub) {
      throw new Error(`grouped rule: check id "${mod.id}" does not match file name "${sub}.ts"`);
    }
    checks.push({ id: mod.id, upstream: mod.upstream, tsOnly: mod.tsOnly, check: mod.check });
  }
  return checks;
}

function norm(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function collect(
  checks: Check[],
  result: SourceFileResult,
  filePath: string,
  ruleId: string,
  isAdded: (row: number) => boolean,
): Finding[] {
  if (!result.ok) return [];
  const { tree, text, errorRows } = result.source;
  const lines = text.split('\n');
  const jsFile = isJsOnly(filePath);
  const findings: Finding[] = [];
  for (const c of checks) {
    if (c.tsOnly && jsFile) continue;
    for (const hit of c.check(tree.rootNode, text)) {
      const row = hit.node ? hit.node.startPosition.row : hit.row;
      if (row === undefined || errorRows.has(row) || !isAdded(row)) continue;
      findings.push({
        ruleId,
        path: filePath,
        line: row + 1,
        message: `[${c.id}] ${hit.message}`,
        fingerprintBasis: `${c.id}\n${norm(lines[row] ?? '')}`,
      });
    }
  }
  return findings;
}

/** Discovery runs now so a missing cases pair fails at load; check modules import lazily on first use. */
export function defineGroupedRule(id: string, description: string, checksDir: string): Rule {
  const names = discover(checksDir);
  let loaded: Promise<Check[]> | undefined;
  const checks = () => (loaded ??= loadChecks(checksDir, names));

  return {
    id,
    meta: { description },
    languages: ['typescript'],

    async check(ctx: RuleContext): Promise<Finding[]> {
      const active = await checks();
      const own = ctx.sourceFile ? null : createSourceFiles();
      const findings: Finding[] = [];
      try {
        for (const file of ctx.files ?? []) {
          if (!file.addedHunks || !file.text || !isScanned(file.path)) continue;
          const added = new Set(file.addedHunks.flatMap((h) => h.added.map((n) => n - 1)));
          if (added.size === 0) continue;
          const result = ctx.sourceFile
            ? await ctx.sourceFile(file as ScopedFile)
            : await own!.get('typescript', file.text, file.path);
          if (!result) continue;
          findings.push(...collect(active, result, file.path, id, (r) => added.has(r)));
        }
      } finally {
        own?.dispose();
      }
      return findings;
    },

    async editCheck(edit: PendingEdit, env: EditCheckEnv): Promise<EditCheckResult> {
      if (edit.lang === null || !isScanned(edit.path) || edit.changedRows.size === 0) return { findings: [] };
      const result = await env.sourceFile();
      if (!result) return { findings: [] };
      const active = await checks();
      return { findings: collect(active, result, edit.path, id, (r) => edit.changedRows.has(r)) };
    },
  };
}

export async function loadGroupedCases(checksDir: string): Promise<RuleCases> {
  const cases: RuleCases = { valid: [], invalid: [] };
  for (const sub of discover(checksDir)) {
    const mod = (await import(path.join(checksDir, `${sub}.cases.ts`))) as { cases: RuleCases };
    cases.valid.push(...mod.cases.valid.map((c) => ({ ...c, why: `[${sub}] ${c.why}` })));
    cases.invalid.push(...mod.cases.invalid.map((c) => ({ ...c, why: `[${sub}] ${c.why}` })));
  }
  return cases;
}
