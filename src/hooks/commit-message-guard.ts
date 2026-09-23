/**
 * Family 6: Commit-message lint guard.
 * PreToolUse on Bash — intercepts `git commit` before it runs and checks the
 * message for convention violations. Deny is actionable: every violation names
 * the offending line and the rule. Kill-switch: GROUNDWORK_COMMIT_LINT=0.
 *
 * Detectable forms (all linted):
 *   git commit ...
 *   command git commit ...          (command/builtin shell builtins)
 *   builtin git commit ...
 *   FOO=1 git commit ...            (env-var prefix)
 *   git -C <path> commit ...        (git -C flag)
 *   git -c key=val commit ...       (git -c flag)
 *   git --git-dir=<d> commit ...    (git --git-dir flag)
 *   cmd1 && git commit ...          (after &&, ||, ;, |)
 *
 * NOT DETECTABLE: shell function aliases (e.g. `g(){ command git "$@"; }; g commit`).
 * The git-level commit-msg hook installed by session-commit-msg-installer.ts is the
 * backstop for those cases.
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

/**
 * Split a shell command string on unquoted &&, ||, ;, | operators.
 * Single- and double-quoted regions are skipped.
 */
function splitOnShellOps(cmd: string): string[] {
  const segments: string[] = [];
  let current = '';
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === '"' || c === "'") {
      const q = c;
      current += c;
      i++;
      while (i < cmd.length && cmd[i] !== q) {
        if (cmd[i] === '\\' && q === '"') { current += cmd[i]; i++; }
        current += cmd[i];
        i++;
      }
      if (i < cmd.length) { current += cmd[i]; i++; }
    } else if (c === '&' && i + 1 < cmd.length && cmd[i + 1] === '&') {
      segments.push(current); current = ''; i += 2;
    } else if (c === '|' && i + 1 < cmd.length && cmd[i + 1] === '|') {
      segments.push(current); current = ''; i += 2;
    } else if (c === ';' || c === '|') {
      segments.push(current); current = ''; i++;
    } else {
      current += c; i++;
    }
  }
  segments.push(current);
  return segments.filter(s => s.trim().length > 0);
}

/**
 * Parse one shell segment (no operators) for a git commit invocation.
 * Handles: env assignments, command/builtin prefixes, git-level option flags
 * (-C, -c, --git-dir, --work-tree, --namespace, boolean flags).
 * Returns { found: true, cwdOverride } when `commit` is the git subcommand.
 */
function parseSegmentForGitCommit(seg: string): { found: boolean; cwdOverride?: string } {
  let tokens = seg.trim().split(/\s+/).filter(t => t.length > 0);

  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    tokens = tokens.slice(1);
  }

  while (tokens.length > 0 && (tokens[0] === 'command' || tokens[0] === 'builtin')) {
    tokens = tokens.slice(1);
    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
      tokens = tokens.slice(1);
    }
  }

  if (tokens.length === 0 || tokens[0] !== 'git') return { found: false };
  tokens = tokens.slice(1);

  let cwdOverride: string | undefined;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.startsWith('-')) break;

    if (t === '-C') {
      if (i + 1 < tokens.length) { cwdOverride = tokens[i + 1]; i += 2; } else i++;
      continue;
    }
    if (t === '-c') {
      i += 2; continue;
    }
    if (t === '--git-dir' || t === '--work-tree' || t === '--namespace') {
      i += 2; continue;
    }
    if (t.startsWith('--git-dir=') || t.startsWith('--work-tree=') || t.startsWith('--namespace=')) {
      i++; continue;
    }
    i++;
  }

  if (i < tokens.length && tokens[i] === 'commit') {
    return { found: true, cwdOverride };
  }
  return { found: false };
}

/**
 * Detect whether `command` contains a git commit invocation in any decidable form.
 * Checks each shell-operator-separated segment in order; returns on first match.
 */
function detectGitCommit(command: string): { found: boolean; cwdOverride?: string } {
  for (const seg of splitOnShellOps(command)) {
    const result = parseSegmentForGitCommit(seg);
    if (result.found) return result;
  }
  return { found: false };
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

    const gitMatch = detectGitCommit(command);
    if (!gitMatch.found) return allow();

    const baseCwd =
      typeof (toolInput as Record<string, unknown>)['cwd'] === 'string'
        ? ((toolInput as Record<string, unknown>)['cwd'] as string)
        : process.cwd();
    const cmdCwd = gitMatch.cwdOverride ? resolve(baseCwd, gitMatch.cwdOverride) : baseCwd;

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
