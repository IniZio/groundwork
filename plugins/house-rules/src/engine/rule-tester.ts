import { describe, it, expect, afterAll } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Rule, RuleCases, RuleContext, ScopedFile, Finding, Case } from './types.js';
import { diffTextToHunks } from '../hooks/lib/work-scope.js';

/** Extend Case for tree cases: per-file tracked override. */
export interface TrackedCase extends Case {
  trackedOverrides?: Record<string, boolean>;
}

export interface RuleTesterOpts {
  // reserved for future use
}

/**
 * Registers a describe(rule.id) block with one it() per case.
 * Throws synchronously (at registration time) if:
 *   - valid or invalid arrays are empty
 *   - any case is missing a non-empty why
 *
 * Each it() title is prefixed "valid: " or "invalid: " followed by the case's why.
 *
 * code cases  → single ScopedFile; filename defaults to <rule.id>.ts
 * tree cases  → one ScopedFile per entry, all tracked=true unless trackedOverrides says otherwise;
 *               files are materialised in a temp dir so filesystem-stat rules work correctly.
 */
export function ruleTester(rule: Rule, cases: RuleCases, _opts?: RuleTesterOpts): void {
  // ---- registration-time validation ----
  if (cases.valid.length === 0) {
    throw new Error(`ruleTester: rule "${rule.id}" has empty valid cases`);
  }
  if (cases.invalid.length === 0) {
    throw new Error(`ruleTester: rule "${rule.id}" has empty invalid cases`);
  }
  for (let i = 0; i < cases.valid.length; i++) {
    const c = cases.valid[i];
    if (!c.why || c.why.trim() === '') {
      throw new Error(`ruleTester: rule "${rule.id}" valid case at index ${i} is missing a non-empty why`);
    }
  }
  for (let i = 0; i < cases.invalid.length; i++) {
    const c = cases.invalid[i];
    if (!c.why || c.why.trim() === '') {
      throw new Error(`ruleTester: rule "${rule.id}" invalid case at index ${i} is missing a non-empty why`);
    }
  }

  // Temp dirs created during test execution; cleaned up in afterAll.
  const tmpDirs: string[] = [];

  describe(rule.id, () => {
    afterAll(() => {
      for (const dir of tmpDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    });

    for (const c of cases.valid) {
      it(`valid: ${c.why}`, async () => {
        const ctx = buildContext(rule, c as TrackedCase, tmpDirs);
        const findings = await rule.check(ctx);
        expect(findings).toHaveLength(0);
      });
    }

    for (const c of cases.invalid) {
      it(`invalid: ${c.why}`, async () => {
        const ctx = buildContext(rule, c as TrackedCase, tmpDirs);
        const findings = await rule.check(ctx);
        expect(findings).toHaveLength(c.findings.length);
        for (let i = 0; i < c.findings.length; i++) {
          const expected = c.findings[i];
          const actual = findings[i];
          for (const [key, val] of Object.entries(expected) as [keyof Finding, string | number | undefined][]) {
            expect(actual[key]).toEqual(val);
          }
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extToLang(ext: string): string | undefined {
  const map: Record<string, string> = {
    ts: 'typescript', js: 'javascript', tsx: 'typescript', jsx: 'javascript',
    py: 'python', go: 'go', rs: 'rust', sh: 'bash', sql: 'sql',
    dockerfile: 'dockerfile', md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
  };
  return map[ext.toLowerCase()];
}

function makeTmpDir(tmpDirs: string[]): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'house-rules-tester-'));
  tmpDirs.push(tmp);
  return tmp;
}

function buildContext(rule: Rule, c: TrackedCase, tmpDirs: string[]): RuleContext {
  if (c.tree) {
    const tmp = makeTmpDir(tmpDirs);
    const files: ScopedFile[] = [];
    for (const [filePath, text] of Object.entries(c.tree)) {
      const absPath = path.join(tmp, filePath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, text);
      const ext = path.extname(filePath).replace('.', '');
      files.push({
        path: filePath,
        text,
        lang: extToLang(ext),
        tracked: c.trackedOverrides?.[filePath] ?? true,
      });
    }
    return { repoRoot: tmp, mode: 'cli', files };
  }

  // code case (or bare case with no code/tree)
  const filename = c.filename ?? `${rule.id}.ts`;
  const ext = path.extname(filename).replace('.', '');
  const tmp = makeTmpDir(tmpDirs);
  const absPath = path.join(tmp, filename);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, c.code ?? '');

  const codeText = c.code ?? '';
  let caseAddedHunks: ScopedFile['addedHunks'];
  if (c.base !== undefined) {
    caseAddedHunks = diffTextToHunks(c.base, codeText);
  } else {
    const lines = codeText.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    caseAddedHunks = lines.length > 0
      ? [{ added: lines.map((_, i) => i + 1), removed: [], removedBaseLineNos: [] }]
      : [];
  }

  const files: ScopedFile[] = [{
    path: filename,
    text: codeText,
    lang: extToLang(ext),
    tracked: true,
    ...(c.base !== undefined ? { baseText: c.base } : {}),
    addedHunks: caseAddedHunks,
  }];
  return { repoRoot: tmp, mode: 'cli', files };
}
