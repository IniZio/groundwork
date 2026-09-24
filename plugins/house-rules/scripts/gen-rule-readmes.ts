import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { BUILTIN_POLICY } from '../src/engine/policy.js';
import type { RuleCases, Case } from '../src/engine/types.js';

const DEFAULT_RULES_DIR = path.resolve(import.meta.dir, '../rules');

function renderCase(c: Case): string {
  const lines: string[] = [];
  lines.push(`### ${c.why}`);
  lines.push('');

  if (c.tree) {
    lines.push('**Files:**');
    for (const [filename, content] of Object.entries(c.tree)) {
      lines.push(`- \`${filename}\`: ${content}`);
    }
  } else {
    const lang = c.filename ? path.extname(c.filename).slice(1) : '';
    lines.push('```' + lang);
    lines.push(c.code ?? '');
    lines.push('```');
  }

  return lines.join('\n');
}

function renderInvalidCase(c: Case & { findings: Partial<{ ruleId: string; path: string; line?: number; message: string; fingerprintBasis: string }>[] }): string {
  const lines: string[] = [];
  lines.push(renderCase(c));

  const messages = c.findings.map((f) => f.message).filter((m): m is string => !!m);
  if (messages.length > 0) {
    lines.push('');
    lines.push('**Expected findings:**');
    for (const msg of messages) {
      lines.push(`- ${msg}`);
    }
  }

  return lines.join('\n');
}

export async function generateReadme(ruleDir: string, ruleId: string): Promise<string> {
  // Load rule for meta + vehicles
  const indexTs = path.join(ruleDir, 'index.ts');
  const indexJs = path.join(ruleDir, 'index.js');
  const entryPath = fs.existsSync(indexTs) ? indexTs : indexJs;
  const ruleMod = await import(entryPath);
  const rule = ruleMod.default;

  // Load cases
  const casesPath = path.join(ruleDir, 'cases.ts');
  const casesMod = await import(casesPath);
  const cases: RuleCases = casesMod.cases;

  const lines: string[] = [];
  lines.push('<!-- This file is generated. Do not edit manually. -->');
  lines.push('');
  lines.push(`# ${ruleId}`);
  lines.push('');
  lines.push(rule.meta.description);
  lines.push('');

  const policy = BUILTIN_POLICY[ruleId];
  if (policy) {
    const autofixStr = policy.autofix ? 'yes' : 'no';
    lines.push(`**Severity**: ${policy.severity} | **Autofix**: ${autofixStr}`);
  } else {
    lines.push('> Not in policy.');
  }

  lines.push('');
  lines.push(`**Vehicles**: ${(rule.vehicles as string[]).join(', ')}`);

  if (cases.valid.length > 0) {
    lines.push('');
    lines.push('## Allowed');
    lines.push('');
    lines.push(cases.valid.map(renderCase).join('\n\n'));
  }

  if (cases.invalid.length > 0) {
    lines.push('');
    lines.push('## Flagged');
    lines.push('');
    lines.push(cases.invalid.map(renderInvalidCase).join('\n\n'));
  }

  lines.push('');
  return lines.join('\n');
}

export async function checkAll(rulesDir: string): Promise<{ exitCode: number; lines: string[] }> {
  if (!fs.existsSync(rulesDir)) {
    return { exitCode: 0, lines: ['rules checked: 0'] };
  }

  const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
  const ruleDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  if (ruleDirs.length === 0) {
    return { exitCode: 0, lines: ['rules checked: 0'] };
  }

  const problems: string[] = [];

  for (const ruleId of ruleDirs) {
    const ruleDir = path.join(rulesDir, ruleId);
    const casesPath = path.join(ruleDir, 'cases.ts');

    if (!fs.existsSync(casesPath)) {
      problems.push(`${ruleId}: cases.ts missing`);
      continue;
    }

    let cases: RuleCases;
    try {
      const casesMod = await import(casesPath);
      cases = casesMod.cases;
    } catch {
      problems.push(`${ruleId}: cases.ts missing`);
      continue;
    }

    if (!cases.valid || cases.valid.length === 0) {
      problems.push(`${ruleId}: valid cases empty`);
    }
    if (!cases.invalid || cases.invalid.length === 0) {
      problems.push(`${ruleId}: invalid cases empty`);
    }

    const readmePath = path.join(ruleDir, 'README.md');
    const generated = await generateReadme(ruleDir, ruleId);

    if (!fs.existsSync(readmePath)) {
      problems.push(`${ruleId}: README missing`);
    } else {
      const existing = fs.readFileSync(readmePath, 'utf8');
      if (existing !== generated) {
        problems.push(`${ruleId}: README stale`);
      }
    }
  }

  if (problems.length > 0) {
    return { exitCode: 1, lines: problems };
  }

  return { exitCode: 0, lines: [`rules checked: ${ruleDirs.length}`] };
}

export async function generateAll(rulesDir: string): Promise<void> {
  if (!fs.existsSync(rulesDir)) {
    return;
  }

  const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
  const ruleDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  for (const ruleId of ruleDirs) {
    const ruleDir = path.join(rulesDir, ruleId);
    const generated = await generateReadme(ruleDir, ruleId);
    fs.writeFileSync(path.join(ruleDir, 'README.md'), generated, 'utf8');
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let rulesDir = DEFAULT_RULES_DIR;
  let checkMode = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--rules-dir' && args[i + 1]) {
      rulesDir = args[++i];
    } else if (args[i] === '--check') {
      checkMode = true;
    }
  }

  if (checkMode) {
    const { exitCode, lines } = await checkAll(rulesDir);
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }
    process.exit(exitCode);
  } else {
    await generateAll(rulesDir);
    const count = fs.existsSync(rulesDir)
      ? fs.readdirSync(rulesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length
      : 0;
    process.stdout.write(`rules checked: ${count}\n`);
  }
}
