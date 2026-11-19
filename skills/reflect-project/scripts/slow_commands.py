#!/usr/bin/env python3
"""Rank a project's shell commands by the agent wall time they cost. Stdlib only. See ../SKILL.md."""
import argparse
import glob
import json
import os
import re
import statistics as st
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime

SUB = os.sep + "subagents" + os.sep
MAX_CMD_S = 2 * 3600
IDLE_GAP_S = 300
RED = re.compile(
    r"error(\[E\d+\])?:|\bFAILED\b|\bFAIL\b|panicked at|Traceback \(most recent|not ok \d"
    r"|Exit code [1-9]|\[exit [1-9]\d*\]|exit status [1-9]|npm ERR!")
CUT = re.compile(r"(?:Exit code |\[exit |exit status )(124|137|143|144|147)\b")
NEVER_RAN = re.compile(r"^\s*(PreToolUse:|<tool_use_error>|Blocked: |Permission to use Bash)")
FAILED_TEST = re.compile(
    r"^\s*(?:FAIL|SIGABRT|SIGSEGV|TIMEOUT)\s+\[[^\]]*\]\s+(?:\(\s*\d+/\d+\)\s+)?(\S+(?: \S+)?)\s*$"
    r"|^test (\S+) \.\.\. FAILED|^--- FAIL: (\S+)|^\(fail\) (.+?)(?: \[[\d.]+ ?m?s\])?$|^FAILED (\S+)", re.M)
WRAPPERS = {"timeout", "time", "nice", "sudo", "env", "stdbuf", "command", "exec", "nohup", "xargs"}
KEYWORDS = {"until", "while", "do", "then", "if", "else", "elif", "!", "{", "(", "for", "done", "fi"}
TRIVIAL = {"cd", "echo", "export", "mkdir", "cat", "tail", "head", "grep", "rg", "sed", "set", "true",
           "false", "test", "[", "[[", "printf", "ls", "wc", "sort", "uniq", "cut", "tr", "awk", "tee",
           "sleep", "read", "source", ".", "rm", "cp", "mv", "touch", "chmod", "pwd", "date", "which",
           "find", "diff", "jq", "basename", "dirname", "local", "return", "break", "exit", "wait", "kill",
           "pgrep", "ps", "trap", "unset", "shift", "eval", "in"}
HEAVY = {"cargo", "make", "bun", "bunx", "npm", "npx", "pnpm", "yarn", "go", "pytest", "python", "python3",
         "uv", "docker", "kubectl", "helm", "k3s", "gradle", "gradlew", "mvn", "xcodebuild", "tsc", "vitest",
         "playwright", "node", "deno", "rustc", "swift", "flutter", "dotnet", "bazel", "ninja", "cmake",
         "terraform", "ansible-playbook", "ssh", "rsync"}
DEPTH = {"cargo": 2, "gh": 2, "git": 1, "docker": 1, "kubectl": 1, "helm": 1, "go": 1, "make": 1, "bun": 2,
         "npm": 2, "pnpm": 2, "yarn": 2, "uv": 2, "npx": 1, "bunx": 1, "k3s": 1}
SCRIPT_RUNNERS = {"bash", "sh", "zsh", "python", "python3", "node", "bun", "deno", "ruby"}
WORD = re.compile(r"^[A-Za-z][A-Za-z0-9_:-]*$")


def epoch(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict))
    return ""


def is_red(text):
    return bool(RED.search(text[:2000]) or RED.search(text[-6000:]))


def failed_tests(text):
    names = {(m.group(1).split()[-1] if m.group(1) else next(g for g in m.groups() if g))[:90]
             for m in FAILED_TEST.finditer(text)}
    return tuple(sorted(names)[:20])


def short_path(p):
    p = p.replace("'", "").replace('"', "")
    p = re.sub(r"^.*/(\.worktrees|worktrees)/[^/]+/", "", p)
    parts = [x for x in p.split("/") if x and x != "."]
    return "/".join(parts[-2:]) if parts else p


def segment_key(seg):
    """One pipeline segment as (program, key), or None when it has no program."""
    words = [w for w in seg.replace("(", " ").replace(")", " ").split() if ">" not in w and "<" not in w and w != "/dev/null"]
    while words:
        w = words[0]
        if w == "for":
            del words[:3]
        elif w in KEYWORDS or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w):
            words.pop(0)
        elif w in WRAPPERS:
            words.pop(0)
            while words and (words[0].startswith("-") or re.match(r"^\d+[smh]?$", words[0])
                             or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", words[0])):
                words.pop(0)
        else:
            break
    if not words:
        return None
    prog = os.path.basename(words[0].replace("'", "").replace('"', ""))
    if not re.match(r"^[A-Za-z0-9_.+-]+$", prog):
        return None
    if "/" in words[0] and prog not in HEAVY:
        return "script", short_path(words[0])
    rest = words[1:]
    if prog in SCRIPT_RUNNERS:
        script = next((w for w in rest if not w.startswith("-") and ("/" in w or "." in w)), None)
        if script and not (prog == "bun" and rest and rest[0] in ("test", "run", "install", "x")):
            return "script", prog + " " + short_path(script)
        if prog != "bun":
            return prog, prog + " (inline)"
    key = [prog]
    for w in rest:
        if len(key) > DEPTH.get(prog, 0) or w.startswith("-") or not WORD.match(w):
            break
        key.append(w)
    if prog == "cargo":
        crates = re.findall(r"(?:-p|--package)[ =]([A-Za-z0-9_-]+)", seg)
        if crates:
            key.append("-p " + ",".join(sorted(set(crates))[:3]))
        elif "--workspace" in seg:
            key.append("--workspace")
    return prog, " ".join(key)


def command_key(cmd):
    segs = [s for s in re.split(r"&&|\|\||;|\||\n", cmd) if s.strip()]
    keys = [k for k in (segment_key(s) for s in segs) if k]
    real = [k for k in keys if k[0] not in TRIVIAL]
    heavy = list(dict.fromkeys(k[1] for k in real if k[0] in HEAVY or k[0] == "script"))
    pick = " && ".join(heavy[:3]) if heavy else (real[0][1] if real else None)
    waits = bool(re.search(r"\bsleep\b", cmd)) and bool(re.search(r"\b(until|while|for)\b", cmd))
    if pick is None:
        return "wait loop" if waits or re.match(r"^\s*sleep\b", cmd) else "other shell"
    return f"wait loop: {pick}" if waits else pick


def family_of(key):
    if key.startswith("wait loop"):
        return "wait loops"
    first = key.split(" && ")[0]
    words = first.split()
    depth = {"gh": 3, "cargo": 2, "make": 2}.get(words[0], 1)
    return " ".join(words[:depth])


def scan(path, seen=None):
    """One transcript: [(start, seconds, key, red, timed, cut, failed tests)], work seconds, first and last stamp.

    seen is a set of record uuids. A record already in it is skipped, which drops the history a resumed session copies.
    """
    cmds, real_open, virt_cmd = [], {}, {}
    marker = prev = first = last = None
    work = 0.0
    try:
        fh = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return path, [], 0.0, None, None
    with fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            stamp = rec.get("timestamp")
            if not stamp:
                continue
            if seen is not None and rec.get("uuid"):
                if rec["uuid"] in seen:
                    continue
                seen.add(rec["uuid"])
            t = epoch(stamp)
            first = t if first is None else first
            if prev is not None and (t - prev <= IDLE_GAP_S or real_open):
                work += max(0.0, min(t - prev, MAX_CMD_S))
            prev = last = t
            msg = rec.get("message") or {}
            content = msg.get("content")
            virtual = bool(rec.get("isVirtual")) or msg.get("model") == "<synthetic>"
            if not isinstance(content, list):
                continue
            res = rec.get("toolUseResult")
            res = res if isinstance(res, dict) else {}
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use":
                    inp = b.get("input") or {}
                    if virtual:
                        if b.get("name") == "Bash":
                            start = marker if marker is not None else t
                            secs = min(max(0.0, t - start), MAX_CMD_S)
                            virt_cmd[b.get("id")] = (start, secs, inp.get("command") or "", 2 if secs >= 0.1 else 0)
                        marker = t
                    elif b.get("name") == "Bash":
                        real_open[b.get("id")] = (t, None, inp.get("command") or "", 0 if inp.get("run_in_background") else 1)
                    elif b.get("name") == "REPL":
                        marker = t if marker is None else max(marker, t)
                elif b.get("type") == "tool_result":
                    tid = b.get("tool_use_id")
                    opened = real_open.pop(tid, None) or virt_cmd.pop(tid, None)
                    if not opened:
                        continue
                    start, secs, cmd, timed = opened
                    secs = min(t - start, MAX_CMD_S) if secs is None else secs
                    text = text_of(b.get("content"))
                    if NEVER_RAN.match(text):
                        continue
                    out = (res.get("stdout") or "") + "\n" + (res.get("stderr") or "") if "stdout" in res else text
                    moved = bool(res.get("backgroundTaskId"))
                    cut = bool(timed) and (moved or bool(CUT.search(text[:300]) or CUT.search(text[-300:])))
                    red = not cut and not moved and "returnCodeInterpretation" not in res and (
                        bool(b.get("is_error")) or is_red(out))
                    cmds.append((start, secs, command_key(cmd), red, timed, cut, failed_tests(out) if red else ()))
    return path, cmds, work, first, last


def transcript_dir(arg):
    arg = os.path.abspath(os.path.expanduser(arg))
    if os.path.basename(os.path.dirname(arg)) == "projects" and glob.glob(os.path.join(arg, "*.jsonl")):
        return arg
    base = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.expanduser("~/.claude")
    return os.path.join(base, "projects", re.sub(r"[/.]", "-", arg))


def pct(xs, q):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * q))] if xs else 0.0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Shell commands ranked by the agent wall time they cost.")
    ap.add_argument("--days", type=float, default=3.0, help="look back this many days (default 3)")
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--json", metavar="OUT")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("dirs", nargs="*", default=["."], metavar="repo-or-transcript-dir")
    args = ap.parse_args(argv)
    since = time.time() - args.days * 86400
    paths = []
    for d in map(transcript_dir, args.dirs):
        for p in glob.glob(os.path.join(d, "*.jsonl")) + glob.glob(os.path.join(d, "*", "subagents", "agent-*.jsonl")):
            if os.path.getmtime(p) >= since:
                paths.append(p)
    if not paths:
        sys.exit(f"no transcripts newer than {args.days:g} days under: " + ", ".join(map(transcript_dir, args.dirs)))
    rows = defaultdict(lambda: {"secs": [], "est": [], "sub": 0.0, "lead": 0.0, "n": 0, "red": 0, "cut": 0, "threads": set()})
    fail_agents, fail_tests, fail_runs = defaultdict(set), defaultdict(set), defaultdict(int)
    work, shell, threads = [0.0, 0.0], [0.0, 0.0], [0, 0]
    leads = sorted((p for p in paths if SUB not in p), key=os.path.getmtime)
    subs = [p for p in paths if SUB in p]
    seen = set()
    with ProcessPoolExecutor(args.workers) as pool:
        scans = [scan(p, seen) for p in leads] + list(pool.map(scan, subs, chunksize=4))
    for path, cmds, w, first, last in scans:
        if first is None or last < since:
            continue
        who = 0 if SUB in path else 1
        threads[who] += 1
        work[who] += w
        for start, secs, key, red, timed, cut, failed in cmds:
            if start < since:
                continue
            r = rows[key]
            r["n"] += 1
            r["red"] += red
            r["cut"] += cut
            r["threads"].add(path)
            r["lead" if who else "sub"] += secs
            shell[who] += secs
            if timed:
                r["secs" if timed == 1 else "est"].append(secs)
            for name in failed:
                fail_tests[name.rpartition("::")[0] or name].add(name)
            for module in {name.rpartition("::")[0] or name for name in failed}:
                fail_agents[module].add(path)
                fail_runs[module] += 1
    share = lambda part, whole: 100 * part / whole if whole else 0.0
    ranked = sorted(rows.items(), key=lambda kv: -(kv[1]["sub"] + kv[1]["lead"]))
    print(f"window: last {args.days:g} days | subagents: {threads[0]} | lead sessions: {threads[1]}")
    print(f"subagents: {work[0] / 3600:.1f} work hours, {shell[0] / 3600:.1f} h in shell commands "
          f"({share(shell[0], work[0]):.0f}%)")
    print(f"leads: {work[1] / 3600:.1f} work hours, {shell[1] / 3600:.1f} h in shell commands "
          f"({share(shell[1], work[1]):.0f}%)")
    print("work time counts gaps of 5 minutes or less plus time inside a command.")
    print("% sub is the share of subagent work time, % lead the share of lead work time.")
    print("a compound command is one row named by its build, test and script steps. red is a heuristic on the")
    print("output and marks the whole command. cut counts runs a timeout stopped or the harness moved to the")
    print("background, so their time is a lower bound. median and p90 leave out runs started in the background.")
    print("a command run from a script has no start time. its time is the gap since the script's previous call.")
    print("median and p90 use such gaps only when a row has under 5 measured runs, and mark the median with ~.")
    print("a gap under 0.1 s means the script started the command beside another call, so it is left out.")
    fams = defaultdict(lambda: [0.0, 0.0, 0, 0])
    for key, r in ranked:
        f = fams[family_of(key)]
        f[0] += r["sub"]
        f[1] += r["lead"]
        f[2] += r["n"]
        f[3] += r["red"]
    cols = f"{'sub min':>9}{'% sub':>7}{'lead min':>10}{'% lead':>8}{'runs':>7}"
    print()
    print(f"{'family (sum of the command rows below)':46s}{cols}{'red %':>7}")
    for fam, (sub, lead, n, red) in sorted(fams.items(), key=lambda kv: -(kv[1][0] + kv[1][1]))[:12]:
        print(f"{fam[:45]:46s}{sub / 60:9.0f}{share(sub, work[0]):7.1f}{lead / 60:10.0f}{share(lead, work[1]):8.1f}"
              f"{n:7d}{100 * red / n:7.0f}")
    print()
    print(f"{'command':46s}{cols}{'median s':>10}{'p90 s':>8}{'cut':>5}{'red %':>7}{'agents':>8}{'runs/agent':>12}")
    out = []
    for key, r in ranked[:args.top]:
        n = r["n"]
        measured = len(r["secs"]) >= 5
        r["secs"] = r["secs"] if measured else r["secs"] + r["est"]
        row = {"command": key, "sub_min": r["sub"] / 60, "sub_pct": share(r["sub"], work[0]),
               "lead_min": r["lead"] / 60, "lead_pct": share(r["lead"], work[1]), "runs": n,
               "median_s": st.median(r["secs"]) if r["secs"] else 0.0, "p90_s": pct(r["secs"], 0.9), "estimated": not measured, "cut": r["cut"],
               "red_pct": 100 * r["red"] / n, "agents": len(r["threads"]), "runs_per_agent": n / len(r["threads"])}
        out.append(row)
        print(f"{key[:45]:46s}{row['sub_min']:9.0f}{row['sub_pct']:7.1f}{row['lead_min']:10.0f}{row['lead_pct']:8.1f}"
              f"{n:7d}{row['median_s']:9.1f}{'' if measured else '~':1s}{row['p90_s']:8.0f}{row['cut']:5d}{row['red_pct']:7.0f}"
              f"{row['agents']:8d}{row['runs_per_agent']:12.1f}")
    rest = ranked[args.top:]
    if rest:
        print(f"{'(' + str(len(rest)) + ' more commands)':46s}{sum(r['sub'] for _, r in rest) / 60:9.0f}{'':7s}"
              f"{sum(r['lead'] for _, r in rest) / 60:10.0f}")
    repeated = sorted(((len(v), fail_runs[name], name) for name, v in fail_agents.items() if len(v) >= 3), reverse=True)
    if repeated:
        print()
        print(f"{'tests that failed for 3 or more agents, by module':82s}{'tests':>7}{'agents':>8}{'red runs':>10}")
        for agents, runs, name in repeated[:10]:
            print(f"{name[:81]:82s}{len(fail_tests[name]):7d}{agents:8d}{runs:10d}")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"days": args.days, "subagents": threads[0], "leads": threads[1], "sub_work_h": work[0] / 3600,
                       "lead_work_h": work[1] / 3600, "sub_shell_h": shell[0] / 3600, "lead_shell_h": shell[1] / 3600,
                       "rows": out, "repeated_failures": [{"module": n, "tests": sorted(fail_tests[n]), "agents": a, "red_runs": r}
                                             for a, r, n in repeated]},
                      fh)


if __name__ == "__main__":
    main()
