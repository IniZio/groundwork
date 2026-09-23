// Portable commit-msg hook generator for host repositories. Callers must never
// overwrite a hook file that fails isGroundworkHook(). See commit-msg-template.d.mts.

export const HOOK_MARKER = 'GROUNDWORK-COMMIT-MSG'

export function isGroundworkHook(content) {
  return content.split('\n').some((line) => line.startsWith('# ' + HOOK_MARKER + ' v'))
}

export function renderCommitMsgHook({ hooksLibPath, version }) {
  // Double-quoted concatenation, not template literals, so the emitted script can
  // contain bare backticks and ${} without escaping fights.
  const nodeLines = [
    "import { readFileSync, writeFileSync, existsSync } from 'node:fs'",
    "",
    "const libPath = process.env.GROUNDWORK_HOOKS_LIB",
    "const convPath = `${libPath}/commit-convention.mjs`",
    "",
    "if (!libPath || !existsSync(convPath)) {",
    "  process.stderr.write(`commit-msg: groundwork not found at ${libPath ?? '(unset)'} — skipping lint\\n`)",
    "  process.exit(0)",
    "}",
    "",
    "let lintMessage",
    "try {",
    "  const mod = await import(`file://${convPath}`)",
    "  lintMessage = mod.lintMessage",
    "} catch (err) {",
    "  process.stderr.write(`commit-msg: failed to load groundwork (${err?.message ?? err}) — skipping lint\\n`)",
    "  process.exit(0)",
    "}",
    "",
    "const msgFile = process.env.COMMIT_MSG_FILE",
    "if (!msgFile) {",
    "  process.stderr.write('commit-msg: missing argument (commit message file path)\\n')",
    "  process.exit(1)",
    "}",
    "",
    "const commentChar = process.env.COMMENT_CHAR || '#'",
    "const cleanupMode = process.env.CLEANUP_MODE || 'default'",
    "const escapedChar = commentChar.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')",
    "",
    "const original = readFileSync(msgFile, 'utf8')",
    "let cleaned = original",
    "",
    "if (cleanupMode === 'scissors') {",
    "  const idx = cleaned.search(new RegExp('^' + escapedChar + ' -{8,} >8 -{8,}$', 'm'))",
    "  if (idx !== -1) cleaned = cleaned.slice(0, idx)",
    "}",
    "",
    "cleaned = cleaned.replace(new RegExp('^' + escapedChar + '.*$', 'gm'), '')",
    "cleaned = cleaned.replace(/\\n{3,}/g, '\\n\\n')",
    "",
    "const repoRoot = process.env.REPO_ROOT || null",
    "const { stripped, violations } = lintMessage(cleaned, { repoRoot })",
    "",
    "writeFileSync(msgFile, stripped.trimEnd() + '\\n')",
    "",
    "if (violations.length > 0) {",
    "  for (const { line, reason } of violations) {",
    "    process.stderr.write(`commit-msg: line ${line}: ${reason}\\n`)",
    "  }",
    "  process.exit(1)",
    "}",
  ]

  const bashLines = [
    "#!/bin/bash",
    "# " + HOOK_MARKER + " v" + version,
    "# Managed by groundwork — do not edit.",
    "if [ \"${GROUNDWORK_COMMIT_LINT:-}\" = \"0\" ]; then exit 0; fi",
    "",
    "GROUNDWORK_HOOKS_LIB=\"" + hooksLibPath + "\"",
    "COMMENT_CHAR=\"$(git config --get core.commentChar 2>/dev/null || echo '#')\"",
    "CLEANUP_MODE=\"$(git config --get commit.cleanup 2>/dev/null || echo 'default')\"",
    "REPO_ROOT=\"$(git rev-parse --show-toplevel 2>/dev/null || echo '')\"",
    "COMMIT_MSG_FILE=\"$1\" GROUNDWORK_HOOKS_LIB=\"$GROUNDWORK_HOOKS_LIB\" COMMENT_CHAR=\"$COMMENT_CHAR\" CLEANUP_MODE=\"$CLEANUP_MODE\" REPO_ROOT=\"$REPO_ROOT\" exec node --input-type=module <<'EOF'",
    ...nodeLines,
    "EOF",
    "",
  ]

  return bashLines.join('\n')
}
