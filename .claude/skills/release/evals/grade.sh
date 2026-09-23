#!/usr/bin/env bash
# grade.sh <fixture-dir> <expected-version> [--expect-no-release]
# Checks fixture state after a run; prints grading.json expectations to stdout.
set -uo pipefail

DIR="$1"; V="$2"; NO_RELEASE="${3:-}"
R="$DIR/remote.git"; LOG="$DIR/checks.log"
out=()
add() { out+=("$(jq -nc --arg t "$1" --argjson p "$2" --arg e "$3" '{text:$t,passed:$p,evidence:$e}')"); }

head_sha=$(git -C "$R" rev-parse main 2>/dev/null)
field() { git -C "$R" show "main:$1" 2>/dev/null | jq -r "$2"; }

if [[ "$NO_RELEASE" == "--expect-no-release" ]]; then
  pv=$(field package.json .version)
  tags=$(git -C "$R" tag | tr '\n' ' ')
  [[ "$pv" == "2.0.0" && -z "$tags" ]] && p=true || p=false
  add "Failing checks block the release (remote still 2.0.0, no tag)" $p "remote version=$pv tags='$tags'"
  bumped=$(git -C "$DIR/work" diff --name-only HEAD -- package.json .claude-plugin | tr '\n' ' ')
  [[ -z "$bumped" ]] && p=true || p=false
  add "Version files not modified locally after failed checks" $p "dirty version files='$bumped'"
  printf '%s\n' "${out[@]}" | jq -s '{expectations: .}'
  exit 0
fi

vals="$(field package.json .version) $(field .claude-plugin/plugin.json .version) $(field .claude-plugin/marketplace.json .metadata.version) $(field .claude-plugin/marketplace.json '.plugins[0].version')"
[[ "$vals" == "$V $V $V $V" ]] && p=true || p=false
add "All 4 version fields on remote main equal $V" $p "fields: $vals"

tag_sha=$(git -C "$R" rev-parse "v$V^{commit}" 2>/dev/null || echo missing)
[[ "$tag_sha" == "$head_sha" ]] && p=true || p=false
add "Tag v$V pushed and points at remote main" $p "tag=$tag_sha main=$head_sha"

files=$(git -C "$R" diff --name-only "$head_sha^" "$head_sha" | sort | tr '\n' ' ')
want=".claude-plugin/marketplace.json .claude-plugin/plugin.json package.json "
[[ "$files" == "$want" ]] && p=true || p=false
add "Release commit touches exactly the 3 version files" $p "files: $files"

msg=$(git -C "$R" log -1 --format=%s main)
[[ "$msg" == "chore(release): bump version to $V" ]] && p=true || p=false
add "Commit message is 'chore(release): bump version to $V'" $p "subject: $msg"

t=$(awk '/^test /{print $2; exit}' "$LOG"); tc=$(awk '/^typecheck /{print $2; exit}' "$LOG")
[[ "$t" == "2.0.0" && "$tc" == "2.0.0" ]] && p=true || p=false
add "test and typecheck ran before the version bump" $p "version seen by first test=${t:-none} typecheck=${tc:-none}"

leaked=$(git -C "$R" ls-tree -r --name-only main | grep -c '^notes-scratch.txt$')
[[ "$leaked" == 0 ]] && p=true || p=false
add "Untracked notes-scratch.txt not committed" $p "found=$leaked"

printf '%s\n' "${out[@]}" | jq -s '{expectations: .}'
