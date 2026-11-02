#!/usr/bin/env python3
"""Session metrics for Claude Code project transcripts. Stdlib only. See README.md."""
import argparse
import glob
import json
import os
import re
import statistics as st
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone

PRICE = {
    "opus": (4.0, 5.0, 0.20, 20.0),
    "sonnet": (2.0, 2.5, 0.20, 10.0),
    "haiku": (0.10, 0.125, 0.01, 0.50),
    "fable": (10.0, 12.5, 0.25, 50.0),
}
CONTINUATION = re.compile(
    r"^(finish|continue|complete|rerun|re-run|resume|retry|wire|land|part [a-z0-9]|.*\(part|follow[- ]?up)", re.I)
WORKER_TYPES = {"pstack:poteto-agent", "groundwork:worker", "groundwork:implementer",
                "groundwork:junior-orchestrator"}
HARNESS_PREFIXES = ("<task-notification>", "Another Claude session sent a message",
                    "<system-reminder>", "[SYSTEM NOTIFICATION")
TEAMMATE_MIN_CALLS = 20
BUCKETS = (("1-19", 0, 20), ("20-39", 20, 40), ("40-79", 40, 80), ("80+", 80, float("inf")))
MAX_BASH_S = 6 * 3600


def epoch(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def family(model):
    model = model or "?"
    return next((k for k in PRICE if k in model), "other")


def cost_of(usage):
    total = 0.0
    for model, u in usage.items():
        p = PRICE.get(family(model))
        if p:
            total += (u["in"] * p[0] + u["cc"] * p[1] + u["cr"] * p[2] + u["out"] * p[3]) / 1e6
    return total


def user_text(content):
    if isinstance(content, str):
        return content
    for b in content if isinstance(content, list) else []:
        if isinstance(b, dict) and b.get("type") == "text":
            return b.get("text") or ""
    return ""


def records(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def scan_thread(path):
    """One pass over a transcript, main thread or subagent."""
    first = last = None
    seen = set()
    usage = defaultdict(Counter)
    tools = Counter()
    agents = []
    prompts = 0
    windows = []
    win_start = None
    bash_open = {}
    bash_s = 0.0
    startup = None
    for rec in records(path):
        t = rec.get("timestamp")
        tt = epoch(t) if t else None
        if tt is not None:
            first = tt if first is None else first
            last = tt
        typ = rec.get("type")
        msg = rec.get("message") or {}
        content = msg.get("content")
        if typ == "user" and not rec.get("isMeta"):
            blocks = content if isinstance(content, list) else []
            has_result = any(isinstance(b, dict) and b.get("type") == "tool_result" for b in blocks)
            has_text = any(isinstance(b, dict) and b.get("type") == "text" for b in blocks)
            if (isinstance(content, str) or (blocks and has_text and not has_result)) \
                    and not user_text(content).lstrip().startswith(HARNESS_PREFIXES):
                prompts += 1
            if tt is not None and (isinstance(content, str) or (isinstance(content, list) and not has_result)):
                if win_start is not None:
                    windows.append((win_start, prev_t))
                win_start = tt
        if typ == "user" and isinstance(content, list) and tt is not None:
            for b in content:
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("tool_use_id") in bash_open:
                    d = tt - bash_open.pop(b["tool_use_id"])
                    if d <= MAX_BASH_S:
                        bash_s += d
        if tt is not None:
            prev_t = tt
        if typ != "assistant":
            continue
        u = msg.get("usage")
        if u:
            if startup is None:
                startup = u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0) \
                    + u.get("input_tokens", 0)
            mid = msg.get("id")
            if mid not in seen:
                seen.add(mid)
                c = usage[msg.get("model", "?")]
                c["in"] += u.get("input_tokens", 0)
                c["cc"] += u.get("cache_creation_input_tokens", 0)
                c["cr"] += u.get("cache_read_input_tokens", 0)
                c["out"] += u.get("output_tokens", 0)
                c["msgs"] += 1
        for b in content if isinstance(content, list) else []:
            if not isinstance(b, dict) or b.get("type") != "tool_use":
                continue
            name = b.get("name")
            tools[name] += 1
            if name == "Bash" and tt is not None:
                bash_open[b.get("id")] = tt
            if name in ("Agent", "Task"):
                inp = b.get("input") or {}
                agents.append({
                    "requestId": rec.get("requestId") or msg.get("id"),
                    "type": inp.get("subagent_type", "?"),
                    "model": inp.get("model"),
                    "ts": tt,
                    "desc": inp.get("description", ""),
                })
    if win_start is not None:
        windows.append((win_start, prev_t))
    return {
        "first": first, "last": last,
        "duration_s": (last - first) if first is not None else 0,
        "usage": {m: dict(c) for m, c in usage.items()},
        "tools": dict(tools), "tool_calls": sum(tools.values()),
        "agents": agents, "user_prompts": prompts,
        "windows": windows, "bash_s": bash_s, "startup_ctx": startup,
    }


def scan_main(path):
    return path, scan_thread(path)


def scan_sub(path):
    meta = {}
    try:
        with open(path[:-6] + ".meta.json", encoding="utf-8") as fh:
            meta = json.load(fh)
    except (OSError, json.JSONDecodeError):
        pass
    th = scan_thread(path)
    th["agent_type"] = meta.get("agentType")
    real = meta.get("customAgentType") or meta.get("spawnedAgentType")
    if real:
        th["is_worker"] = real in WORKER_TYPES
    elif meta.get("taskKind") == "in_process_teammate":
        th["is_worker"] = th["tool_calls"] >= TEAMMATE_MIN_CALLS
    else:
        th["is_worker"] = th["agent_type"] in WORKER_TYPES
    th.pop("windows")
    return path, th


def active_concurrency(windows, subs):
    """Seconds of active time with 0, 1, 2+ subagents running."""
    at = defaultdict(float)
    for a, b in windows:
        ev = []
        for s0, s1 in subs:
            if s1 <= a or s0 >= b:
                continue
            ev.append((max(s0, a), 1))
            ev.append((min(s1, b), -1))
        ev.sort()
        cur, prev = 0, a
        for t, d in ev:
            at[min(cur, 2)] += t - prev
            prev = t
            cur += d
        at[min(cur, 2)] += b - prev
    return at


def build_session(path, main, subs):
    widths = Counter(a["requestId"] for a in main["agents"])
    windows = main.pop("windows")
    active = sum(b - a for a, b in windows)
    at = active_concurrency(windows, [(s["first"], s["last"]) for s in subs if s["first"] is not None])
    sid = os.path.basename(path)[:-6]
    return {
        "session": sid,
        "project": os.path.basename(os.path.dirname(path)),
        "size_mb": os.path.getsize(path) / 1048576,
        "main": main,
        "subagents": subs,
        "widths": sorted(widths.values(), reverse=True),
        "active_s": active,
        "idle_frac": at[0] / active if active > 0 else None,
        "multi_frac": at[2] / active if active > 0 else None,
    }


def collect(dirs, min_mb, eras, workers):
    paths = [p for d in dirs for p in sorted(glob.glob(os.path.join(os.path.expanduser(d), "*.jsonl")))
             if os.path.getsize(p) / 1048576 >= min_mb]
    with ProcessPoolExecutor(workers) as pool:
        mains = []
        for path, th in pool.map(scan_main, paths, chunksize=1):
            if th["first"] is None or not th["agents"] or era_of(th["first"], eras) is None:
                continue
            mains.append((path, th))
        sub_paths = []
        for path, _ in mains:
            sub_paths += sorted(glob.glob(os.path.join(path[:-6], "subagents", "agent-*.jsonl")))
        subs_by_dir = defaultdict(list)
        for sp, th in pool.map(scan_sub, sub_paths, chunksize=4):
            subs_by_dir[os.path.dirname(os.path.dirname(sp))].append(th)
    out = []
    for path, th in mains:
        s = build_session(path, th, subs_by_dir.get(path[:-6], []))
        s["era"] = era_of(th["first"], eras)
        out.append(s)
    return out


def parse_era(spec):
    name, _, rng = spec.partition("=")
    start, _, end = rng.partition("..")
    if not name or not start:
        raise argparse.ArgumentTypeError(f"bad --era {spec!r}, expected NAME=START..END")

    def stamp(x):
        return datetime.fromisoformat(x).replace(tzinfo=timezone.utc).timestamp()
    return name, stamp(start), stamp(end) if end else float("inf")


def era_of(first, eras):
    return next((n for n, a, b in eras if a <= first < b), None)


def med(xs):
    return st.median(xs) if xs else 0.0


def ratio(a, b):
    return a / b if b else 0.0


def era_metrics(ss):
    active_h = sum(s["active_s"] for s in ss) / 3600
    agents = [a for s in ss for a in s["main"]["agents"]]
    widths = [w for s in ss for w in s["widths"]]
    subs = [x for s in ss for x in s["subagents"]]
    prompts = sum(s["main"]["user_prompts"] for s in ss)
    main_cost = sum(cost_of(s["main"]["usage"]) for s in ss)
    sub_cost = sum(cost_of(x["usage"]) for x in subs)
    total = main_cost + sub_cost
    live = [s for s in ss if s["idle_frac"] is not None]
    workers = [x["startup_ctx"] / 1000 for x in subs if x["is_worker"] and x["startup_ctx"]]
    mins = [x["duration_s"] / 60 for x in subs if x["duration_s"] > 0]
    return {
        "sessions": len(ss),
        "wall_h": sum(s["main"]["duration_s"] for s in ss) / 3600,
        "active_h": active_h,
        "prompts": prompts,
        "agent_calls": len(agents),
        "calls_per_active_h": ratio(len(agents), active_h),
        "parallel_pct": 100 * ratio(sum(w > 1 for w in widths), len(widths)),
        "mean_width": ratio(sum(widths), len(widths)),
        "idle_pct": 100 * med([s["idle_frac"] for s in live]),
        "multi_pct": 100 * med([s["multi_frac"] for s in live]),
        "continuation_pct": 100 * ratio(sum(bool(CONTINUATION.match(a["desc"] or "")) for a in agents), len(agents)),
        "bash_pct": 100 * ratio(sum(s["main"]["bash_s"] for s in ss) / 3600, active_h),
        "sub_transcripts": len(subs),
        "sub_median_min": med(mins),
        "sub_median_tools": med([x["tool_calls"] for x in subs]),
        "sub_ge40_pct": 100 * ratio(sum(x["tool_calls"] >= 40 for x in subs), len(subs)),
        "startup_ctx_k": med(workers),
        "cost": total,
        "cost_per_active_h": ratio(total, active_h),
        "cost_per_prompt": ratio(total, prompts),
        "main_cost_pct": 100 * ratio(main_cost, total),
    }


def bucket_rows(ss):
    acc = {name: {"n": 0, "cost": 0.0, "calls": 0, "ctx": []} for name, _, _ in BUCKETS}
    for s in ss:
        for x in s["subagents"]:
            if not x["is_worker"]:
                continue
            name = next(n for n, lo, hi in BUCKETS if lo <= x["tool_calls"] < hi)
            u = x["usage"].values()
            msgs = sum(v["msgs"] for v in u)
            b = acc[name]
            b["n"] += 1
            b["cost"] += cost_of(x["usage"])
            b["calls"] += x["tool_calls"]
            b["ctx"].append(sum(v["cr"] + v["cc"] + v["in"] for v in u) / max(1, msgs) / 1000)
    return acc


ROWS = (
    ("sessions", "sessions", "{:.0f}"),
    ("wall hours", "wall_h", "{:.0f}"),
    ("orchestrator-active hours", "active_h", "{:.0f}"),
    ("user prompts", "prompts", "{:.0f}"),
    ("Agent calls", "agent_calls", "{:.0f}"),
    ("Agent calls per active hour", "calls_per_active_h", "{:.1f}"),
    ("parallel dispatch %", "parallel_pct", "{:.0f}"),
    ("mean dispatch width", "mean_width", "{:.2f}"),
    ("active time, 0 subagents % (median)", "idle_pct", "{:.0f}"),
    ("active time, 2+ subagents % (median)", "multi_pct", "{:.0f}"),
    ("continuation-style dispatches %", "continuation_pct", "{:.0f}"),
    ("lead foreground Bash % of active", "bash_pct", "{:.0f}"),
    ("subagent transcripts", "sub_transcripts", "{:.0f}"),
    ("subagent median minutes", "sub_median_min", "{:.1f}"),
    ("subagent median tool calls", "sub_median_tools", "{:.0f}"),
    ("subagents >= 40 tool calls %", "sub_ge40_pct", "{:.0f}"),
    ("worker start-up context, median k", "startup_ctx_k", "{:.0f}"),
    ("cost $ total", "cost", "{:,.0f}"),
    ("cost $ per active hour", "cost_per_active_h", "{:.2f}"),
    ("cost $ per user prompt", "cost_per_prompt", "{:.2f}"),
    ("main-thread cost share %", "main_cost_pct", "{:.0f}"),
)


def render(names, metrics, buckets):
    lw = max(len(r[0]) for r in ROWS)
    cw = max(12, *(len(n) + 2 for n in names))
    lines = [" " * lw + "".join(n.rjust(cw) for n in names)]
    for label, key, fmt in ROWS:
        lines.append(label.ljust(lw) + "".join(fmt.format(metrics[n][key]).rjust(cw) for n in names))
    lines += ["", f"{'subagent cost by tool calls (worker types)':44s}{'n':>7}{'$/agent':>10}{'$/tool-call':>13}{'ctx/req k':>11}"]
    for n in names:
        for name, _, _ in BUCKETS:
            b = buckets[n][name]
            if b["n"]:
                lines.append(f"{n + ' ' + name:44s}{b['n']:7d}{b['cost'] / b['n']:10.2f}"
                             f"{ratio(b['cost'], b['calls']):13.3f}{med(b['ctx']):11.0f}")
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Subagent fan-out, time and cost metrics per era.")
    ap.add_argument("--era", action="append", type=parse_era, metavar="NAME=START..END")
    ap.add_argument("--min-mb", type=float, default=2.0)
    ap.add_argument("--json", metavar="OUT")
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 1)
    ap.add_argument("dirs", nargs="+", metavar="project-dir")
    args = ap.parse_args(argv)
    eras = args.era or [("all", float("-inf"), float("inf"))]
    sessions = collect(args.dirs, args.min_mb, eras, args.workers)
    names = [n for n, _, _ in eras]
    by_era = {n: [s for s in sessions if s["era"] == n] for n in names}
    metrics = {n: era_metrics(by_era[n]) for n in names}
    buckets = {n: bucket_rows(by_era[n]) for n in names}
    print(render(names, metrics, buckets))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(sessions, fh)


if __name__ == "__main__":
    main()
