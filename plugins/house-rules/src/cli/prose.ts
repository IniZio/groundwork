import { readFileSync } from 'node:fs';
import { checkProse, formatFindings, markdownAvailable, NO_MARKDOWN_NOTICE, type MarkdownHost } from '../../rules/pr-body/prose.js';

export interface ProseIo { out: (s: string) => void; err: (s: string) => void }
const stdio: ProseIo = { out: (s) => void process.stdout.write(s), err: (s) => void process.stderr.write(s) };

export function runProse(file: string, pr: boolean, host: MarkdownHost = globalThis, io: ProseIo = stdio): number {
  if (!markdownAvailable(host)) {
    io.err(NO_MARKDOWN_NOTICE + '\n');
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    io.err(`house-rules prose: cannot read ${file}: ${(err as Error).message}\n`);
    return 2;
  }
  const findings = checkProse(text, { pr });
  if (findings.length === 0) {
    io.out('PASS\n');
    return 0;
  }
  io.out(formatFindings(findings).join('\n') + '\n');
  return 1;
}
