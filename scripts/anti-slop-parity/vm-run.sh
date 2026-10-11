#!/usr/bin/env bash
# vm-run.sh W -- run upstream anti-slop's oxlint over W/corpus inside a nexus microVM.
# Upstream code never runs on the host. Guest: network only for `pnpm install`; lint runs
# in an empty netns as uid 65534 with zero capabilities, after NET/CapEff/uid probes (exit 97 on fail).
# Writes W/out/{oxlint.json,oxlint.stderr,positive-control.txt,probe.log,vm-run.log}.
# PARITY_DRY_RUN=1 prints every command (host prep included) and executes nothing.
# Env: PARITY_NODE_TARBALL, XDG_CACHE_HOME.
set -euo pipefail

W=${1:?usage: vm-run.sh W}
H=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DRY=${PARITY_DRY_RUN:-0}
SHA=c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b
NODE_V=v24.21.0
NODE_TGZ_NAME=node-$NODE_V-linux-x64.tar.gz
PNPM_V=10.33.0
CACHE=${XDG_CACHE_HOME:-$HOME/.cache}/anti-slop-parity
STAGE=$W/stage
OUT=$W/out
NAME=anti-slop-parity/run-$$-$(date +%s)
SB=""

# positive control: first upstream no-reflect-apply invalid case, from the corpus manifest
if [ -f "$W/manifest.json" ]; then
  CTL=corpus/$(timeout 30 node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).find(e=>e.src==="upstream-test"&&e.check==="no-reflect-apply"&&e.kind==="invalid");if(m)process.stdout.write(m.file)' "$W/manifest.json")
  [ "$CTL" != corpus/ ] || { echo "no upstream-test no-reflect-apply invalid case in $W/manifest.json" >&2; exit 1; }
elif [ "$DRY" = 1 ]; then
  CTL=corpus/ut/no-reflect-apply/invalid-000/case.ts
else
  echo "missing $W/manifest.json" >&2; exit 1
fi
echo "positive control: $CTL" >&2

run() {
  if [ "$DRY" = 1 ]; then
    printf '+'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [ -n "$SB" ]; then
    echo "teardown: nexus rm $SB" >&2
    run timeout 120 nexus rm "$SB" || echo "WARN: nexus rm $SB failed" >&2
  fi
  exit "$rc"
}

run mkdir -p "$STAGE" "$OUT" "$CACHE"

# --- host prep (no upstream code is executed) ---
run git -C "$W/upstream" archive --format=tar.gz -o "$STAGE/upstream.tgz" "$SHA"
run tar -C "$W" -czf "$STAGE/corpus.tgz" corpus
run cp "$H/oxlintrc.json" "$STAGE/oxlintrc.json"

NODE_TGZ=${PARITY_NODE_TARBALL:-$CACHE/$NODE_TGZ_NAME}
if [ -z "${PARITY_NODE_TARBALL:-}" ] && { [ "$DRY" = 1 ] || [ ! -f "$NODE_TGZ" ]; }; then
  run timeout 300 curl -fsSL -o "$NODE_TGZ" "https://nodejs.org/dist/$NODE_V/$NODE_TGZ_NAME"
  run timeout 60 curl -fsSL -o "$CACHE/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt"
  if [ "$DRY" = 1 ]; then
    echo "+ verify sha256 of $NODE_TGZ against $CACHE/SHASUMS256.txt"
  else
    want=$(awk -v f="$NODE_TGZ_NAME" '$2==f{print $1}' "$CACHE/SHASUMS256.txt")
    got=$(sha256sum "$NODE_TGZ" | awk '{print $1}')
    if [ -z "$want" ] || [ "$want" != "$got" ]; then
      rm -f "$NODE_TGZ"; echo "node tarball sha256 mismatch (want=$want got=$got)" >&2; exit 1
    fi
  fi
fi
PNPM_TGZ=$CACHE/pnpm-$PNPM_V.tgz
if [ "$DRY" = 1 ] || [ ! -f "$PNPM_TGZ" ]; then
  run timeout 300 npm pack "pnpm@$PNPM_V" --ignore-scripts --pack-destination "$CACHE"
fi

put() {
  if [ "$DRY" = 1 ]; then echo "+ write $STAGE/$1"; cat > /dev/null; else cat > "$STAGE/$1"; fi
}
# --- guest scripts (copied in; kept as files to avoid quoting traps) ---
put guest-setup.sh <<'GUEST'
#!/bin/sh
set -eu
mkdir -p /work && mount -t tmpfs -o size=3G tmpfs /work
cd /work
tar -xzf /root/node.tar.gz && mv node-v*-linux-x64 node
mkdir upstream && tar -C upstream -xzf /root/upstream.tgz
tar -xzf /root/corpus.tgz && chmod -R a-w corpus
mkdir -p home out cfg && chmod 777 out
cp /root/oxlintrc.json cfg/.oxlintrc.json
export PATH=/work/node/bin:$PATH HOME=/work/home
npm install -g --offline --ignore-scripts --prefix /work/pnpm /root/pnpm.tgz
cd /work/upstream
# the ONLY networked step
/work/pnpm/bin/pnpm install --frozen-lockfile --ignore-scripts
GUEST
put guest-lint.sh <<'GUEST'
#!/bin/sh
set -u
cd /work
exec unshare --net -- setpriv --reuid=65534 --regid=65534 --clear-groups --inh-caps=-all --bounding-set=-all -- sh -c '
  export PATH=/work/node/bin:$PATH HOME=/tmp
  OX=/work/upstream/node_modules/.bin/oxlint
  net=$(timeout 30 node -e "require(\"https\").get(\"https://registry.npmjs.org/\",r=>console.log(\"NET OPEN\",r.statusCode)).on(\"error\",e=>console.log(\"NET BLOCKED\",e.code))" 2>&1)
  echo "$net" | tee /work/out/probe.log
  grep -E "CapEff|CapBnd" /proc/self/status | tee -a /work/out/probe.log
  echo "UID=$(id -u)" | tee -a /work/out/probe.log
  cap=$(awk "/^CapEff/{print \$2}" /proc/self/status)
  case "$net" in
    "NET BLOCKED "*) ;;
    *) echo "PROBE FAIL: network not blocked"; exit 97;;
  esac
  [ "$(printf "%s\n" "$net" | wc -l)" = 1 ] || { echo "PROBE FAIL: unexpected probe output"; exit 97; }
  [ "$cap" = 0000000000000000 ] || { echo "PROBE FAIL: CapEff=$cap"; exit 97; }
  [ "$(id -u)" = 65534 ] || { echo "PROBE FAIL: uid=$(id -u)"; exit 97; }
  echo "OXLINT_VERSION=$($OX --version)"
  timeout 600 $OX -c /work/cfg/.oxlintrc.json --format json corpus > /work/out/oxlint.json 2> /work/out/oxlint.stderr
  echo "oxlint exit=$?"
  timeout 60 $OX -c /work/cfg/.oxlintrc.json "$1" > /work/out/positive-control.txt 2>&1
  echo "positive-control exit=$?"
' sh "$1"
GUEST

# --- sandbox ---
echo "+ nexus create $NAME ..." >&2
if [ "$DRY" = 1 ]; then
  SB=sb-DRYRUN
  printf '+ SB=$(timeout 600 nexus create %q --image ghcr.io/inizio/nexus-base:latest --no-user-mounts --no-sandbox-tools --no-share-settings --memory 4096 --vcpus 4 | sed -n "s/.*(\\(sb-[A-Z0-9]*\\)).*/\\1/p")\n' "$NAME"
else
  timeout 600 nexus create "$NAME" --image ghcr.io/inizio/nexus-base:latest \
    --no-user-mounts --no-sandbox-tools --no-share-settings --memory 4096 --vcpus 4 \
    > "$OUT/nexus-create.log" 2>&1 || { cat "$OUT/nexus-create.log" >&2; echo "nexus create failed" >&2; exit 1; }
  SB=$(sed -n 's/.*(\(sb-[A-Z0-9]*\)).*/\1/p' "$OUT/nexus-create.log" | head -n1)
  if [ -z "$SB" ]; then
    echo "cannot parse sandbox id; best-effort rm by name" >&2
    timeout 120 nexus rm "$NAME" >&2 || true
    exit 1
  fi
fi
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
[ "$DRY" = 1 ] && echo '+ trap cleanup EXIT; trap INT TERM -> exit -> cleanup -> nexus rm $SB'

# --- stage in ---
run timeout 300 nexus cp "$SB" "$NODE_TGZ" guest:/root/node.tar.gz
run timeout 300 nexus cp "$SB" "$PNPM_TGZ" guest:/root/pnpm.tgz
for f in upstream.tgz corpus.tgz oxlintrc.json guest-setup.sh guest-lint.sh; do
  run timeout 300 nexus cp "$SB" "$STAGE/$f" "guest:/root/$f"
done
run timeout 900 nexus exec "$SB" -- sh /root/guest-setup.sh

# --- lint (isolated) ---
LOG=$OUT/vm-run.log
rc=0
if [ "$DRY" = 1 ]; then
  echo "+ timeout 900 nexus exec $SB -- sh /root/guest-lint.sh $CTL 2>&1 | tee $LOG   # exit 97 = probe failed"
else
  timeout 900 nexus exec "$SB" -- sh /root/guest-lint.sh "$CTL" > "$LOG" 2>&1 || rc=$?
  cat "$LOG"
  [ "$rc" = 97 ] && { echo "isolation probe failed (exit 97); no oxlint.json handed back" >&2; exit 97; }
  [ "$rc" = 0 ] || { echo "guest lint step failed rc=$rc" >&2; exit "$rc"; }
  # host-side re-check of the guest log
  grep -q 'NET BLOCKED' "$LOG" && ! grep -q 'NET OPEN' "$LOG" \
    && grep -q "$(printf 'CapEff:\t0000000000000000')" "$LOG" \
    && grep -q '^UID=65534$' "$LOG" \
    || { echo "guest log lacks NET BLOCKED / CapEff 0 / UID=65534; refusing results" >&2; exit 98; }
fi
for f in oxlint.json oxlint.stderr positive-control.txt probe.log; do
  run timeout 60 nexus cp "$SB" "guest:/work/out/$f" "$OUT/$f"
done
[ "$DRY" = 1 ] || [ -s "$OUT/oxlint.json" ] || { echo "empty oxlint.json" >&2; exit 99; }
[ "$DRY" = 1 ] || grep -q 'anti-slop(no-reflect-apply)' "$OUT/positive-control.txt" \
  || { echo "positive control produced no anti-slop(no-reflect-apply) finding ($CTL)" >&2; exit 100; }
echo "vm-run ok" >&2
