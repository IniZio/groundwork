/**
 * Family 6: Commit-message lint guard.
 * PreToolUse on Bash — intercepts `git commit` before it runs and checks the
 * message for convention violations. Deny is actionable: every violation names
 * the offending line and the rule.
 *
 * Detectable forms (all linted or denied):
 *   git commit ...
 *   command git commit ...          (command/builtin shell builtins)
 *   builtin git commit ...
 *   FOO=1 git commit ...            (env-var prefix)
 *   git -C <path> commit ...        (git -C flag)
 *   git -c key=val commit ...       (git -c flag)
 *   git --git-dir=<d> commit ...    (git --git-dir flag)
 *   cmd1 && git commit ...          (after &&, ||, ;, |, newline)
 *   /usr/bin/git commit ...         (any path or quoted form whose basename is git)
 *   env [-i] [-u N] FOO=1 git ...   (env, exec, nohup, nice, time, sudo launchers)
 *   rtk [proxy] git commit ...      (rtk launcher)
 *   git commit -F - <<'EOF' ...     (heredoc body is linted; <<TAG, <<"TAG", <<-TAG)
 *
 * Also denied:
 *   git commit -F -                 (stdin without a heredoc; use -m)
 *   git commit --no-verify / -n     (skips commit-msg hook)
 *   git -c core.hooksPath=... ...   (overrides hooks directory)
 *   git commit-tree ... -m <msg>    (plumbing bypass; shell vars → guidance)
 *   git update-ref refs/heads/*     (direct branch rewrite bypasses hooks)
 *
 * NOT DETECTABLE: shell function aliases (e.g. `g(){ command git "$@"; }; g commit`).
 * The git-level commit-msg hook installed by session-commit-msg-installer.ts is the
 * backstop for those cases.
 */

import { lintMessage, resolveRepoRoot } from '../../hooks/lib/commit-convention.mjs'
import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

export interface HookResult { stdout: string; stderr: string; exit: number }

function allow(): HookResult { return { stdout: "", stderr: "", exit: 0 }; }

function deny(reason: string): HookResult {
  return {
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }) + "\n",
    stderr: "",
    exit: 0,
  };
}

function containsShellVar(s: string): boolean {
  return /\$[{(a-zA-Z_]/.test(s);
}

function lintAndDecide(message: string, cwd: string): HookResult {
  const result = lintMessage(message, { repoRoot: resolveRepoRoot(cwd) });
  if (result.violations.length === 0) return allow();
  const lines = [...result.violations]
    .sort((a: { line: number }, b: { line: number }) => a.line - b.line)
    .map((v: { line: number; reason: string }) => `  line ${v.line}: ${v.reason}`);
  if (result.pointer) lines.push(`Commit style is set by .house-rules.json: ${result.pointer}`);
  return deny(`Commit message lint violations:\n${lines.join('\n')}`);
}

/**
 * Split a shell command string on unquoted &&, ||, ;, |, newline operators.
 * Single- and double-quoted regions and heredoc bodies are skipped.
 */
function splitOnShellOps(cmd: string): Array<{ text: string; start: number }> {
  const segments: Array<{ text: string; start: number }> = [];
  const push = (text: string, end: number) => segments.push({ text, start: end - text.length });
  let current = '';
  let i = 0;
  const pending: Array<{ tag: string; strip: boolean }> = [];
  while (i < cmd.length) {
    const c = cmd[i];
    if (c === '<' && cmd[i + 1] === '<' && cmd[i - 1] !== '<' && cmd[i + 2] !== '<') {
      const hm = /^<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(cmd.slice(i));
      if (hm) {
        pending.push({ tag: hm[3], strip: hm[1] === '-' });
        current += hm[0]; i += hm[0].length;
        continue;
      }
    }
    if (c === '\n' && pending.length > 0) {
      push(current, i); current = ''; i++;
      for (const h of pending) {
        while (i < cmd.length) {
          let e = cmd.indexOf('\n', i);
          if (e < 0) e = cmd.length;
          const line = cmd.slice(i, e);
          i = Math.min(e + 1, cmd.length);
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.tag) break;
        }
      }
      pending.length = 0;
      continue;
    }
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
      push(current, i); current = ''; i += 2;
    } else if (c === '|' && i + 1 < cmd.length && cmd[i + 1] === '|') {
      push(current, i); current = ''; i += 2;
    } else if (c === ';' || c === '|' || c === '\n') {
      push(current, i); current = ''; i++;
    } else {
      current += c; i++;
    }
  }
  push(current, cmd.length);
  return segments.filter(s => s.text.trim().length > 0);
}

type SegmentKind = 'commit' | 'commit-tree' | 'update-ref' | 'hash-object';

interface ParsedSegment {
  found: boolean;
  kind?: SegmentKind;
  cwdOverride?: string;
  hooksPathOverride?: boolean;
  noVerify?: boolean;
}

/**
 * Parse one shell segment (no operators) for a git invocation we intercept.
 * Handles: env assignments, command/builtin prefixes, git-level option flags
 * (-C, -c, --git-dir, --work-tree, --namespace, boolean flags).
 */
function parseSegmentForGit(seg: string): ParsedSegment {
  let tokens = seg.trim().split(/\s+/).filter(t => t.length > 0);

  const unquote = (t: string) => t.replace(/^(['"])(.*)\1$/, '$2');
  const launchers: Record<string, string[]> = {
    command: [], builtin: [], nohup: [], time: [], nice: ['-n'], exec: ['-a'],
    sudo: ['-u', '-g', '-C', '-h', '-p', '-D', '-r', '-t', '-U'],
    env: ['-C', '-S', '-u'],
  };
  while (tokens.length > 0) {
    const w = unquote(tokens[0]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      tokens = tokens.slice(1);
    } else if (Object.hasOwn(launchers, w)) {
      tokens = tokens.slice(1);
      while (tokens.length > 0 && tokens[0].startsWith('-')) {
        const flag = tokens[0];
        tokens = tokens.slice(launchers[w].includes(flag) ? 2 : 1);
        if (flag === '--') break;
      }
    } else if (w === 'rtk') {
      tokens = tokens.slice(tokens[1] === 'proxy' ? 2 : 1);
    } else {
      break;
    }
  }

  if (tokens.length === 0 || basename(unquote(tokens[0])) !== 'git') return { found: false };
  tokens = tokens.slice(1);

  let cwdOverride: string | undefined;
  let hooksPathOverride = false;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (!t.startsWith('-')) break;

    if (t === '-C') {
      if (i + 1 < tokens.length) { cwdOverride = tokens[i + 1]; i += 2; } else i++;
      continue;
    }
    if (t === '-c') {
      if (i + 1 < tokens.length && /^core\.hookspath=/i.test(tokens[i + 1])) {
        hooksPathOverride = true;
      }
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

  if (i >= tokens.length) return { found: false };

  const subCmd = tokens[i];

  if (subCmd === 'commit') {
    const commitArgs = tokens.slice(i + 1);
    const noVerify = commitArgs.some(t => t === '--no-verify' || t === '-n');
    return { found: true, kind: 'commit', cwdOverride, hooksPathOverride, noVerify };
  }

  if (subCmd === 'commit-tree') {
    return { found: true, kind: 'commit-tree', cwdOverride, hooksPathOverride };
  }

  if (subCmd === 'update-ref') {
    return { found: true, kind: 'update-ref', cwdOverride, hooksPathOverride };
  }

  if (subCmd === 'hash-object') {
    return { found: true, kind: 'hash-object', cwdOverride, hooksPathOverride };
  }

  return { found: false };
}

/**
 * Detect whether `command` contains a git operation we intercept.
 * Checks each shell-operator-separated segment in order; returns on first match,
 * including the matched segment text so callers can scope extraction to that segment.
 */
function detectGitOp(command: string): ParsedSegment & { segment?: string; offset?: number } {
  for (const seg of splitOnShellOps(command)) {
    const result = parseSegmentForGit(seg.text);
    if (result.found) return { ...result, segment: seg.text, offset: seg.start };
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

function readsMessageFromStdin(seg: string): boolean {
  return /(?:^|\s)-[A-Za-z]*F(?:[\s=]+)?(['"]?)-\1(?:\s|$)|--file[\s=]+(['"]?)-\2(?:\s|$)/.test(seg);
}

function extractHeredocBody(command: string, seg: string, segStart: number): string | null {
  const m = /(?<!<)<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(seg);
  if (!m) return null;
  const nl = command.indexOf('\n', segStart + m.index + m[0].length);
  if (nl < 0) return null;
  const strip = m[1] === '-';
  const body: string[] = [];
  for (const line of command.slice(nl + 1).split('\n')) {
    if ((strip ? line.replace(/^\t+/, '') : line) === m[3]) break;
    body.push(strip ? line.replace(/^\t+/, '') : line);
  }
  return body.join('\n');
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

/**
 * Extract the target ref and --stdin flag from an update-ref segment.
 * Strips quoted -m "..." values before tokenizing to avoid space-splitting issues.
 */
function analyzeUpdateRefSegment(seg: string): { stdin: boolean; ref: string | null } {
  const afterMatch = /\bupdate-ref\b(.*)$/s.exec(seg);
  if (!afterMatch) return { stdin: false, ref: null };
  let rest = afterMatch[1];

  if (/(?:^|\s)--stdin(?:\s|$)/.test(rest)) return { stdin: true, ref: null };

  rest = rest
    .replace(/\s(?:-m|--message)\s+"[^"]*"/g, '')
    .replace(/\s(?:-m|--message)\s+'[^']*'/g, '')
    .replace(/\s(?:-m|--message)\s+\S+/g, '');

  const tokens = rest.trim().split(/\s+/).filter(t => t.length > 0);
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '--no-deref' || t === '--create-reflog') { i++; continue; }
    if (t === '-d' || t === '--delete') {
      i++;
      while (i < tokens.length && tokens[i].startsWith('-')) i++;
      return { stdin: false, ref: tokens[i]?.replace(/^['"]|['"]$/g, '') ?? null };
    }
    if (!t.startsWith('-')) return { stdin: false, ref: t.replace(/^['"]|['"]$/g, '') };
    i++;
  }
  return { stdin: false, ref: null };
}

function updateRefIsAllowed(ref: string | null): boolean {
  if (ref === null) return false;
  return ref.startsWith('refs/tags/') || ref.startsWith('refs/notes/');
}

export function check(input: unknown): HookResult {
  try {
    if (typeof input !== 'object' || input === null) return allow();
    const inp = input as Record<string, unknown>;
    if (inp['tool_name'] !== 'Bash') return allow();

    const toolInput = inp['tool_input'];
    if (typeof toolInput !== 'object' || toolInput === null) return allow();

    const command = (toolInput as Record<string, unknown>)['command'];
    if (typeof command !== 'string') return allow();

    const gitMatch = detectGitOp(command);
    if (!gitMatch.found) return allow();

    const baseCwd =
      typeof inp['cwd'] === 'string'
        ? (inp['cwd'] as string)
        : typeof (toolInput as Record<string, unknown>)['cwd'] === 'string'
          ? ((toolInput as Record<string, unknown>)['cwd'] as string)
          : process.cwd();
    const cmdCwd = gitMatch.cwdOverride ? resolve(baseCwd, gitMatch.cwdOverride) : baseCwd;

    if (gitMatch.hooksPathOverride) {
      return deny(
        'git -c core.hooksPath=... overrides the hooks directory, bypassing commit-msg validation.\n' +
        'Remove the -c core.hooksPath override.',
      );
    }

    if (gitMatch.kind === 'commit') {
      if (gitMatch.noVerify) {
        return deny(
          'git commit --no-verify (or -n) skips the commit-msg hook.\n' +
          'Use `git commit` without --no-verify so commit message conventions are enforced.',
        );
      }

      const commitSeg = gitMatch.segment ?? command;
      const inlineMsg = extractInlineMessage(commitSeg);
      if (inlineMsg !== null) return lintAndDecide(inlineMsg, cmdCwd);

      if (readsMessageFromStdin(commitSeg)) {
        const body = extractHeredocBody(command, commitSeg, gitMatch.offset ?? 0);
        if (body !== null) return lintAndDecide(body, cmdCwd);
        return deny(
          'git commit -F - reads a message from stdin which cannot be linted.\n' +
          'Use `git commit -m "<message>"` with a literal message instead.',
        );
      }

      const rawPath = extractFilePath(commitSeg);
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
    }

    if (gitMatch.kind === 'commit-tree') {
      const seg = gitMatch.segment ?? command;
      const inlineMsg = extractInlineMessage(seg);
      if (inlineMsg !== null) {
        if (containsShellVar(inlineMsg)) {
          return deny(
            'git commit-tree -m "$var" uses a shell variable whose value cannot be linted.\n' +
            'Use `git commit` or `git commit --amend` with a literal message instead.',
          );
        }
        return lintAndDecide(inlineMsg, cmdCwd);
      }

      const rawPath = extractFilePath(seg);
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

      return deny(
        'git commit-tree without -m or -F reads a message from stdin which cannot be linted.\n' +
        'Use `git commit` or `git commit --amend` with a literal message instead.',
      );
    }

    if (gitMatch.kind === 'update-ref') {
      const seg = gitMatch.segment ?? command;
      const { stdin, ref } = analyzeUpdateRefSegment(seg);
      if (stdin || !updateRefIsAllowed(ref)) {
        const target = stdin ? '--stdin' : (ref ?? 'unknown target');
        return deny(
          `git update-ref on '${target}' directly rewrites branch history without commit-msg hooks.\n` +
          'Only refs/tags/* and refs/notes/* are permitted.\n' +
          'Reword commits via `git commit --amend` or interactive rebase instead.',
        );
      }
      return allow();
    }

    if (gitMatch.kind === 'hash-object') {
      const seg = gitMatch.segment ?? command;
      const hasWrite = /(?:^|\s)-w(?:\s|$)/.test(seg);
      const isCommitType =
        /(?:^|\s)-t\s+commit(?:\s|$)/.test(seg) ||
        /(?:^|\s)--type=commit(?:\s|$)/.test(seg) ||
        /(?:^|\s)--type\s+commit(?:\s|$)/.test(seg);
      if (hasWrite && isCommitType) {
        return deny(
          'git hash-object -t commit -w creates a loose commit object without going through commit-msg hooks.\n' +
          'Use `git commit` instead.',
        );
      }
      return allow();
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
