import { existsSync } from "node:fs";
import path from "node:path";
import {
  deliveryKey,
  formatNotice,
  ledgerPath,
  markDelivered,
  pendingNotices,
  type LedgerOpts,
} from "./lib/autofix-ledger.js";

export function run(input: unknown, opts?: { dir?: string }): string {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return "";
    const inp = input as Record<string, unknown>;

    const tool_input = inp.tool_input;
    if (!tool_input || typeof tool_input !== "object" || Array.isArray(tool_input)) return "";
    const file_path = (tool_input as Record<string, unknown>).file_path;
    if (typeof file_path !== "string" || !file_path) return "";

    const ledgerOpts: LedgerOpts | undefined = opts?.dir ? { dir: opts.dir } : undefined;

    const lp = ledgerPath(ledgerOpts);
    if (!existsSync(lp)) return "";

    const session_id = typeof inp.session_id === "string" ? inp.session_id : undefined;
    const agent_id = typeof inp.agent_id === "string" ? inp.agent_id : undefined;
    const cwd = typeof inp.cwd === "string" ? inp.cwd : undefined;

    const resolvedFile = path.isAbsolute(file_path)
      ? file_path
      : path.resolve(cwd ?? ".", file_path);

    const key = deliveryKey(session_id, agent_id);
    const recs = pendingNotices(resolvedFile, key, ledgerOpts);
    if (recs.length === 0) return "";

    const notice = formatNotice(resolvedFile, recs);
    markDelivered(resolvedFile, key, recs.map((r) => r.fixedHash), ledgerOpts);

    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: notice,
      },
    });
  } catch {
    return "";
  }
}

if (import.meta.main) {
  try {
    const raw = await Bun.stdin.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      process.exit(0);
    }
    const out = run(parsed);
    if (out) process.stdout.write(out);
  } catch {
    // never throws
  }
  process.exit(0);
}
