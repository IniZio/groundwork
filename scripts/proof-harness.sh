#!/usr/bin/env bash
# proof-harness.sh — install groundwork via the plugin system and verify the init event.
#
# Usage: proof-harness.sh --repo <path> --prompt <text> [OPTIONS]
#   --repo       <path>  throwaway git repo used as cwd for claude
#   --prompt     <text>  prompt passed to claude -p
#   --agent      <name>  optional --agent flag forwarded to claude
#   --model      <name>  model (default: sonnet)
#   --out        <dir>   output directory (default: temp dir, printed to stderr)
#   --settings   <file>  optional --settings file forwarded to claude
#   --plugin     <path>  local marketplace dir (default: <repo-root>/.claude-plugin)
#   --check-log  <file>  skip install+run; only run INIT CHECK on an existing stdout.log
#
# Auth: copies ~/.claude/.credentials.json and ~/.claude/.claude.json into the fresh HOME.
# No other ~/.claude content is copied; plugins, settings, and MCP config stay behind.
#
# Exit codes:  0=all checks pass  1=init check failed  2=safety abort  3=usage error

set -uo pipefail

die() { echo "ERROR: $*" >&2; exit 3; }

# Resolve SCRIPT_DIR early so EXPECTED_VERSION is available inside run_init_check,
# which is called before argument parsing when --check-log is used.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
_PKG_JSON="$_REPO_ROOT/package.json"
if [[ ! -f "$_PKG_JSON" ]]; then
  die "package.json not found at $_PKG_JSON"
fi
EXPECTED_VERSION="$(jq -r '.version // ""' "$_PKG_JSON" 2>/dev/null)" || die "jq failed reading $_PKG_JSON"
if [[ -z "$EXPECTED_VERSION" ]]; then
  die "package.json at $_PKG_JSON has no .version field"
fi

PASS_COUNT=0
FAIL_COUNT=0
FAIL_MESSAGES=()

_pass() { PASS_COUNT=$((PASS_COUNT + 1)); echo "  PASS  $*"; }
_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); FAIL_MESSAGES+=("$*"); echo "  FAIL  $*"; }

# --- run_init_check <stdout-log> ------------------------------------------------
run_init_check() {
  local log="$1"
  echo ""
  echo "=== INIT CHECK ==="

  if [[ ! -f "$log" ]]; then
    _fail "log file not found: $log"
    echo "INIT CHECK — FAIL"; return 1
  fi

  local init_line
  init_line=$(grep -m1 '"subtype":"init"' "$log" 2>/dev/null || true)

  if [[ -z "$init_line" ]]; then
    _fail "system/init event not found in log"
    echo "INIT CHECK — FAIL"; return 1
  fi

  local gw_version
  gw_version=$(echo "$init_line" | jq -r '
    (.plugins // []) | map(select(.name=="groundwork")) | first | .version // ""
  ' 2>/dev/null || true)
  if [[ "$gw_version" == "$EXPECTED_VERSION" ]]; then
    _pass "groundwork plugin version ${EXPECTED_VERSION} present"
  else
    _fail "groundwork ${EXPECTED_VERSION} not found (got: '${gw_version}')"
  fi

  local mps_count
  mps_count=$(echo "$init_line" | jq -r '
    (.plugins // []) | map(select(.name=="mattpocock-skills")) | length
  ' 2>/dev/null || echo "0")
  if [[ "$mps_count" -ge 1 ]]; then
    _pass "mattpocock-skills present"
  else
    _fail "mattpocock-skills not found"
  fi

  local gw_other
  gw_other=$(echo "$init_line" | jq -r --arg v "$EXPECTED_VERSION" '
    (.plugins // []) | map(select(.name=="groundwork" and .version!=$v)) | map(.version) | join(", ")
  ' 2>/dev/null || true)
  if [[ -z "$gw_other" ]]; then
    _pass "no groundwork version other than ${EXPECTED_VERSION}"
  else
    _fail "unexpected groundwork versions present: $gw_other"
  fi

  local required_agents=("groundwork:advisor" "groundwork:implementer" "groundwork:orchestrator" "groundwork:qa")
  for agent_name in "${required_agents[@]}"; do
    local found
    found=$(echo "$init_line" | jq -r --arg n "$agent_name" '
      (.agents // []) | map(select(. == $n or (type == "object" and .name == $n))) | length
    ' 2>/dev/null || echo "0")
    if [[ "$found" -ge 1 ]]; then
      _pass "agent $agent_name present"
    else
      _fail "agent $agent_name not found"
    fi
  done

  echo ""
  if [[ "$FAIL_COUNT" -eq 0 ]]; then
    echo "INIT CHECK — PASS ($PASS_COUNT/$PASS_COUNT)"
  else
    echo "INIT CHECK — FAIL ($FAIL_COUNT failed, $PASS_COUNT passed)"
    for msg in "${FAIL_MESSAGES[@]}"; do echo "  -> $msg"; done
  fi
  [[ "$FAIL_COUNT" -eq 0 ]]
}

# --- check_session_start <stdout-log> -------------------------------------------
check_session_start() {
  local log="$1"
  echo ""
  echo "=== SESSION-START MARKER ==="
  if grep -qE '# groundwork v[0-9]+(\.[0-9]+)*' "$log" 2>/dev/null; then
    echo "  PRESENT  '# groundwork v<version>' SessionStart header found in stdout log"
  else
    echo "  ABSENT   '# groundwork v<version>' SessionStart header not found (SessionStart hook may not have fired)"
  fi
}

# --- parse arguments ------------------------------------------------------------
REPO="" PROMPT="" AGENT="" MODEL="sonnet" OUT="" SETTINGS="" PLUGIN="" CHECK_LOG="" KEEP_HOME=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)        REPO="$2";      shift 2 ;;
    --prompt)      PROMPT="$2";    shift 2 ;;
    --agent)       AGENT="$2";     shift 2 ;;
    --model)       MODEL="$2";     shift 2 ;;
    --out)         OUT="$2";       shift 2 ;;
    --settings)    SETTINGS="$2";  shift 2 ;;
    --plugin)      PLUGIN="$2";    shift 2 ;;
    --check-log)   CHECK_LOG="$2"; shift 2 ;;
    --keep-home)   KEEP_HOME=1;    shift ;;
    --help|-h)     grep '^#' "$0" | head -20 | sed 's/^# \?//'; exit 0 ;;
    *)             die "unknown argument: $1" ;;
  esac
done

if [[ -n "$CHECK_LOG" ]]; then
  run_init_check "$CHECK_LOG"
  INIT_EXIT=$?
  [[ "$INIT_EXIT" -eq 0 ]] && check_session_start "$CHECK_LOG"
  exit $INIT_EXIT
fi

[[ -z "$REPO" ]]   && die "--repo is required"
[[ -z "$PROMPT" ]] && die "--prompt is required"

REPO="$(realpath "$REPO")"
[[ -d "$REPO" ]] || die "--repo path does not exist: $REPO"

if [[ -z "$PLUGIN" ]]; then
  PLUGIN="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
PLUGIN="$(realpath "$PLUGIN")"
[[ -f "$PLUGIN/.claude-plugin/marketplace.json" ]] || die "--plugin must be a repo root containing .claude-plugin/marketplace.json (got: $PLUGIN)"

if [[ -z "$OUT" ]]; then
  OUT="$(mktemp -d)"
  echo "out: $OUT" >&2
fi
mkdir -p "$OUT"

# --- fresh HOME -----------------------------------------------------------------
REAL_HOME="$HOME"
TEMP_HOME="$(mktemp -d)"

if [[ "$TEMP_HOME" == "$REAL_HOME" || "$TEMP_HOME" == "${REAL_HOME}/"* ]]; then
  echo "SAFETY ABORT: temp HOME ($TEMP_HOME) overlaps real HOME ($REAL_HOME)" >&2
  exit 2
fi

if [[ "$KEEP_HOME" -eq 0 ]]; then
  trap 'rm -rf "$TEMP_HOME"' EXIT
fi

export HOME="$TEMP_HOME"
mkdir -p "$HOME/.claude"

COPIED=()
for f in ".credentials.json" ".claude.json"; do
  if [[ -f "$REAL_HOME/.claude/$f" ]]; then
    cp "$REAL_HOME/.claude/$f" "$HOME/.claude/$f"
    COPIED+=("$f")
  fi
done
[[ ${#COPIED[@]} -eq 0 ]] && echo "WARNING: no auth files found — claude may prompt for login" >&2

echo "auth: ${COPIED[*]:-none} | HOME: $TEMP_HOME" >&2

# --- install --------------------------------------------------------------------
claude plugin marketplace add anthropics/claude-plugins-official >&2
claude plugin marketplace add "$PLUGIN" >&2
claude plugin install groundwork >&2
claude plugin list 2>&1 | tee "$OUT/plugin-list.txt" >&2

# --- run claude -----------------------------------------------------------------
CLAUDE_ARGS=(-p "$PROMPT" --model "$MODEL" --output-format stream-json --verbose --permission-mode acceptEdits)
[[ -n "$AGENT" ]]    && CLAUDE_ARGS+=(--agent "$AGENT")
[[ -n "$SETTINGS" ]] && CLAUDE_ARGS+=(--settings "$SETTINGS")

(cd "$REPO" && claude "${CLAUDE_ARGS[@]}" 2>&1) | tee "$OUT/stdout.log"

# --- checks ---------------------------------------------------------------------
run_init_check "$OUT/stdout.log"
INIT_EXIT=$?
[[ "$INIT_EXIT" -eq 0 ]] && check_session_start "$OUT/stdout.log"

exit $INIT_EXIT
