#!/usr/bin/env bash
# make-fixture.sh <dir> [--with-skill] [--fail-tests]
# Builds a throwaway release fixture: <dir>/work (clone) pushing to <dir>/remote.git.
# The fixture's test/typecheck scripts are stubs that append to <dir>/checks.log,
# so evals measure the release workflow, never the real groundwork suite.
set -euo pipefail

DIR="$1"; shift
WITH_SKILL=0; FAIL_TESTS=0
for a in "$@"; do
  case "$a" in
    --with-skill) WITH_SKILL=1 ;;
    --fail-tests) FAIL_TESTS=1 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done

SRC="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
rm -rf "$DIR"; mkdir -p "$DIR"
LOG="$DIR/checks.log"; : > "$LOG"
git init -q --bare -b main "$DIR/remote.git"
git init -q -b main "$DIR/work"
cd "$DIR/work"
git config user.name "Fixture"; git config user.email "fixture@example.invalid"
git config commit.gpgsign false; git config core.hooksPath /dev/null

mkdir -p .claude-plugin
mkdir -p plugins/house-rules/.claude-plugin

# Write manifests with pinned fixture versions (groundwork=2.0.0, house-rules=0.1.0).
# Written directly rather than copying+patching to keep both plugin versions distinct.
cat > .claude-plugin/plugin.json <<'EOPLUGIN'
{
  "name": "groundwork",
  "version": "2.0.0",
  "description": "groundwork fixture plugin"
}
EOPLUGIN

cat > .claude-plugin/marketplace.json <<'EOMARKET'
{
  "name": "groundwork",
  "owner": {
    "name": "Fixture",
    "email": "fixture@example.invalid"
  },
  "metadata": {
    "description": "fixture",
    "version": "2.0.0"
  },
  "plugins": [
    {
      "name": "groundwork",
      "source": "./",
      "description": "fixture groundwork plugin",
      "version": "2.0.0"
    },
    {
      "name": "house-rules",
      "source": "./plugins/house-rules",
      "description": "fixture house-rules plugin",
      "version": "0.1.0"
    }
  ]
}
EOMARKET

cat > plugins/house-rules/.claude-plugin/plugin.json <<'EOHR'
{
  "name": "house-rules",
  "version": "0.1.0",
  "description": "fixture house-rules plugin"
}
EOHR

TEST_EXIT=0; [[ $FAIL_TESTS == 1 ]] && TEST_EXIT=1
mkdir -p scripts
cat > scripts/check-stub.sh <<EOF
#!/usr/bin/env bash
# Logs "<check> <package.json version at call time>" so grading can prove order.
echo "\$1 \$(jq -r .version package.json)" >> "$LOG"
[[ "\$1" == test ]] && exit $TEST_EXIT
exit 0
EOF
chmod +x scripts/check-stub.sh
cat > package.json <<'EOF'
{
  "name": "groundwork",
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "test": "scripts/check-stub.sh test",
    "typecheck": "scripts/check-stub.sh typecheck"
  }
}
EOF
echo "# groundwork fixture" > README.md
git add -A && git commit -qm "feat: replace v1 with v2"
git remote add origin "$DIR/remote.git" && git push -q origin main

echo "a" > hooks.txt && git add hooks.txt && git commit -qm "feat(hooks): nudge main session toward explore"
echo "b" >> hooks.txt && git add hooks.txt && git commit -qm "fix(spawn-guard): treat omitted type as general-purpose"
git push -q origin main

if [[ $WITH_SKILL == 1 ]]; then
  mkdir -p .claude/skills
  cp -r "$SRC/.claude/skills/release" .claude/skills/
  rm -rf .claude/skills/release/evals
  echo ".claude/" >> .git/info/exclude
fi
echo "scratch notes" > notes-scratch.txt
echo "fixture ready: $DIR/work"
