/**
 * Family 6: Commit-message lint guard.
 * PreToolUse on Bash — intercepts `git commit` before it runs and checks the
 * message for convention violations. Deny is actionable: every violation names
 * the offending line and the rule. Kill-switch: GROUNDWORK_COMMIT_LINT=0.
 */

import { lintMessage, resolveRepoRoot } from '../../hooks/lib/commit-convention.mjs'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

function deny(reason: string): HookResult {
  return {
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }) + "\n",
    stderr: "",
    exit: 0,
  };
}

function lintAndDecide(message: string, cwd: string): HookResult {
  const result = lintMessage(message, { repoRoot: resolveRepoRoot(cwd) });
  if (result.violations.length === 0) return allow();
  const lines = [...result.violations]
    .sort((a: { line: number }, b: { line: number }) => a.line - b.line)
    .map((v: { line: number; reason: string }) => `  line ${v.line}: ${v.reason}`);
  return deny(`Commit message lint violations:\n${lines.join('\n')}`);
}

function extractInlineMessage(cmd: string): string | null {
  if (/\s-F[\s=]|\s--file[\s=]/.test(cmd) || / -F$/.test(cmd)) return null;

  const messages: string[] = [];
  let m: RegExpExecArray | null;

  const mQuoted = /(?:^|\s)-m\s+(['"])([\s\S]*?)\1/g;
  while ((m = mQuoted.exec(cmd)) !== null) messages.push(m[2]);

  const msgLong = /--message=(['"])([\s\S]*?)\1|--message=([^\s'"]+)/g;
  while ((m = msgLong.exec(cmd)) !== null) messages.push(m[2] ?? m[3] ?? '');

  const msgSpace = /--message\s+(['"])([\s\S]*?)\1/g;
  while ((m = msgSpace.exec(cmd)) !== null) messages.push(m[2]);

  if (messages.length === 0) return null;
  return messages.join('\n\n');
}

function extractFilePath(cmd: string): string | null {
  let m: RegExpExecArray | null;

  m = /--file=(['"])(.*?)\1/.exec(cmd);
  if (m) return m[2] === '-' ? null : m[2];

  m = /--file=([^\s'"]+)/.exec(cmd);
  if (m) return m[1] === '-' ? null : m[1];

  m = /--file\s+(['"])(.*?)\1/.exec(cmd);
  if (m) return m[2] === '-' ? null : m[2];

  m = /--file\s+([^\s'"]+)/.exec(cmd);
  if (m) return m[1] === '-' ? null : m[1];

  m = /(?:^|\s)-F=(['"])(.*?)\1/.exec(cmd);
  if (m) return m[2] === '-' ? null : m[2];

  m = /(?:^|\s)-F=([^\s'"]+)/.exec(cmd);
  if (m) return m[1] === '-' ? null : m[1];

  m = /(?:^|\s)-F\s+(['"])(.*?)\1/.exec(cmd);
  if (m) return m[2] === '-' ? null : m[2];

  m = /(?:^|\s)-F\s+([^\s'"]+)/.exec(cmd);
  if (m) return m[1] === '-' ? null : m[1];

  return null;
}

export function check(input: unknown): HookResult {
  try {
    if (process.env['GROUNDWORK_COMMIT_LINT'] === '0') return allow();

    if (typeof input !== 'object' || input === null) return allow();
    const inp = input as Record<string, unknown>;
    if (inp['tool_name'] !== 'Bash') return allow();

    const toolInput = inp['tool_input'];
    if (typeof toolInput !== 'object' || toolInput === null) return allow();

    const command = (toolInput as Record<string, unknown>)['command'];
    if (typeof command !== 'string') return allow();

    if (!/\bgit\s+commit\b/.test(command)) return allow();

    const cmdCwd =
      typeof (toolInput as Record<string, unknown>)['cwd'] === 'string'
        ? ((toolInput as Record<string, unknown>)['cwd'] as string)
        : process.cwd();

    const inlineMsg = extractInlineMessage(command);
    if (inlineMsg !== null) return lintAndDecide(inlineMsg, cmdCwd);

    const rawPath = extractFilePath(command);
    if (rawPath !== null) {
      const filePath = resolve(cmdCwd, rawPath);
      let fileMsg: string;
      try {
        const st = statSync(filePath);
        if (!st.isFile()) return allow();
        fileMsg = readFileSync(filePath, 'utf-8');
      } catch {
        return allow();
      }
      return lintAndDecide(fileMsg, cmdCwd);
    }

    return allow();
  } catch {
    return allow();
  }
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  let input: unknown = {};
  try { input = JSON.parse(raw); } catch { /* fail-open */ }
  const result = check(input);
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.exit);
}
