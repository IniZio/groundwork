import { describe, it, expect } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_DEPS, buildJournald, buildRfc5424, escapeSdValue, notifyInboxEvent, notifyForInboxWrite,
  type NotifyDeps, type NotifyEvent,
} from "../../src/store/scope-notify.js";
import { writeInboxEvent } from "../../src/store/scope-inbox.js";

const ev: NotifyEvent = {
  id: "11111111-2222-3333-4444-555555555555",
  type: "groundwork.child_gate",
  source: "groundwork:///repo/root",
  linkId: "L1",
  time: "2026-10-03T09:15:00.000Z",
  message: JSON.stringify({ event_id: "x", type: "CHILD_GATE", payload: { a: 'q"u]o\\te' } }),
};

function deps(over: Partial<NotifyDeps>): { d: NotifyDeps; calls: { cmd: string; args: string[]; input: string }[] } {
  const calls: { cmd: string; args: string[]; input: string }[] = [];
  const d: NotifyDeps = {
    exists: () => false,
    run: (cmd, args, input) => { calls.push({ cmd, args, input }); },
    journaldSocket: "/j", syslogSocket: "/s",
    ...over,
  };
  return { d, calls };
}

describe("scope notify", () => {
  it("journald field set is exact", () => {
    expect(buildJournald(ev)).toBe([
      "CE_SPECVERSION=1.0",
      `CE_ID=${ev.id}`,
      "CE_SOURCE=groundwork:///repo/root",
      "CE_TYPE=groundwork.child_gate",
      "CE_SUBJECT=link:L1",
      "CE_TIME=2026-10-03T09:15:00.000Z",
      "CE_DATACONTENTTYPE=application/json",
      `MESSAGE=${ev.message}`,
    ].join("\n") + "\n");
  });

  it("multi-line MESSAGE is refused for journald", () => {
    expect(buildJournald({ ...ev, message: "a\nb" })).toBeNull();
  });

  it("rfc5424 escapes quote, backslash, bracket", () => {
    expect(escapeSdValue('a"b\\c]d')).toBe('a\\"b\\\\c\\]d');
    const line = buildRfc5424({ ...ev, source: 'src"]\\' });
    expect(line).toBe(
      `<14>1 ${ev.time} - groundwork - - [ce@32473 specversion="1.0" id="${ev.id}" source="src\\"\\]\\\\" ` +
      `type="groundwork.child_gate" subject="link:L1" time="${ev.time}"] ${ev.message}`,
    );
  });

  it("prefers journald, then syslog, else no-op", () => {
    let t = deps({ exists: () => true });
    notifyInboxEvent(ev, t.d);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].cmd).toBe("logger");
    expect(t.calls[0].input).toBe(buildJournald(ev)!);

    t = deps({ exists: (p) => p === "/s" });
    notifyInboxEvent(ev, t.d);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0].cmd).toBe("nc");
    expect(t.calls[0].input).toBe(buildRfc5424(ev));

    t = deps({});
    notifyInboxEvent(ev, t.d);
    expect(t.calls).toHaveLength(0);
  });

  it("throwing runner is swallowed", () => {
    const t = deps({ exists: () => true, run: () => { throw new Error("boom"); } });
    expect(() => notifyInboxEvent(ev, t.d)).not.toThrow();
  });

  const haveTools = spawnSync("python3", ["--version"]).status === 0 && spawnSync("which", ["nc"]).status === 0;
  it.skipIf(!haveTools)("real unix datagram to a temp socket carries the RFC 5424 line", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gwnotify-"));
    const sock = path.join(dir, "log"), out = path.join(dir, "out");
    const py = `import socket\ns=socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM)\ns.bind(${JSON.stringify(sock)})\nprint("ready",flush=True)\nopen(${JSON.stringify(out)},"wb").write(s.recv(65536))\n`;
    const rx = spawn("python3", ["-c", py], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise<void>((r) => rx.stdout!.once("data", () => r()));
    notifyInboxEvent(ev, { ...DEFAULT_DEPS, journaldSocket: path.join(dir, "no-journal"), syslogSocket: sock });
    await new Promise<void>((r) => rx.once("exit", () => r()));
    expect(readFileSync(out, "utf8").trimEnd()).toBe(buildRfc5424(ev));
  });

  it("broken transport (path is not a socket) does not throw; inbox write succeeds", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gwnotify-"));
    const fake = path.join(dir, "notasock");
    writeFileSync(fake, "x");
    const broken: NotifyDeps = { ...DEFAULT_DEPS, journaldSocket: path.join(dir, "gone"), syslogSocket: fake };
    expect(() => notifyInboxEvent(ev, broken)).not.toThrow();
    expect(() => notifyForInboxWrite("CHILD_GATE", "L1", "e1", "{}", dir, broken)).not.toThrow();
    const r = writeInboxEvent(path.join(dir, "parent"), "L1", "CHILD_GATE", { link_id: "L1" });
    expect(readFileSync(r.file, "utf8")).toContain(r.event_id);
  });
});

describe("scope notify opt-out", () => {
  it("GROUNDWORK_NOTIFY=off makes notifyForInboxWrite a no-op", () => {
    expect(process.env.GROUNDWORK_NOTIFY).toBe("off");
    const calls: string[] = [];
    const d: NotifyDeps = { exists: () => true, run: (c) => { calls.push(c); }, journaldSocket: "/j", syslogSocket: "/s" };
    notifyForInboxWrite("CHILD_GATE", "L1", "e1", "{}", process.cwd(), d);
    expect(calls).toHaveLength(0);
    const prev = process.env.GROUNDWORK_NOTIFY;
    delete process.env.GROUNDWORK_NOTIFY;
    try {
      notifyForInboxWrite("CHILD_GATE", "L1", "e1", "{}", process.cwd(), d);
      expect(calls).toEqual(["logger"]);
    } finally { process.env.GROUNDWORK_NOTIFY = prev; }
  });
});

describe("scope notify time bound", () => {
  function fakeBin(): string {
    const bin = mkdtempSync(path.join(os.tmpdir(), "gwfake-"));
    for (const n of ["logger", "nc"]) {
      writeFileSync(path.join(bin, n), '#!/bin/sh\ntrap "" TERM\nsleep 10\n');
      chmodSync(path.join(bin, n), 0o755);
    }
    return bin;
  }
  const SRC = path.resolve(import.meta.dir, "../../src/store");
  // Child process so PATH is fixed at launch (Bun ignores in-place PATH edits for spawn lookup).
  function timedChild(bin: string, exists: string, parent: string): { ms: number; out: string } {
    const script = path.join(bin, "run.ts");
    writeFileSync(script, `
import { DEFAULT_DEPS, notifyInboxEvent } from ${JSON.stringify(SRC + "/scope-notify.ts")};
import { writeInboxEvent } from ${JSON.stringify(SRC + "/scope-inbox.ts")};
const ev = { id: "i", type: "groundwork.child_gate", source: "s", linkId: "L1", time: "t", message: "{}" };
let t0 = Date.now();
notifyInboxEvent(ev, { ...DEFAULT_DEPS, exists: ${exists} });
const direct = Date.now() - t0;
console.log(direct);
`);
    const env: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [script], { env, encoding: "utf8", timeout: 30000 });
    void parent;
    return { ms: Date.now() - t0, out: r.stdout.trim() };
  }

  for (const [name, exists] of [
    ["logger", "() => true"],
    ["nc", '(p: string) => p === "/dev/log"'],
  ] as const) {
    it(`SIGTERM-ignoring ${name} cannot hold the notifier past the bound`, () => {
      const r = timedChild(fakeBin(), exists, "");
      expect(Number(r.out)).toBeLessThan(1500);
      expect(r.ms).toBeLessThan(3000);
    });
  }

  it("inbox write still succeeds and returns promptly with a hanging logger", () => {
    const bin = fakeBin();
    const dir = mkdtempSync(path.join(os.tmpdir(), "gwnotify-"));
    const script = path.join(bin, "w.ts");
    writeFileSync(script, `
import { writeInboxEvent } from ${JSON.stringify(SRC + "/scope-inbox.ts")};
const t0 = Date.now();
const r = writeInboxEvent(${JSON.stringify(dir)}, "L1", "CHILD_GATE", { link_id: "L1" });
console.log(JSON.stringify({ ms: Date.now() - t0, file: r.file }));
`);
    const env: Record<string, string | undefined> = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    delete env.GROUNDWORK_NOTIFY;
    const r = spawnSync(process.execPath, [script], { env, encoding: "utf8", timeout: 30000 });
    const o = JSON.parse(r.stdout.trim()) as { ms: number; file: string };
    expect(readFileSync(o.file, "utf8")).toContain("CHILD_GATE");
    expect(o.ms).toBeLessThan(1500);
  });
});
