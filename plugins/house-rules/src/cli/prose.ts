import { readFileSync } from 'node:fs';
import { checkProse, formatFindings } from '../../rules/pr-body/prose.js';

export function runProse(file: string, pr: boolean): number {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    process.stderr.write(`house-rules prose: cannot read ${file}: ${(err as Error).message}\n`);
    return 2;
  }
  const findings = checkProse(text, { pr });
  if (findings.length === 0) {
    process.stdout.write('PASS\n');
    return 0;
  }
  process.stdout.write(formatFindings(findings).join('\n') + '\n');
  return 1;
}
