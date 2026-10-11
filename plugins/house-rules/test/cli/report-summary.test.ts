import { describe, it, expect } from 'bun:test';
import { formatSummary, buildReport, type ReportFinding } from '../../src/cli/report.js';

const scope = { base: 'HEAD', mode: 'diff', files: [] } as any;

function f(ruleId: string, check: string, p: string, hint: string, i: number): ReportFinding {
  return { ruleId, path: p, line: i, severity: 'warn', message: `[${check}] ${hint}` };
}

describe('formatSummary', () => {
  const findings: ReportFinding[] = [];
  for (let i = 0; i < 30; i++) findings.push(f('rule-a', 'chk-one', `src/f${i % 12}.ts`, 'Do the one thing instead', i));
  for (let i = 0; i < 5; i++) findings.push(f('rule-b', 'chk-two', 'src/f0.ts', 'Other advice', i));
  const report = buildReport(scope, { findings });
  const out = formatSummary(report, '/x/check-report.json');
  const lines = out.split('\n').filter(l => l !== '');

  it('per-check counts sum to total', () => {
    const sum = [...out.matchAll(/^check (\S+): (\d+)$/gm)].reduce((a, m) => a + Number(m[2]), 0);
    expect(sum).toBe(findings.length);
    expect(out).toContain('check chk-one: 30');
    expect(out).toContain('check chk-two: 5');
  });

  it('per-rule counts and total line', () => {
    expect(out).toContain('rule rule-a: 30');
    expect(out).toContain('rule rule-b: 5');
    expect(out).toContain(`total: ${findings.length}`);
  });

  it('hint printed once per check', () => {
    expect(out.split('Do the one thing instead').length - 1).toBe(1);
    expect(out.split('Other advice').length - 1).toBe(1);
  });

  it('hints differing only by symbol names collapse to one line per check', () => {
    const fs = ['alpha', 'beta', 'gamma', 'delta'].map((n, i) => f('r', 'chk-sym', 'a.ts', `Type on \`${n}\` is wide; use "${n}x" instead`, i));
    const o = formatSummary(buildReport(scope, { findings: fs }), 'p');
    const hintLines = o.split('\n').filter(l => l.startsWith('  hint:'));
    expect(hintLines).toEqual(['  hint: Type on `<name>` is wide; use <name> instead']);
  });

  it('structurally different hints under one check print only the most frequent one', () => {
    const fs = [
      f('r', 'chk-multi', 'a.ts', 'Foo `a1` on return value of `x1`.', 0),
      f('r', 'chk-multi', 'a.ts', 'Foo `a2` on return value of `x2`.', 1),
      f('r', 'chk-multi', 'a.ts', 'Foo `a3` on return value of `x3`.', 2),
      f('r', 'chk-multi', 'a.ts', 'Foo `b` on binding `y`.', 3),
    ];
    const o = formatSummary(buildReport(scope, { findings: fs }), 'p');
    const hintLines = o.split('\n').filter(l => l.startsWith('  hint:'));
    expect(hintLines).toEqual(['  hint: Foo `<name>` on return value of `<name>`.']);
  });

  it('top 10 files by count, ordered', () => {
    const files = [...out.matchAll(/^file (\S+): (\d+)$/gm)];
    expect(files.length).toBe(10);
    expect(files[0][1]).toBe('src/f0.ts');
  });

  it('last line is full report path', () => {
    expect(lines[lines.length - 1]).toBe('full report: /x/check-report.json');
  });

  it('findings without a check prefix are grouped as (none)', () => {
    const r = buildReport(scope, { findings: [{ ruleId: 'r', path: 'a', line: null, severity: 'warn', message: 'plain' }] });
    expect(formatSummary(r, 'p')).toContain('check (none): 1');
  });
});
