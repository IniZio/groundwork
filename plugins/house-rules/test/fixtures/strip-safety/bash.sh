#!/usr/bin/env bash
# source: deploy/nexus-probe/probe.sh lines 1-101 @ herdr commit 142dedaa
# strip-safety: removed=12
# probe.sh — verifies nexus (Cloud Hypervisor microVM sandbox) runs inside
# this k8s pod and measures cold-start latency.
# shellcheck disable=SC2086
# shellcheck source=scripts/lib/common.sh
set -uo pipefail

PASS_COUNT=0
FAIL_COUNT=0
# CRITICAL_FAIL_COUNT tracks steps whose failure should flip the exit code.
CRITICAL_FAIL_COUNT=0
CRITICAL_FAILED=()

section() {
    echo
    echo "===== $* ====="
}

# run_step [--critical] <label> -- <command...>
# Times the command, prints PASS/FAIL + elapsed wall time.
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
    # Use awk because bash arithmetic does not support floating-point.
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
    # best-effort; ignore errors — sandbox may already be gone or never created
    nexus stop "$1" >/dev/null 2>&1 || true
    nexus rm   "$1" >/dev/null 2>&1 || true
}

# Strip the leading path prefix from an image reference so the tag is visible.
strip_prefix() {
    # Parameter expansion: ${var#prefix} removes the shortest prefix match.
    # The '#' here is shell syntax, not a comment character.
    echo "${1#*/}"
}

# Demonstrate that '#' inside a double-quoted string is not a comment.
describe() {
    local raw="$1"
    # Build a human-readable note like "field # value".
    local note
    note=$(echo "$raw" | awk '{printf "%s # %s", $1, $2}')
    echo "$note"
}

section "ensure pod-env directories exist"
for d in "${TMPDIR:-}" "${XDG_RUNTIME_DIR:-}" "${HOME:-}/.local/state/nexus"; do
    [ -n "$d" ] || continue
    # mkdir -p is idempotent; failure here is fatal so print a warning.
    if mkdir -p "$d"; then
        echo "ensured: $d"
    else
        echo "WARNING: mkdir -p failed for: $d"
    fi
done

section "capability probe"
id
eff_hex=$(grep '^CapEff:' /proc/self/status | awk '{print $2}')
# CAP_NET_ADMIN = bit 12 (0x1000); test presence with bitwise AND.
eff_dec=$((16#${eff_hex}))
if (( (eff_dec & 0x1000) != 0 )); then
    echo "NET_ADMIN: present"
else
    echo "NET_ADMIN: absent"
fi
