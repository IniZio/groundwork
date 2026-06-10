#!/usr/bin/env bash
# E2E session handoff test — invokes the real claude CLI in headless mode to
# validate the /groundwork:handoff flow end-to-end using a planted-secret design.
#
# WARNING: This test makes REAL model calls. It costs real tokens and takes
# several minutes to run. It is intended for manual runs or CI-gated jobs,
# NOT the default unit test suite.
#
# Flow:
#   1. Session A is told a secret deploy token (ZEBRA-9417) and instructed to
#      write a handoff document (file-only mode: no successor spawn) WITHOUT
#      leaking the secret into the handoff file.
#   2. Assertions: handoff file exists, references the session id and transcript
#      path, does NOT contain the secret; transcript A DOES contain the secret.
#   3. Session B is seeded with the handoff document and asked to retrieve the
#      secret from the previous session's transcript JSONL — proving a successor
#      can genuinely reach back into the predecessor's history.
#   4. Assert transcript B exists. Cleanup removes only the artifacts this test
#      created (handoff file + both transcripts).
#
# Requires: claude CLI in PATH (or $CLAUDE_BIN), authenticated; uuidgen.
#
# Usage:
#   ./tests/handoff-e2e.sh                       # run the full flow
#   ./tests/handoff-e2e.sh --verbose             # show full claude output
#   TIMEOUT=600 ./tests/handoff-e2e.sh           # override per-call timeout (s)
#   CLAUDE_BIN=/path/to/claude ./tests/handoff-e2e.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
TIMEOUT="${TIMEOUT:-420}"   # generous: real model calls, multi-step agentic work
VERBOSE="${VERBOSE:-false}"
[[ "${1:-}" == "--verbose" ]] && VERBOSE=true

SECRET="ZEBRA-9417"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass=0
fail=0
skip=0

# ── Assertion helpers (routing-e2e.sh conventions) ───────────────────────────

check() {
  local name="$1"
  local condition="$2"   # "pass" or "fail" verdict computed by caller
  local detail="${3:-}"

  printf "%-52s " "$name"
  if [[ "$condition" == "pass" ]]; then
    echo -e "${GREEN}PASS${NC}"
    pass=$((pass + 1))
  else
    echo -e "${RED}FAIL${NC}${detail:+ — $detail}"
    fail=$((fail + 1))
  fi
}

assert_file_exists() {
  local name="$1" file="$2"
  if [[ -f "$file" ]]; then check "$name" pass; else check "$name" fail "missing: $file"; fi
}

assert_contains() {
  local name="$1" file="$2" needle="$3"
  if grep -qF "$needle" "$file" 2>/dev/null; then
    check "$name" pass
  else
    check "$name" fail "'$needle' not found in $file"
  fi
}

assert_not_contains() {
  local name="$1" file="$2" needle="$3"
  if grep -qF "$needle" "$file" 2>/dev/null; then
    check "$name" fail "'$needle' LEAKED into $file"
  else
    check "$name" pass
  fi
}

# ── Transcript dir computation ────────────────────────────────────────────────
# Claude Code stores transcripts in ~/.claude/projects/<munged cwd>/ where the
# munge replaces every "/" and "." in the absolute cwd path with "-".

munge_project_path() {
  local p="$1"
  echo "${p//[\/.]/-}"
}

# ── Preconditions ─────────────────────────────────────────────────────────────

if ! command -v "$CLAUDE_BIN" &>/dev/null; then
  echo -e "${YELLOW}SKIP: claude CLI not found ($CLAUDE_BIN)${NC}"
  echo "Install/authenticate the claude CLI, or set CLAUDE_BIN, to run this e2e test."
  exit 0
fi

if ! command -v uuidgen &>/dev/null; then
  echo -e "${YELLOW}SKIP: uuidgen not found in PATH${NC}"
  exit 0
fi

# ── Setup ─────────────────────────────────────────────────────────────────────

SESSION_A="$(uuidgen)"
SESSION_B="$(uuidgen)"

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/handoff-e2e.XXXXXX")"
ORIG_CWD="$(pwd)"

PROJECT_DIR="$HOME/.claude/projects/$(munge_project_path "$WORK_DIR")"
TRANSCRIPT_A="$PROJECT_DIR/$SESSION_A.jsonl"
TRANSCRIPT_B="$PROJECT_DIR/$SESSION_B.jsonl"
HANDOFF_FILE="$WORK_DIR/.claude/handoffs/$SESSION_A.md"

cleanup() {
  cd "$ORIG_CWD" || true
  rm -f "$HANDOFF_FILE" "$TRANSCRIPT_A" "$TRANSCRIPT_B"
  rmdir "$WORK_DIR/.claude/handoffs" "$WORK_DIR/.claude" 2>/dev/null || true
  rm -rf "$WORK_DIR"
  # Remove transcript dir only if this test created it and it is now empty
  rmdir "$PROJECT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$WORK_DIR/.claude/handoffs"
cd "$WORK_DIR"

echo ""
echo -e "${CYAN}Groundwork E2E Handoff Test${NC}"
echo "Plugin dir:     $PLUGIN_DIR"
echo "Work dir:       $WORK_DIR"
echo "Session A:      $SESSION_A"
echo "Session B:      $SESSION_B"
echo "Transcript dir: $PROJECT_DIR"
echo "Timeout:        ${TIMEOUT}s per claude call"
echo ""
printf "%-52s %s\n" "Test" "Result"
printf "%-52s %s\n" "$(printf '%0.s-' {1..52})" "------"

# ── Session A: plant secret + produce handoff (file only, no spawn) ──────────

PROMPT_A="The deploy token is ${SECRET}. Acknowledge it but do not write it to any file.

Now perform a session handoff in \"file only\" mode (write the handoff document, do NOT spawn a successor session). Follow these steps exactly:
1. Your session id is ${SESSION_A} and your transcript path is ${TRANSCRIPT_A}.
2. Write a handoff document to .claude/handoffs/${SESSION_A}.md containing:
   - Goal: what this session was about
   - State: what has been done so far
   - Next steps: what a successor session should do
   - The literal session_id: ${SESSION_A}
   - The literal transcript_path: ${TRANSCRIPT_A}
3. Do NOT include the deploy token or any secret value in the handoff file — secrets must stay only in the conversation transcript.
4. Confirm by replying HANDOFF-WRITTEN when done."

session_a_exit=0
output_a=$(timeout "$TIMEOUT" "$CLAUDE_BIN" -p \
  --session-id "$SESSION_A" \
  --dangerously-skip-permissions \
  "$PROMPT_A" 2>&1) || session_a_exit=$?

if [[ "$VERBOSE" == "true" ]]; then
  echo ""
  echo "── Session A output ──"
  echo "$output_a"
  echo ""
fi

if [[ $session_a_exit -eq 124 ]]; then
  echo -e "${YELLOW}SKIP: session A timed out after ${TIMEOUT}s${NC}"
  skip=$((skip + 1))
  exit 0
fi

if [[ $session_a_exit -ne 0 ]]; then
  check "session A: claude exited cleanly" fail "exit $session_a_exit: $(echo "$output_a" | tail -1)"
else
  check "session A: claude exited cleanly" pass
fi

# ── Assertions on the handoff artifact ────────────────────────────────────────

assert_file_exists  "handoff: file exists"                  "$HANDOFF_FILE"
assert_contains     "handoff: contains session A id"        "$HANDOFF_FILE" "$SESSION_A"
if grep -qF "$TRANSCRIPT_A" "$HANDOFF_FILE" 2>/dev/null || grep -qF "$PROJECT_DIR" "$HANDOFF_FILE" 2>/dev/null; then
  check "handoff: contains transcript path" pass
else
  check "handoff: contains transcript path" fail "neither $TRANSCRIPT_A nor $PROJECT_DIR found"
fi
assert_not_contains "handoff: secret NOT leaked"            "$HANDOFF_FILE" "$SECRET"
assert_file_exists  "transcript A: exists"                  "$TRANSCRIPT_A"
assert_contains     "transcript A: contains secret"         "$TRANSCRIPT_A" "$SECRET"

# Bail before spending tokens on session B if the handoff artifact is broken
if [[ $fail -gt 0 ]]; then
  echo ""
  echo -e "${RED}Handoff artifact assertions failed — skipping session B${NC}"
  echo "Results: ${pass} passed, ${fail} failed, ${skip} skipped"
  exit 1
fi

# ── Session B: successor retrieves the secret from the old transcript ────────

PROMPT_B="$(cat "$HANDOFF_FILE")

QUESTION: What was the deploy token mentioned in the previous session? It is not in this handoff — retrieve it from the previous session's transcript JSONL referenced above, then output it."

session_b_exit=0
output_b=$(timeout "$TIMEOUT" "$CLAUDE_BIN" -p \
  --session-id "$SESSION_B" \
  --dangerously-skip-permissions \
  "$PROMPT_B" 2>&1) || session_b_exit=$?

if [[ "$VERBOSE" == "true" ]]; then
  echo ""
  echo "── Session B output ──"
  echo "$output_b"
  echo ""
fi

if [[ $session_b_exit -eq 124 ]]; then
  echo -e "${YELLOW}SKIP: session B timed out after ${TIMEOUT}s${NC}"
  skip=$((skip + 1))
else
  if [[ $session_b_exit -ne 0 ]]; then
    check "session B: claude exited cleanly" fail "exit $session_b_exit: $(echo "$output_b" | tail -1)"
  else
    check "session B: claude exited cleanly" pass
  fi

  if echo "$output_b" | grep -qF "$SECRET"; then
    check "session B: retrieved secret from old transcript" pass
  else
    check "session B: retrieved secret from old transcript" fail "'$SECRET' not in output: $(echo "$output_b" | tr '\n' ' ' | cut -c1-200)"
  fi

  assert_file_exists "transcript B: exists" "$TRANSCRIPT_B"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "$(printf '%0.s─' {1..60})"
total=$((pass + fail + skip))
echo "Results: ${pass}/${total} passed, ${fail} failed, ${skip} skipped"

if [[ $fail -gt 0 ]]; then
  echo -e "${RED}HANDOFF E2E TEST FAILED${NC}"
  exit 1
fi

echo -e "${GREEN}Handoff e2e test passed${NC}"
exit 0
