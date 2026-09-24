#!/usr/bin/env bash
# probe.sh — spike probe: does nexus (Cloud Hypervisor microVM sandbox) run
# inside this (possibly non-privileged) k8s pod, and how fast?
#
# Every section is labelled, continues on failure, and prints PASS/FAIL so a
# single run produces a full report even if later steps fail. Nothing here
# modifies the nexus source tree — it only invokes the `nexus` binary baked
# into this image (see Dockerfile) and files owned by this probe kit.
#
# SPIKE ONLY — not production. See README.md.
set -uo pipefail

# TOOLCHAIN_REF is supplied by the pod env (see pod-*.yaml) and points at the
# image CI built+pushed with `docker buildx` from
# toolchain/.nexus/Containerfile — see "toolchain image" section below for
# why `nexus image build` (builder-VM path) is no longer used at all.
BASE_IMAGE="${PROBE_BASE_IMAGE:-debian:bookworm-slim}"

PASS_COUNT=0
FAIL_COUNT=0
# Only CRITICAL steps (kvm open, unshare, tun open, cold nexus run) decide the
# exit code. Every other FAIL -- including the expected-fail checks (SYS_ADMIN
# on NET_ADMIN-only pods, `nexus run` --allow-host gap) -- is still counted and
# printed but never flips the exit status.
CRITICAL_FAIL_COUNT=0
CRITICAL_FAILED=()

section() {
    echo
    echo "===== $* ====="
}

# run_step [--critical] <label> -- <command...>
# Times the command, prints PASS/FAIL + elapsed wall time, never aborts the
# script (each step's failure is independent evidence, not a script bug).
run_step() {
    local critical=0
    if [ "$1" = "--critical" ]; then critical=1; shift; fi
    local label="$1"; shift
    [ "$1" = "--" ] && shift
    local start end elapsed status
    start=$(date +%s.%N)
    "$@"
    status=$?
    end=$(date +%s.%N)
    elapsed=$(awk -v s="$start" -v e="$end" 'BEGIN{printf "%.3f", e-s}')
    if [ "$status" -eq 0 ]; then
        echo "[PASS] ${label} (${elapsed}s)"
        PASS_COUNT=$((PASS_COUNT+1))
    else
        if [ "$critical" -eq 1 ]; then
            echo "[FAIL] [CRITICAL] ${label} (${elapsed}s, exit ${status})"
            CRITICAL_FAIL_COUNT=$((CRITICAL_FAIL_COUNT+1))
            CRITICAL_FAILED+=("$label")
        else
            echo "[FAIL] ${label} (${elapsed}s, exit ${status})"
        fi
        FAIL_COUNT=$((FAIL_COUNT+1))
    fi
    return 0
}

cleanup_sandbox() {
    # best-effort; ignore errors — sandbox may already be gone/never created
    nexus stop "$1" >/dev/null 2>&1 || true
    nexus rm "$1" >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
section "ensure pod-env directories exist"
# ---------------------------------------------------------------------------
# Real cluster run hit: `resolve image: pull OCI ... staging dir: stat
# /work/tmp: no such file or directory` — emptyDir mounts /work itself, but
# not the TMPDIR/XDG_RUNTIME_DIR subdirectories the pod env points at
# (pod-*.yaml env: TMPDIR=/work/tmp, XDG_RUNTIME_DIR=/work/rt), and nexus
# does not mkdir -p them itself before first use.
for d in "${TMPDIR:-}" "${XDG_RUNTIME_DIR:-}" "${HOME:-}/.local/state/nexus"; do
    [ -n "$d" ] || continue
    if mkdir -p "$d"; then
        echo "ensured directory exists: $d"
    else
        echo "WARNING: mkdir -p failed for: $d"
    fi
done

# ---------------------------------------------------------------------------
section "id / capability sets"
# ---------------------------------------------------------------------------
id
echo "--- /proc/self/status Cap lines (hex bitmasks: CapInh/Prm/Eff/Bnd/Amb) ---"
grep -E '^Cap(Inh|Prm|Eff|Bnd|Amb):' /proc/self/status
echo "--- decoded (requires libcap-bin capsh; best-effort) ---"
if command -v capsh >/dev/null 2>&1; then
    capsh --print | grep -E 'Current|Bounding' || true
else
    echo "capsh not installed in this image — hex bitmasks above are the raw evidence"
fi
echo "--- NET_ADMIN specifically: is it in the EFFECTIVE set for this UID? ---"
eff_hex=$(grep '^CapEff:' /proc/self/status | awk '{print $2}')
# CAP_NET_ADMIN = bit 12 (0x1000)
eff_dec=$((16#${eff_hex}))
if (( (eff_dec >> 12) & 1 )); then
    echo "[PASS] CAP_NET_ADMIN present in CapEff (hex=${eff_hex})"
    PASS_COUNT=$((PASS_COUNT+1))
else
    echo "[FAIL] CAP_NET_ADMIN NOT in CapEff (hex=${eff_hex}) — this is the exact unknown the cluster facts flagged: k8s-added caps may not reach a non-root UID's effective set"
    FAIL_COUNT=$((FAIL_COUNT+1))
fi
echo "--- SYS_ADMIN specifically: is it in the EFFECTIVE set for this UID? ---"
# CAP_SYS_ADMIN = bit 21 (0x200000)
if (( (eff_dec >> 21) & 1 )); then
    echo "[PASS] CAP_SYS_ADMIN present in CapEff (hex=${eff_hex})"
    PASS_COUNT=$((PASS_COUNT+1))
else
    echo "[FAIL] CAP_SYS_ADMIN NOT in CapEff (hex=${eff_hex}) — expected FAIL on pod-root.yaml/pod-nonroot.yaml (NET_ADMIN only); expected PASS only on pod-root-sysadmin.yaml"
    FAIL_COUNT=$((FAIL_COUNT+1))
fi

echo "--- fd / inotify limits (context for kubelet 'failed to create fsnotify watcher' log-stream breaks) ---"
echo "ulimit -n (soft/hard) = $(ulimit -Sn)/$(ulimit -Hn)"
for k in max_user_instances max_user_watches max_queued_events; do
    echo "fs.inotify.${k} = $(cat /proc/sys/fs/inotify/${k} 2>/dev/null || echo unreadable)"
done

# ---------------------------------------------------------------------------
section "userns/netns (isolates seccomp/cap blocks from nexus failures)"
# ---------------------------------------------------------------------------
# nexus's netns child sets Cloneflags: CLONE_NEWUSER | CLONE_NEWNET
# (/tmp/nexus/internal/core/driver/cloudhypervisor/ch_netns_linux.go:20).
# Under containerd's RuntimeDefault seccomp profile (used by every pod spec
# in this kit), clone/unshare calls that create new namespaces are blocked
# unless the caller has CAP_SYS_ADMIN — nexus's own docker example says so
# explicitly (/tmp/nexus/examples/nexus-in-docker/run.sh:8, "SYS_ADMIN —
# unshare(CLONE_NEWNET) inside the egress supervisor"). Running the same
# syscalls directly here, independent of nexus, tells us whether a nexus
# failure downstream is a seccomp/capability problem (this section FAILs
# too) or something nexus-specific (this section PASSes but nexus still
# fails).
echo "--- sysctls (best-effort; either file may be absent depending on kernel/distro) ---"
if [ -r /proc/sys/user/max_user_namespaces ]; then
    echo "user.max_user_namespaces = $(cat /proc/sys/user/max_user_namespaces)"
else
    echo "/proc/sys/user/max_user_namespaces not readable/present"
fi
if [ -r /proc/sys/kernel/unprivileged_userns_clone ]; then
    echo "kernel.unprivileged_userns_clone = $(cat /proc/sys/kernel/unprivileged_userns_clone)"
else
    echo "/proc/sys/kernel/unprivileged_userns_clone not present (normal on kernels without the distro-specific knob)"
fi
run_step --critical "unshare -Un true (new user namespace)" -- unshare -Un true
run_step --critical "unshare -n true (new network namespace)" -- unshare -n true
echo "--- kernel (mapping uid 0 into a userns requires CAP_SETFCAP on >= 5.12) ---"
uname -r
# CAP_SETFCAP = bit 31 (0x80000000)
if (( (eff_dec >> 31) & 1 )); then
    echo "[PASS] CAP_SETFCAP present in CapEff (hex=${eff_hex})"; PASS_COUNT=$((PASS_COUNT+1))
else
    echo "[FAIL] CAP_SETFCAP NOT in CapEff (hex=${eff_hex}) — nexus netns child cannot map uid 0"; FAIL_COUNT=$((FAIL_COUNT+1))
fi
# Mirrors nexus netnsChildAttr (ch_netns_linux.go:18-29): userns+netns, uid/gid 0->self, setgroups=deny.
# `unshare -Un` above maps nothing, so it passes without CAP_SETFCAP; these do not.
run_step --critical "unshare -Ur true (userns + map uid 0; needs CAP_SETFCAP)" -- unshare -Ur true
run_step --critical "unshare -Urn true (nexus netns child analogue)" -- unshare -Urn true
# Control: without SETFCAP the same primitive must fail (proves SETFCAP is the lever, not seccomp).
# Drops SETFCAP from the permitted set via capsh (needs no CAP_SETPCAP, unlike a
# bounding-set drop); --no-new-privs stops exec from regaining it. Passes only
# on the expected uid_map EPERM; fails closed if capsh is missing.
run_step "control: unshare -Urn with SETFCAP dropped MUST fail at uid_map" -- bash -c '
    command -v capsh >/dev/null || { echo "capsh missing"; exit 2; }
    out=$(setpriv --no-new-privs -- capsh --caps="cap_net_admin,cap_sys_admin=ep" -- -c "unshare -Urn true" 2>&1); rc=$?
    echo "$out"; [ "$rc" -ne 0 ] && grep -q uid_map <<<"$out"'
echo "--- seccomp / LSM state of this process ---"
grep -E '^(Seccomp|Seccomp_filters|NoNewPrivs):' /proc/self/status
cat /proc/self/attr/current 2>/dev/null || echo "no LSM attr"

# ---------------------------------------------------------------------------
section "/dev/kvm open test"
# ---------------------------------------------------------------------------
run_step "/dev/kvm stat" -- stat /dev/kvm
run_step --critical "/dev/kvm open for read+write" -- bash -c 'exec 3<>/dev/kvm && echo "opened fd 3 on /dev/kvm" && exec 3<&-'

# ---------------------------------------------------------------------------
section "/dev/net/tun open test (needed for TAP-based sandbox networking)"
# ---------------------------------------------------------------------------
run_step "/dev/net/tun stat" -- stat /dev/net/tun
run_step --critical "/dev/net/tun open for read+write" -- bash -c 'exec 3<>/dev/net/tun && echo "opened fd 3 on /dev/net/tun" && exec 3<&-'

# ---------------------------------------------------------------------------
section "TAP device create test (the real NET_ADMIN proof — ip tuntap add)"
# ---------------------------------------------------------------------------
# This is the actual unknown from the cluster facts: /dev/net/tun and
# `ip tuntap add` were only verified as root. If this fails for a non-root
# UID with NET_ADMIN added via k8s, nexus's TAP-based networking cannot work
# under pod-root.yaml's non-root variant even though /dev/kvm opens fine.
run_step "ip tuntap add probe0 mode tap" -- ip tuntap add dev nexus-probe0 mode tap
run_step "ip link show probe0" -- ip link show nexus-probe0
run_step "ip tuntap del probe0 mode tap (cleanup)" -- ip tuntap del dev nexus-probe0 mode tap

# ---------------------------------------------------------------------------
section "nexus doctor"
# ---------------------------------------------------------------------------
# 5 capability checks per internal/cli/substrate.go: OS is Linux,
# cloud-hypervisor on PATH, /dev/kvm openable, guest kernel present, base
# image cached; plus virtiofsd presence and driver init.
run_step "nexus doctor" -- nexus doctor
run_step "nexus doctor --json" -- nexus --json doctor

# ---------------------------------------------------------------------------
section "nexus version / build info"
# ---------------------------------------------------------------------------
run_step "nexus version" -- nexus version
if [ -f /opt/nexus/NEXUS_REV ]; then
    echo "nexus built from IniZio/nexus @ $(cat /opt/nexus/NEXUS_REV)"
fi

# ---------------------------------------------------------------------------
section "cold nexus run <base> -- echo hi (wall time, includes image pull/cache + VM boot)"
# ---------------------------------------------------------------------------
run_step --critical "nexus run ${BASE_IMAGE} -- echo hi" -- nexus run "$BASE_IMAGE" -- echo hi

# ---------------------------------------------------------------------------
section "warm nexus run <base> -- echo hi (image already cached from the step above)"
# ---------------------------------------------------------------------------
run_step "nexus run ${BASE_IMAGE} -- echo hi (warm)" -- nexus run "$BASE_IMAGE" -- echo hi

# ---------------------------------------------------------------------------
section "snapshot + fork timing"
# ---------------------------------------------------------------------------
# Real cluster run hit: `error: unknown command: pause` (also snapshot,
# resume, fork). Confirmed at this nexus ref: /tmp/nexus/internal/cli has no
# cmd_pause.go / cmd_snapshot.go / cmd_fork.go / cmd_resume.go at all, and
# the full flat-verb table (/tmp/nexus/internal/cli/cmd_flat_verbs.go:24-29)
# registers only create/ps/ls/rm/start/stop — no pause/resume/fork/snapshot.
# docs/site/sandboxes/snapshots-and-fork.md documents the feature, but the
# CLI at this ref implements none of the verbs it needs. Detect support
# first (via `nexus --help` output) rather than assuming, so this section
# self-heals once the CLI gains these verbs.
if nexus --help 2>&1 | grep -qE '(^|[[:space:]])(pause|snapshot|fork)([[:space:]]|$)'; then
    SNAP_SANDBOX="probe/snap-src"
    cleanup_sandbox "$SNAP_SANDBOX"
    run_step "nexus create ${SNAP_SANDBOX}" -- nexus create "$SNAP_SANDBOX" --image "$BASE_IMAGE" --memory 1024
    run_step "nexus pause ${SNAP_SANDBOX} (snapshot requires a paused VM)" -- nexus pause "$SNAP_SANDBOX"
    run_step "nexus snapshot create ${SNAP_SANDBOX}" -- nexus snapshot create "$SNAP_SANDBOX" probe-snap
    run_step "nexus resume ${SNAP_SANDBOX}" -- nexus resume "$SNAP_SANDBOX"
    run_step "nexus fork ${SNAP_SANDBOX} (child 1)" -- nexus fork "$SNAP_SANDBOX"
    run_step "nexus fork ${SNAP_SANDBOX} (child 2)" -- nexus fork "$SNAP_SANDBOX"
    cleanup_sandbox "$SNAP_SANDBOX"
    # fork children and the restored snapshot are separate sandboxes; best-effort
    # sweep by label would need `nexus ps`, out of scope for this spike — see
    # README.md "how to read the results" for manual cleanup of forked children.
else
    echo "[SKIP] snapshot/fork: not implemented in nexus CLI at this ref (docs/site/sandboxes/snapshots-and-fork.md documents it, but the CLI has no such verb)"
fi

# ---------------------------------------------------------------------------
section "toolchain image (g++ / rustc / go)"
# ---------------------------------------------------------------------------
# Real cluster run hit: `error: image build: image: build: no builder
# configured (builder VM integration not yet wired)` — followed by a FALSE
# [PASS] because `nexus image build` exited 0 despite the error. nexus's
# builder-VM path is not usable at this ref, full stop, so this probe no
# longer calls `nexus image build` at all. Instead CI builds
# toolchain/.nexus/Containerfile with plain `docker buildx` (no KVM needed —
# it only apt-installs packages) and pushes it as
# registry.oursky.dev/nexus-probe-toolchain:<tag>; the pod env's
# TOOLCHAIN_REF (see pod-*.yaml) points at that pushed image. This section is
# now purely informational: it only checks that TOOLCHAIN_REF was supplied
# and that `nexus run` can pull it, never PASSes on a "no builder configured"
# error (there is no such call left to produce one), and SKIPs the
# hello-world compiles below if TOOLCHAIN_REF is unset.
TOOLCHAIN_BUILD_OK=0
if [ -z "${TOOLCHAIN_REF:-}" ]; then
    echo "[SKIP] toolchain image — TOOLCHAIN_REF not set in pod env; CI did not substitute the toolchain image placeholder (see pod-*.yaml TOOLCHAIN_REF and .github/workflows/nexus-probe.yaml)"
else
    echo "using pre-built toolchain image: ${TOOLCHAIN_REF} (built by CI via docker buildx, not nexus image build — see comment above)"
    if nexus run "$TOOLCHAIN_REF" -- true 2>&1 | tee /tmp/toolchain-pull.out; then
        TOOLCHAIN_BUILD_OK=1
        echo "[PASS] toolchain image pull/run smoke test"
        PASS_COUNT=$((PASS_COUNT+1))
    elif grep -q 'no builder configured' /tmp/toolchain-pull.out; then
        echo "[SKIP] toolchain image pull/run — nexus reported 'no builder configured' (builder VM not wired at this ref); this is a known gap, not a probe failure"
    else
        echo "[FAIL] toolchain image pull/run smoke test"
        FAIL_COUNT=$((FAIL_COUNT+1))
    fi
fi

hello_c() {
    nexus run "$TOOLCHAIN_REF" -- bash -c '
        set -e
        cat > /tmp/hello.cc <<EOF
#include <cstdio>
int main() { printf("hello from g++\n"); return 0; }
EOF
        g++ -O2 -o /tmp/hello_cc /tmp/hello.cc
        /tmp/hello_cc
    '
}
hello_rs() {
    nexus run "$TOOLCHAIN_REF" -- bash -c '
        set -e
        cat > /tmp/hello.rs <<EOF
fn main() { println!("hello from rustc"); }
EOF
        rustc -O -o /tmp/hello_rs /tmp/hello.rs
        /tmp/hello_rs
    '
}
hello_go() {
    nexus run "$TOOLCHAIN_REF" -- bash -c '
        set -e
        export GOCACHE=/tmp/gocache GOPATH=/tmp/gopath GOFLAGS=-mod=mod
        mkdir -p /tmp/hello_go_src && cd /tmp/hello_go_src
        cat > main.go <<EOF
package main

import "fmt"

func main() { fmt.Println("hello from go") }
EOF
        go mod init hello >/dev/null 2>&1
        go build -o /tmp/hello_go .
        /tmp/hello_go
    '
}

# ---------------------------------------------------------------------------
section "hello-world compile+run inside the VM: g++, rustc, go (wall time each)"
# ---------------------------------------------------------------------------
if [ "$TOOLCHAIN_BUILD_OK" -eq 1 ]; then
    run_step "g++ hello-world compile+run" -- hello_c
    run_step "rustc hello-world compile+run" -- hello_rs
    run_step "go hello-world compile+run" -- hello_go
else
    echo "[SKIP] g++/rustc/go hello-world — toolchain image was not built (see previous section)"
fi

# ---------------------------------------------------------------------------
section "egress-denied check"
# ---------------------------------------------------------------------------
# nexus create/run accept --egress open|github-only (docs/site/cli/sandbox-
# commands.md); there is no documented "closed" value. A plain create with
# no --allow-host/--repo/--egress is the closest to "closed" the CLI
# exposes, and is what this section measures empirically rather than
# assuming — see docs/site/security/egress-and-perimeter.md "Egress modes"
# for why the actual default posture needs live verification, not just a
# docs read (AllowedHosts-empty is documented as AllowAll for builder/
# --context sandboxes specifically; this checks what a plain sandbox gets).
# Uses bash's /dev/tcp (no curl/nc in debian:bookworm-slim): an earlier run
# printed BLOCKED only because `curl: command not found`. A TCP connect alone
# is not proof of egress: a userspace perimeter (or any transparent proxy) can
# accept the connect and then drop the flow. So each target gets a plain HTTP
# HEAD and the probe reads the reply:
#   DATA         bytes came back  -> real egress (FAIL)
#   CONNECT_ONLY connect accepted, nothing returned -> not reachable at L7
#   CLOSED       connect refused/timed out
# HTTPS ports still answer plain HTTP (Go/nginx servers reply "HTTP/1.x 400").
# Targets:
#   - 1.1.1.1:80             public internet by IP (no DNS needed)
#   - example.com:80         public internet by name (DNS + TCP)
#   - $KUBERNETES_SERVICE_HOST:443  k8s API ClusterIP (lateral movement)
#   - 169.254.169.254:80     link-local metadata endpoint
egress_probe() {
    local k8s="${KUBERNETES_SERVICE_HOST:-10.43.0.1}"
    nexus run "$BASE_IMAGE" -- bash -c '
        echo EGRESS_PROBE_RAN
        for t in 1.1.1.1:80 example.com:80 '"$k8s"':443 169.254.169.254:80; do
            h=${t%:*}; p=${t##*:}
            out=$(timeout 6 bash -c "exec 3<>/dev/tcp/$h/$p || exit 9; printf \"HEAD / HTTP/1.0\r\nHost: $h\r\n\r\n\" >&3; head -c 16 <&3" 2>/dev/null); rc=$?
            if [ -n "$out" ]; then echo "DATA         $t  $(printf %s "$out" | head -1 | tr -cd "[:print:]")"
            elif [ "$rc" -ne 9 ] && [ "$rc" -ne 1 ]; then echo "CONNECT_ONLY $t (rc=$rc)"
            else echo "CLOSED       $t (rc=$rc)"; fi
        done
    ' 2>&1 | tee /tmp/egress-probe.out
    grep -q EGRESS_PROBE_RAN /tmp/egress-probe.out || { echo "guest did not run the probe"; return 1; }
    ! grep -q '^DATA' /tmp/egress-probe.out
}
run_step --critical "default egress: no data from internet, k8s API, or metadata" -- egress_probe
# `nexus run` has no --allow-host flag at this ref (only `create` has it), so
# no allow-list comparison is run here; see README.md gaps.

# ---------------------------------------------------------------------------
section "resource limits"
# ---------------------------------------------------------------------------
# Measurement only, not a pass/fail gate on the pod: every step below is
# NON-critical (plain run_step, no --critical) because the point is data
# ("how does nexus behave when a guest misbehaves") plus proof the pod itself
# survives, not whether any single guest workload succeeds. `nexus run` at
# this ref has only --memory/--vcpus/--name/--project
# (/tmp/nexus/docs/site/cli/sandbox-commands.md "nexus run" table,
# /tmp/nexus/internal/cli/cmd_run.go:32-37) — no --timeout, --oom-*, or
# --disk-max flag, so timeout/OOM/disk-full behaviour can only be observed
# empirically from the host side (`timeout(1)`, cgroup files, `df`/`du`),
# which is what this section does. `nexus run` does have `--force`
# (/tmp/nexus/internal/cli/cmd_run.go:38-42) but it only skips the
# disk-space preflight, not a normal cleanup path. `nexus rm`/`nexus stop`
# have no --force flag at this ref
# (/tmp/nexus/internal/cli/cmd_sandbox.go:2042-2150 runSandboxRmFull/
# runSandboxStop take only a ref argument) — cleanup below falls back to
# plain `nexus stop` + `nexus rm`.

# `comm` (what pgrep -c cloud-hypervisor matches by default) is truncated to
# 15 chars ("cloud-hyperviso"), so a plain `-c cloud-hypervisor` never
# matches and always prints "0" (or "0\n0" once the missing-match warning
# is folded in) regardless of whether a VM is actually running. Match the
# full command line instead.
rl_leftover_ch() { local n; n=$(pgrep -fc '^([^ ]*/)?cloud-hypervisor( |$)' 2>/dev/null); echo "${n:-0}"; }

# pod alive marker + leftover cloud-hypervisor count, printed after every step
rl_marker() {
    echo "[INFO] pod alive; leftover cloud-hypervisor procs: $(rl_leftover_ch)"
}

# Best-effort cleanup that reports whether it actually worked, since gap #4
# above ("does killing the CLI kill the VM") is the point of step 1.
rl_force_cleanup() {
    local ref="$1"
    if nexus rm "$ref" >/dev/null 2>&1; then
        echo "nexus rm ${ref}: succeeded"
        return 0
    fi
    echo "nexus rm ${ref}: failed; trying nexus stop then rm"
    nexus stop "$ref" >/dev/null 2>&1 || true
    if nexus rm "$ref" >/dev/null 2>&1; then
        echo "nexus stop + rm ${ref}: succeeded"
        return 0
    fi
    echo "nexus stop + rm ${ref}: FAILED — sandbox/VM may be orphaned"
    return 1
}

# --- 1. timeout: host-side `timeout 15` against an infinite loop guest -----
rl_timeout_test() {
    local ref="probe/rl-timeout"
    cleanup_sandbox "$ref"
    local start end elapsed status
    start=$(date +%s.%N)
    timeout -k 15 15 nexus run --project probe --name rl-timeout "$BASE_IMAGE" -- \
        bash -c 'while :; do :; done'
    status=$?
    end=$(date +%s.%N)
    elapsed=$(awk -v s="$start" -v e="$end" 'BEGIN{printf "%.3f", e-s}')
    echo "host timeout(1) wrapper: elapsed=${elapsed}s exit=${status} (124 = SIGTERM alone stopped nexus run [nexus catches SIGTERM and runs cleanup, root.go:61]; 137 = SIGTERM was ignored and the -k 15 hard SIGKILL was needed — itself a finding)"
    sleep 10
    local leftover ps_hit
    leftover=$(rl_leftover_ch)
    ps_hit=$(nexus ps 2>&1 | grep -c 'rl-timeout')
    echo "leftover cloud-hypervisor procs 10s after CLI kill: ${leftover}"
    echo "nexus ps (should not list ${ref} running):"
    nexus ps 2>&1 || true
    echo "nexus ps hits for rl-timeout: ${ps_hit}"
    if [ "$leftover" -eq 0 ] && [ "$ps_hit" -eq 0 ]; then
        echo "KEY RESULT: killing the CLI killed the VM (no leftover process, no leftover sandbox)"
        return 0
    fi
    echo "KEY RESULT: killing the CLI did NOT fully clean up — leftover process and/or sandbox record found"
    rl_force_cleanup "$ref" || true
    echo "leftover cloud-hypervisor procs after forced cleanup: $(rl_leftover_ch)"
    return 1
}
run_step "timeout: 15s host timeout vs. infinite loop guest, then verify cleanup" -- rl_timeout_test
rl_marker

# --- 2. memory: small --memory cap vs. an oversized guest allocation -------
# Guest script self-reports via PIPESTATUS instead of the old unconditional
# "guest survived (unexpected)" echo, which printed regardless of whether the
# guest was actually OOM-killed (real cluster run: printed "survived" with
# exit=0 even though that's ambiguous — head|tail exit codes were never
# inspected). tail_status=137 means SIGKILL (OOM); 0 means the 2G alloc
# actually succeeded (cap not enforced).
rl_memory_test() {
    local ref="probe/rl-memory"
    cleanup_sandbox "$ref"
    echo "pod memory.current before: $(cat /sys/fs/cgroup/memory.current 2>/dev/null || echo n/a)"
    echo "pod memory.stat (anon/file/shmem/kernel) before:"
    grep -E '^(anon|file|shmem|kernel) ' /sys/fs/cgroup/memory.stat 2>/dev/null || echo n/a
    local start end elapsed status output tail_status oom_hint classification result_status
    start=$(date +%s.%N)
    output=$(timeout -k 15 30 nexus run --project probe --name rl-memory --memory 512 "$BASE_IMAGE" -- \
        bash -c 'head -c 2G /dev/zero | tail -c 2G >/dev/null
st=("${PIPESTATUS[@]}")
tail_status=${st[1]}
echo "guest: head_status=${st[0]} tail_status=${tail_status}"
grep MemTotal /proc/meminfo 2>/dev/null || echo "guest: MemTotal: n/a"
if dmesg >/dev/null 2>&1; then
    echo "guest: dmesg readable; matching kernel lines (if any) follow with a guest-kmsg: prefix"
    dmesg 2>/dev/null | grep -iE "out of memory|oom-kill|killed process" | tail -5 | sed "s/^/guest-kmsg: /"
else
    echo "guest: dmesg not readable"
fi
exit "$tail_status"' 2>&1)
    status=$?
    end=$(date +%s.%N)
    elapsed=$(awk -v s="$start" -v e="$end" 'BEGIN{printf "%.3f", e-s}')
    echo "$output"
    tail_status=$(printf '%s\n' "$output" | grep -o 'tail_status=[0-9]*' | head -1 | cut -d= -f2)
    oom_hint=0
    printf '%s\n' "$output" | grep -q '^guest-kmsg: ' && oom_hint=1
    echo "--memory 512 (MiB) vs 2G guest allocation: elapsed=${elapsed}s guest_exit(tail_status, self-reported)=${tail_status:-unknown} nexus_run_exit(host side)=${status} (124 = host timeout SIGTERM, 137 = host timeout's -k 15 SIGKILL was needed)"
    # A definite tail_status=0 wins: the 2G allocation completed, so the cap did not hold.
    if [ "$tail_status" = "0" ]; then
        classification="allocation succeeded (cap NOT enforced)"
        result_status=1
    elif [ "$tail_status" = "137" ] || [ "$oom_hint" -eq 1 ]; then
        classification="OOM-killed in guest (cap held)"
        result_status=0
    else
        classification="unclear"
        result_status=0
    fi
    echo "classification: ${classification}"
    echo "pod memory.current after: $(cat /sys/fs/cgroup/memory.current 2>/dev/null || echo n/a)"
    echo "pod memory.peak after: $(cat /sys/fs/cgroup/memory.peak 2>/dev/null || echo 'not present (cgroup v1 or no memory.peak file)')"
    echo "pod memory.stat (anon/file/shmem/kernel) after:"
    grep -E '^(anon|file|shmem|kernel) ' /sys/fs/cgroup/memory.stat 2>/dev/null || echo n/a
    cleanup_sandbox "$ref"
    return "$result_status"
}
run_step "memory: --memory 512 cap vs. 2G guest allocation" -- rl_memory_test
rl_marker

# --- 3. fork bomb inside the guest, bounded by a host-side timeout ---------
rl_forkbomb_test() {
    local ref="probe/rl-forkbomb"
    cleanup_sandbox "$ref"
    local start end elapsed status
    start=$(date +%s.%N)
    timeout -k 15 20 nexus run --project probe --name rl-forkbomb --memory 512 "$BASE_IMAGE" -- \
        bash -c ':(){ :|:& };:'
    status=$?
    end=$(date +%s.%N)
    elapsed=$(awk -v s="$start" -v e="$end" 'BEGIN{printf "%.3f", e-s}')
    echo "fork bomb under 20s host timeout: elapsed=${elapsed}s exit=${status} (124 = SIGTERM sufficed; 137 = the -k 15 hard SIGKILL was needed)"
    sleep 10
    local leftover ps_hit
    leftover=$(rl_leftover_ch)
    ps_hit=$(nexus ps 2>&1 | grep -c 'rl-forkbomb')
    echo "leftover cloud-hypervisor procs 10s after: ${leftover}"
    nexus ps 2>&1 || true
    echo "nexus ps hits for rl-forkbomb: ${ps_hit}"
    if [ "$leftover" -ne 0 ] || [ "$ps_hit" -ne 0 ]; then
        rl_force_cleanup "$ref" || true
    fi
    echo "leftover cloud-hypervisor procs after cleanup attempt: $(rl_leftover_ch)"
    return 0
}
run_step "fork bomb: guest ':(){ :|:& };:' under 20s host timeout, then verify cleanup" -- rl_forkbomb_test
rl_marker

# --- 4. huge stdout: does nexus buffer the whole stream in the pod? --------
# Real cluster run got 73,728,000 of 209,715,200 bytes with no visible error
# (the old version never checked the nexus run exit code or stderr). Runs 4
# sizes so a "loses bytes above N" threshold, if any, shows up, and captures
# the nexus run exit code via PIPESTATUS + stderr to a file for each size.

# rl_stdout_run_one <label> <expected_bytes> <guest_cmd>
# guest_cmd is passed to `bash -c` inside the guest. Prints expected/received
# bytes, nexus's own exit code, elapsed time, last 3 lines of nexus stderr,
# and the max sampled pod memory.current during the run. Returns 1 (and
# prints "OUTPUT TRUNCATED ...") if fewer bytes than expected came through.
rl_stdout_run_one() {
    local label="$1" expected="$2" guest_cmd="$3"
    local ref="probe/rl-stdout"
    cleanup_sandbox "$ref"
    local sample_file stderr_file bytes_file
    sample_file=$(mktemp)
    stderr_file=$(mktemp)
    bytes_file=$(mktemp)
    # memory.peak is a lifetime high-water mark (never resets), so it cannot
    # isolate this run's contribution. Sample memory.current every 0.5s in
    # the background while the run is in flight and report the max seen.
    (
        while :; do
            cat /sys/fs/cgroup/memory.current 2>/dev/null >> "$sample_file"
            sleep 0.5
        done
    ) &
    local sampler_pid=$!
    local start end elapsed bytes nexus_status sampled_max
    start=$(date +%s.%N)
    # Pipeline runs directly in this shell (not inside a $(...) subshell) so
    # PIPESTATUS below reflects nexus run's own exit code, not wc -c's.
    timeout -k 15 60 nexus run --project probe --name rl-stdout "$BASE_IMAGE" -- \
        bash -c "$guest_cmd" 2>"$stderr_file" | wc -c > "$bytes_file"
    nexus_status="${PIPESTATUS[0]}"
    end=$(date +%s.%N)
    kill "$sampler_pid" >/dev/null 2>&1 || true
    wait "$sampler_pid" 2>/dev/null || true
    elapsed=$(awk -v s="$start" -v e="$end" 'BEGIN{printf "%.3f", e-s}')
    bytes=$(tr -d '[:space:]' < "$bytes_file")
    bytes=${bytes:-0}
    sampled_max=$(sort -n "$sample_file" 2>/dev/null | tail -1)
    echo "[${label}] expected=${expected} bytes received=${bytes} bytes nexus_exit=${nexus_status} elapsed=${elapsed}s"
    echo "[${label}] nexus stderr (last 3 lines):"
    if [ -s "$stderr_file" ]; then
        tail -3 "$stderr_file" | sed 's/^/    /'
    else
        echo "    (empty)"
    fi
    echo "[${label}] pod memory.current max sampled during run (0.5s interval): ${sampled_max:-n/a}"
    rm -f "$sample_file" "$stderr_file" "$bytes_file"
    cleanup_sandbox "$ref"
    if [ "$bytes" -lt "$expected" ] 2>/dev/null; then
        echo "OUTPUT TRUNCATED at ${label}: got ${bytes} of ${expected}"
        return 1
    fi
    return 0
}

rl_stdout_test() {
    local overall_status=0
    echo "pod memory.stat (anon/file/shmem/kernel) before:"
    grep -E '^(anon|file|shmem|kernel) ' /sys/fs/cgroup/memory.stat 2>/dev/null || echo n/a

    local sizes_human=("1M" "10M" "50M" "200M")
    local sizes_bytes=(1048576 10485760 52428800 209715200)
    local i plain50_truncated=0
    for i in "${!sizes_human[@]}"; do
        if ! rl_stdout_run_one "${sizes_human[$i]}" "${sizes_bytes[$i]}" "yes | head -c ${sizes_human[$i]}"; then
            overall_status=1
            [ "${sizes_human[$i]}" = "50M" ] && plain50_truncated=1
        fi
    done

    # Variant: does an extra sleep after head exits change the outcome? If
    # so, the loss is an exit/flush race, not steady-state stream loss.
    echo "[variant] yes | head -c 50M; sleep 2 -- separates exit/flush race from stream loss"
    local variant_truncated=0
    rl_stdout_run_one "50M+sleep2" 52428800 "yes | head -c 50M; sleep 2" || variant_truncated=1
    if [ "$plain50_truncated" -eq 1 ] && [ "$variant_truncated" -eq 0 ]; then
        echo "loss looks like an exit/flush race"
    fi

    echo "pod memory.stat (anon/file/shmem/kernel) after:"
    grep -E '^(anon|file|shmem|kernel) ' /sys/fs/cgroup/memory.stat 2>/dev/null || echo n/a
    return "$overall_status"
}
run_step "huge stdout: 1M/10M/50M/200M piped through nexus run" -- rl_stdout_test
rl_marker

# --- 5. disk fill: dd to ENOSPC inside the guest rootfs --------------------
rl_diskfill_test() {
    local ref="probe/rl-diskfill"
    cleanup_sandbox "$ref"
    local nexus_state="${HOME:-}/.local/state/nexus"
    echo "guest rootfs size before (host /work, proxy for state dir usage): $(df -h /work 2>&1 | tail -1)"
    local start end elapsed status
    start=$(date +%s.%N)
    timeout -k 15 60 nexus run --project probe --name rl-diskfill "$BASE_IMAGE" -- \
        bash -c 'dd if=/dev/zero of=/fill bs=1M 2>&1; echo "dd_exit=$?"'
    status=$?
    end=$(date +%s.%N)
    elapsed=$(awk -v s="$start" -v e="$end" 'BEGIN{printf "%.3f", e-s}')
    echo "dd to ENOSPC under 60s host timeout: elapsed=${elapsed}s host-side exit=${status} (124 = SIGTERM sufficed; 137 = the -k 15 hard SIGKILL was needed; look above for dd's own ENOSPC message/exit code)"
    echo "pod /work usage after: $(du -sh /work 2>&1 | tail -1)"
    if [ -d "$nexus_state" ]; then
        echo "nexus state dir usage after: $(du -sh "$nexus_state" 2>&1 | tail -1)"
    else
        echo "nexus state dir ${nexus_state} not present"
    fi
    cleanup_sandbox "$ref"
    echo "pod /work usage after cleanup (ephemeral sandbox disk should be reclaimed): $(du -sh /work 2>&1 | tail -1)"
    return 0
}
run_step "disk fill: dd if=/dev/zero to ENOSPC in guest rootfs" -- rl_diskfill_test
rl_marker

# --- 6. concurrency: 3 parallel toolchain compiles vs. 1 -------------------
rl_hello_cc_body='
    set -e
    cat > /tmp/hello.cc <<EOF
#include <cstdio>
int main() { printf("hello from g++\n"); return 0; }
EOF
    g++ -O2 -o /tmp/hello_cc /tmp/hello.cc
    /tmp/hello_cc
'
rl_concurrency_test() {
    if [ "${TOOLCHAIN_BUILD_OK:-0}" -ne 1 ]; then
        echo "[SKIP] concurrency — toolchain image not available (see 'toolchain image' section above)"
        return 0
    fi
    local i pids=() t0 t1
    for i in 1 2 3; do cleanup_sandbox "probe/rl-conc-${i}"; done
    cleanup_sandbox "probe/rl-conc-solo"
    t0=$(date +%s.%N)
    for i in 1 2 3; do
        (
            local ts te
            ts=$(date +%s.%N)
            timeout -k 15 300 nexus run --project probe --name "rl-conc-${i}" --memory 512 "$TOOLCHAIN_REF" -- bash -c "$rl_hello_cc_body" \
                >"/tmp/rl-conc-${i}.out" 2>&1
            echo $? > "/tmp/rl-conc-${i}.status"
            te=$(date +%s.%N)
            awk -v s="$ts" -v e="$te" 'BEGIN{printf "%.3f", e-s}' > "/tmp/rl-conc-${i}.time"
        ) &
        pids+=($!)
    done
    wait "${pids[@]}"
    t1=$(date +%s.%N)
    local any_fail=0 job_status
    for i in 1 2 3; do
        job_status=$(cat "/tmp/rl-conc-${i}.status" 2>/dev/null || echo '?')
        echo "parallel job ${i}: exit=${job_status} time=$(cat "/tmp/rl-conc-${i}.time" 2>/dev/null || echo '?')s"
        if [ "$job_status" != "0" ]; then
            any_fail=1
            echo "job ${i} FAILED (exit=${job_status}) — last 20 lines of /tmp/rl-conc-${i}.out:"
            tail -n 20 "/tmp/rl-conc-${i}.out" 2>/dev/null || echo "(no output captured)"
        fi
    done
    echo "3-way parallel total wall time: $(awk -v s="$t0" -v e="$t1" 'BEGIN{printf "%.3f", e-s}')s"

    local ts te solo_status
    ts=$(date +%s.%N)
    timeout -k 15 300 nexus run --project probe --name rl-conc-solo --memory 512 "$TOOLCHAIN_REF" -- bash -c "$rl_hello_cc_body" \
        >/tmp/rl-conc-solo.out 2>&1
    solo_status=$?
    te=$(date +%s.%N)
    echo "solo job (comparison): exit=${solo_status} time=$(awk -v s="$ts" -v e="$te" 'BEGIN{printf "%.3f", e-s}')s"
    if [ "$solo_status" != "0" ]; then
        any_fail=1
        echo "solo job FAILED (exit=${solo_status}) — last 20 lines of /tmp/rl-conc-solo.out:"
        tail -n 20 /tmp/rl-conc-solo.out 2>/dev/null || echo "(no output captured)"
    fi
    return "$any_fail"
}
run_step "concurrency: 3 parallel g++ hello-world compiles vs. 1 solo" -- rl_concurrency_test
rl_marker

# ---------------------------------------------------------------------------
section "summary"
# ---------------------------------------------------------------------------
SUMMARY="PASS: ${PASS_COUNT}  FAIL: ${FAIL_COUNT}  CRITICAL_FAIL: ${CRITICAL_FAIL_COUNT}"
echo "$SUMMARY"
for l in "${CRITICAL_FAILED[@]}"; do echo "  critical failed: ${l}"; done
# Also persist the summary as the container termination message: it survives
# a broken kubelet log stream ("failed to create fsnotify watcher") and is
# readable via .status.containerStatuses[0].state.terminated.message.
{
    echo "$SUMMARY"
    for l in "${CRITICAL_FAILED[@]}"; do echo "critical failed: ${l}"; done
} > /dev/termination-log 2>/dev/null || true
if [ "$CRITICAL_FAIL_COUNT" -gt 0 ]; then
    exit 1
fi
exit 0
