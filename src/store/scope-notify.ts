import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveRepoBase } from "../hooks/lib/repo-base.js";

export const JOURNALD_SOCKET = "/run/systemd/journal/socket";
export const SYSLOG_SOCKET = "/dev/log";
export const SYSLOG_SD_ID = "ce@32473";
const BOUND_MS = 1000;

export interface NotifyEvent {
  id: string;
  /** groundwork.child_register | groundwork.child_gate */
  type: string;
  source: string;
  linkId: string;
  time: string;
  /** Exactly the inbox file JSON (single line). */
  message: string;
}

export interface NotifyDeps {
  exists: (p: string) => boolean;
  /** Run a command with stdin; returns normally or throws. Must honour timeoutMs. */
  run: (cmd: string, args: string[], input: string, timeoutMs: number) => void;
  journaldSocket: string;
  syslogSocket: string;
}

const defaultRun: NotifyDeps["run"] = (cmd, args, input, timeoutMs) => {
  spawnSync(cmd, args, { input, timeout: timeoutMs, killSignal: "SIGKILL", stdio: ["pipe", "ignore", "ignore"] });
};

export const DEFAULT_DEPS: NotifyDeps = {
  exists: existsSync,
  run: defaultRun,
  journaldSocket: JOURNALD_SOCKET,
  syslogSocket: SYSLOG_SOCKET,
};

/** journald native-protocol fields as KEY=VALUE lines. Null when MESSAGE is multi-line. */
export function buildJournald(ev: NotifyEvent): string | null {
  if (/[\r\n]/.test(ev.message)) return null;
  return [
    "CE_SPECVERSION=1.0",
    `CE_ID=${ev.id}`,
    `CE_SOURCE=${ev.source}`,
    `CE_TYPE=${ev.type}`,
    `CE_SUBJECT=link:${ev.linkId}`,
    `CE_TIME=${ev.time}`,
    "CE_DATACONTENTTYPE=application/json",
    `MESSAGE=${ev.message}`,
  ].join("\n") + "\n";
}

/** RFC 5424 SD-PARAM value escaping: `"`, `\`, `]`. */
export function escapeSdValue(v: string): string {
  return v.replace(/[\\"\]]/g, (c) => `\\${c}`);
}

/** RFC 5424 line: PRI=<14> (user.info), no hostname/procid/msgid. */
export function buildRfc5424(ev: NotifyEvent): string {
  const p = (k: string, v: string) => `${k}="${escapeSdValue(v)}"`;
  const sd = `[${SYSLOG_SD_ID} ${[
    p("specversion", "1.0"),
    p("id", ev.id),
    p("source", ev.source),
    p("type", ev.type),
    p("subject", `link:${ev.linkId}`),
    p("time", ev.time),
  ].join(" ")}]`;
  return `<14>1 ${ev.time} - groundwork - - ${sd} ${ev.message}`;
}

/**
 * Best-effort CloudEvents notification. Transport order: journald (via `logger --journald`:
 * Bun has no unix-datagram socket API, so a direct send is not possible), then /dev/log
 * (raw RFC 5424 datagram via `nc -u -U`), else no-op. Never throws, no retries, <=1s total.
 */
export function notifyInboxEvent(ev: NotifyEvent, deps: NotifyDeps = DEFAULT_DEPS): void {
  try {
    const deadline = Date.now() + BOUND_MS;
    const left = () => Math.max(1, deadline - Date.now());
    if (deps.exists(deps.journaldSocket)) {
      const body = buildJournald(ev);
      if (body !== null) deps.run("logger", ["--journald"], body, left());
      return;
    }
    if (deps.exists(deps.syslogSocket)) {
      deps.run("nc", ["-u", "-U", "-w", "1", deps.syslogSocket], buildRfc5424(ev), left());
    }
  } catch { /* silent by contract */ }
}

/** Build + send for an inbox write. `cwd` resolves the writer's repo base. */
export function notifyForInboxWrite(
  type: string,
  linkId: string,
  eventId: string,
  message: string,
  cwd: string = process.cwd(),
  deps: NotifyDeps = DEFAULT_DEPS,
): void {
  if (process.env.GROUNDWORK_NOTIFY === "off") return;
  try {
    notifyInboxEvent({
      id: eventId,
      type: `groundwork.${type.toLowerCase()}`,
      source: `groundwork://${resolveRepoBase(cwd)}`,
      linkId,
      time: new Date().toISOString(),
      message,
    }, deps);
  } catch { /* silent */ }
}
