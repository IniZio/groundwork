#!/usr/bin/env bash
# conformance: comments=34 directive=1 doc=0 groups=10
# source: deploy/nexus-probe/probe.sh lines 1-101 @ herdr commit 142dedaa
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
