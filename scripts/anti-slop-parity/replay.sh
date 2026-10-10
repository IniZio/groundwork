#!/usr/bin/env bash
# replay.sh [--port-only] [--update-cache] [--dry-run] -- compare house-rules port vs upstream anti-slop@c44ef22.
# --port-only: use H/cache/oxlint.json (asserts cache meta), never touches nexus.
# --update-cache: save the fresh oxlint.json + meta.json into H/cache. --dry-run: print every
# step/command (local ones too) and execute nothing. Env: PARITY_WORK, PARITY_KEEP=1,
# PARITY_UPSTREAM_MIRROR. Exit code = diff.cjs exit code.
set -euo pipefail

H=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$H" rev-parse --show-toplevel)
SHA=c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b
REAL_SAMPLE=05bf55ad79c79e3efe89b215c77b9304da6bbcba
PORT_ONLY=0; UPDATE=0; DRY=0
for a in "$@"; do
  case $a in
    --port-only) PORT_ONLY=1;; --update-cache) UPDATE=1;; --dry-run) DRY=1;;
    *) echo "unknown arg $a" >&2; exit 2;;
  esac
done
[ "$PORT_ONLY" = 1 ] && [ "$UPDATE" = 1 ] && { echo "--port-only and --update-cache conflict" >&2; exit 2; }

run() {
  if [ "$DRY" = 1 ]; then printf '+'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}

MADE=0
if [ -n "${PARITY_WORK:-}" ]; then
  W=$PARITY_WORK
elif [ "$DRY" = 1 ]; then
  W=${TMPDIR:-/tmp}/anti-slop-parity.DRYRUN
else
  W=$(mktemp -d "${TMPDIR:-/tmp}/anti-slop-parity.XXXXXX"); MADE=1
fi
cleanup() {
  local rc=$?
  trap - EXIT
  [ "$MADE" = 1 ] && [ "${PARITY_KEEP:-0}" != 1 ] && rm -rf "$W"
  exit "$rc"
}
trap cleanup EXIT

run mkdir -p "$W"
run git clone --no-checkout "${PARITY_UPSTREAM_MIRROR:-https://github.com/dmmulroy/anti-slop}" "$W/upstream"
run git -C "$W/upstream" -c advice.detachedHead=false checkout --detach "$SHA"
if [ "$DRY" = 1 ]; then echo "+ assert [ \$(git -C $W/upstream rev-parse HEAD) = $SHA ]"
else
  [ "$(git -C "$W/upstream" rev-parse HEAD)" = "$SHA" ] || { echo "upstream HEAD != $SHA" >&2; exit 1; }
fi
run node "$H/extract-upstream-tests.cjs" "$W/upstream" "$W/upstream-tests.json"
run node "$H/build-corpus.cjs" "$W"
if [ "$DRY" = 1 ]; then echo "+ (cd $REPO && bun $H/run-port.ts $W)"; else (cd "$REPO" && bun "$H/run-port.ts" "$W"); fi

if [ "$PORT_ONLY" = 1 ]; then
  OX=$H/cache/oxlint.json
  if [ "$DRY" = 1 ]; then
    echo "+ assert $H/cache/meta.json corpusSha256 == $W/corpus.sha256 and upstreamSha == $SHA"
  else
    got=$(node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(m.corpusSha256+" "+m.upstreamSha)' "$H/cache/meta.json")
    cur=$(tr -d ' \n' < "$W/corpus.sha256")
    [ "${got%% *}" = "$cur" ] || { echo "cache stale: corpus changed; run replay.sh --update-cache" >&2; exit 1; }
    [ "${got##* }" = "$SHA" ] || { echo "cache stale: upstreamSha mismatch; run replay.sh --update-cache" >&2; exit 1; }
  fi
else
  if [ "$DRY" = 1 ]; then
    echo "+ PARITY_DRY_RUN=1 $H/vm-run.sh $W   # plan follows"
    PARITY_DRY_RUN=1 "$H/vm-run.sh" "$W"
  else
    "$H/vm-run.sh" "$W"
  fi
  OX=$W/out/oxlint.json
  if [ "$UPDATE" = 1 ]; then
    run mkdir -p "$H/cache"
    run cp "$OX" "$H/cache/oxlint.json"
    if [ "$DRY" = 1 ]; then echo "+ write $H/cache/meta.json {upstreamSha,realSampleCommit,corpusSha256,oxlintVersion,generatedAt}"
    else
      node -e '
        const fs=require("fs"),[,sha,real,csf,log,out]=process.argv;
        const v=(fs.readFileSync(log,"utf8").match(/^OXLINT_VERSION=(.*)$/m)||[])[1];
        if(!v){console.error("oxlint version not found in vm log");process.exit(1)}
        fs.writeFileSync(out,JSON.stringify({upstreamSha:sha,realSampleCommit:real,corpusSha256:fs.readFileSync(csf,"utf8").trim().split(/\s+/)[0],oxlintVersion:v.trim(),generatedAt:new Date().toISOString()},null,2)+"\n")
      ' "$SHA" "$REAL_SAMPLE" "$W/corpus.sha256" "$W/out/vm-run.log" "$H/cache/meta.json"
    fi
  fi
fi

rc=0
if [ "$DRY" = 1 ]; then echo "+ node $H/diff.cjs $W $OX"; else node "$H/diff.cjs" "$W" "$OX" || rc=$?; fi
exit "$rc"
