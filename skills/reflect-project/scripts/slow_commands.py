#!/usr/bin/env python3
"""Rank a project's shell commands by the agent wall time they cost. Stdlib only. See README.md."""
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

MAX_CMD_S = 2 * 3600
IDLE_GAP_S = 300
RED = re.compile(
    r"error(\[E\d+\])?:|\bFAILED\b|\bFAIL\b|panicked at|Traceback \(most recent|not ok \d"
    r"|Exit code [1-9]|\[exit [1-9]\d*\]|exit status [1-9]|npm ERR!")
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
    return " ".join(words[:2]) if words[0] in ("cargo", "gh", "make") and len(words) > 1 else words[0]


def scan(path):
    """One transcript: [(start, seconds, key, red, virtual)], work seconds, first and last stamp."""
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
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use":
                    inp = b.get("input") or {}
                    if virtual:
                        if b.get("name") == "Bash":
                            start = marker if marker is not None else t
                            virt_cmd[b.get("id")] = (start, min(max(0.0, t - start), MAX_CMD_S), inp.get("command") or "")
                        marker = t
                    elif b.get("name") == "Bash":
                        real_open[b.get("id")] = (t, inp.get("command") or "")
                    elif b.get("name") == "REPL":
                        marker = t if marker is None else max(marker, t)
                elif b.get("type") == "tool_result":
                    tid = b.get("tool_use_id")
                    if tid in real_open:
                        start, cmd = real_open.pop(tid)
                        red = bool(b.get("is_error")) or is_red(text_of(b.get("content")))
                        cmds.append((start, min(t - start, MAX_CMD_S), command_key(cmd), red, False))
                    elif tid in virt_cmd:
                        start, secs, cmd = virt_cmd.pop(tid)
                        res = rec.get("toolUseResult") or {}
                        out = (res.get("stdout") or "") + "\n" + (res.get("stderr") or "") if isinstance(res, dict) else ""
                        red = bool(b.get("is_error")) or is_red(out or text_of(b.get("content")))
                        cmds.append((start, secs, command_key(cmd), red, True))
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
    rows = defaultdict(lambda: {"secs": [], "red": 0, "threads": set(), "virtual": 0})
    work = shell = sub_work = sub_shell = 0.0
    threads = 0
    with ProcessPoolExecutor(args.workers) as pool:
        for path, cmds, w, first, last in pool.map(scan, paths, chunksize=4):
            if first is None or last < since:
                continue
            threads += 1
            work += w
            is_sub = os.sep + "subagents" + os.sep in path
            sub_work += w if is_sub else 0.0
            for start, secs, key, red, virtual in cmds:
                if start < since:
                    continue
                r = rows[key]
                r["secs"].append(secs)
                r["red"] += red
                r["threads"].add(path)
                r["virtual"] += virtual
                shell += secs
                sub_shell += secs if is_sub else 0.0
    ranked = sorted(rows.items(), key=lambda kv: -sum(kv[1]["secs"]))
    n_cmds = sum(len(r["secs"]) for _, r in ranked)
    print(f"window: last {args.days:g} days | threads: {threads} | agent work hours: {work / 3600:.1f} | "
          f"shell commands: {n_cmds}, {shell / 3600:.1f} h ({100 * shell / work if work else 0:.0f}% of work time)")
    print(f"subagents only: {sub_work / 3600:.1f} work hours, {sub_shell / 3600:.1f} h in shell commands "
          f"({100 * sub_shell / sub_work if sub_work else 0:.0f}%)")
    print("work time counts gaps of 5 minutes or less plus time inside a command. red is a heuristic on the output.")
    print("a compound command is one row named by its build, test and script steps.")
    fams = defaultdict(lambda: [0.0, 0, 0])
    for key, r in ranked:
        f = fams[family_of(key)]
        f[0] += sum(r["secs"])
        f[1] += len(r["secs"])
        f[2] += r["red"]
    print()
    print(f"{'family':46s}{'total min':>10}{'% work':>8}{'runs':>7}{'red %':>7}")
    for fam, (secs, n, red) in sorted(fams.items(), key=lambda kv: -kv[1][0])[:12]:
        print(f"{fam[:45]:46s}{secs / 60:10.0f}{100 * secs / work if work else 0:8.1f}{n:7d}{100 * red / n:7.0f}")
    print()
    print(f"{'command':46s}{'total min':>10}{'% work':>8}{'runs':>7}{'median s':>10}{'p90 s':>8}{'red %':>7}{'agents':>8}{'runs/agent':>12}")
    out = []
    for key, r in ranked[:args.top]:
        total = sum(r["secs"])
        n = len(r["secs"])
        row = {"command": key, "total_min": total / 60, "work_pct": 100 * total / work if work else 0, "runs": n,
               "median_s": st.median(r["secs"]), "p90_s": pct(r["secs"], 0.9), "red_pct": 100 * r["red"] / n,
               "agents": len(r["threads"]), "runs_per_agent": n / len(r["threads"])}
        out.append(row)
        print(f"{key[:45]:46s}{row['total_min']:10.0f}{row['work_pct']:8.1f}{n:7d}{row['median_s']:10.1f}"
              f"{row['p90_s']:8.0f}{row['red_pct']:7.0f}{row['agents']:8d}{row['runs_per_agent']:12.1f}")
    rest = ranked[args.top:]
    if rest:
        print(f"{'(' + str(len(rest)) + ' more commands)':46s}{sum(sum(r['secs']) for _, r in rest) / 60:10.0f}")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"days": args.days, "threads": threads, "work_h": work / 3600, "shell_h": shell / 3600, "rows": out}, fh)


if __name__ == "__main__":
    main()
