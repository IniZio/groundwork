#!/usr/bin/env bash
# E2E routing tests — invokes claude CLI to validate orchestrator routing decisions
# under different prompt scenarios.
#
# These tests verify that the CLAUDE.md routing table + keyword-router.mjs hook
# together produce correct specialist agent selection.
#
# Requires: claude CLI in PATH, GROUNDWORK_DIR env var pointing to plugin root.
#
# Usage:
#   ./tests/routing-e2e.sh                     # run all tests
#   ./tests/routing-e2e.sh --verbose           # show full claude output
#   TIMEOUT=60 ./tests/routing-e2e.sh          # override timeout per test

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_MD="$PLUGIN_DIR/CLAUDE.md"
TIMEOUT="${TIMEOUT:-45}"
VERBOSE="${VERBOSE:-false}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

pass=0
fail=0
skip=0

if ! command -v claude &>/dev/null; then
  echo -e "${YELLOW}SKIP: claude CLI not found in PATH${NC}"
  echo "Install claude CLI and ensure it is authenticated to run e2e routing tests."
  exit 0
fi

if [[ ! -f "$CLAUDE_MD" ]]; then
  echo -e "${RED}FAIL: CLAUDE.md not found at $CLAUDE_MD${NC}"
  exit 1
fi

# ── Routing test helper ───────────────────────────────────────────────────────
# Sends a prompt to claude and checks that the response mentions the expected
# agent. We prepend a lightweight meta-instruction so claude returns a structured
# routing declaration without actually spawning agents.
#
# Arguments:
#   $1  test name
#   $2  user prompt to classify
#   $3  expected agent substring (e.g. "groundwork:debugger")
#   $4  (optional) forbidden agent that must NOT appear (e.g. "groundwork:planner")

test_routing() {
  local name="$1"
  local prompt="$2"
  local expected="$3"
  local forbidden="${4:-}"

  # Meta-instruction asks the orchestrator to declare routing without executing
  # Append a classification meta-instruction on top of the live CLAUDE.md system prompt.
  # --append-system-prompt adds to the default prompt so Claude retains its identity
  # and tool awareness while also having the routing classification constraint.
  local meta="ROUTING CLASSIFICATION MODE: For the next user message only, do NOT call any tools and do NOT implement anything. Analyse the request against your routing table and reply with EXACTLY one line: ROUTE: <agent-name> (primary specialist only)."

  local full_prompt="Classify this request (routing test): ${prompt}"

  printf "%-40s " "$name"

  local output
  local exit_code=0
  output=$(timeout "$TIMEOUT" claude --print \
    --append-system-prompt "$meta" \
    "$full_prompt" 2>/dev/null) || exit_code=$?

  if [[ $exit_code -eq 124 ]]; then
    echo -e "${YELLOW}SKIP (timeout ${TIMEOUT}s)${NC}"
    skip=$((skip + 1))
    return
  fi

  if [[ "$VERBOSE" == "true" ]]; then
    echo ""
    echo "  Output: $output"
  fi

  # Check expected agent is present
  if ! echo "$output" | grep -qi "$expected"; then
    echo -e "${RED}FAIL${NC} — expected '$expected', got: $(echo "$output" | tr '\n' ' ')"
    fail=$((fail + 1))
    return
  fi

  # Check forbidden agent is absent
  if [[ -n "$forbidden" ]] && echo "$output" | grep -qi "$forbidden"; then
    echo -e "${RED}FAIL${NC} — '$forbidden' should not be routed, but got: $(echo "$output" | tr '\n' ' ')"
    fail=$((fail + 1))
    return
  fi

  echo -e "${GREEN}PASS${NC}"
  pass=$((pass + 1))
}

# ── Test suite ────────────────────────────────────────────────────────────────

echo ""
echo -e "${CYAN}Groundwork E2E Routing Tests${NC}"
echo "CLAUDE.md: $CLAUDE_MD"
echo "Timeout: ${TIMEOUT}s per test"
echo ""
printf "%-40s %s\n" "Test" "Result"
printf "%-40s %s\n" "$(printf '%0.s-' {1..40})" "------"

# Bug routing
test_routing \
  "bug: explicit bug report" \
  "The login button doesn't work after the last deploy. Users are getting a 500 error." \
  "groundwork:debugger"

test_routing \
  "bug: stack trace provided" \
  "Here's the stack trace from prod: TypeError: Cannot read property 'id' of undefined at UserService.getUser" \
  "groundwork:debugger"

test_routing \
  "bug: regression report" \
  "There's a regression in payment processing — it worked last week but now always fails at checkout" \
  "groundwork:debugger"

# Feature/planning routing
# Complex features may route via orchestrator (who then delegates to planner) — accept both
test_routing \
  "feature: complex from scratch" \
  "Build a complete notification system from scratch with email, SMS, and push support, user preferences, and delivery tracking" \
  "groundwork:planner\|groundwork:orchestrator"

test_routing \
  "feature: architecture question" \
  "Plan the architecture for migrating from monolith to microservices" \
  "groundwork:planner"

# Small change → coder direct
test_routing \
  "small: localized clear change" \
  "Add email validation logic to the signup form handler — reject addresses without @ sign" \
  "groundwork:coder" \
  "groundwork:planner"

# Code review
# critic was previously named code-reviewer — accept both until plugin root CLAUDE.md is updated
test_routing \
  "review: code quality" \
  "Review my auth middleware implementation for code quality and SOLID principles" \
  "groundwork:critic\|groundwork:code-reviewer"

test_routing \
  "review: plan validation" \
  "Validate this plan before we start implementing" \
  "groundwork:critic"

# Tests
test_routing \
  "tests: coverage request" \
  "Write unit tests for the payment service with full coverage" \
  "groundwork:test-engineer"

test_routing \
  "tests: flaky test hardening" \
  "The CI auth tests are non-deterministic and fail intermittently — harden them" \
  "groundwork:test-engineer"

# Git
test_routing \
  "git: commit request" \
  "Commit these changes with a descriptive message" \
  "groundwork:git-master"

test_routing \
  "git: PR creation" \
  "Create a pull request for this feature branch" \
  "groundwork:git-master"

# Design
test_routing \
  "design: UI improvement" \
  "Improve the UI of the dashboard — it needs better spacing and a dark mode toggle" \
  "groundwork:designer"

# Advisor
test_routing \
  "advisor: architecture tradeoff" \
  "Should we use REST or GraphQL for the new mobile API? What are the trade-offs?" \
  "groundwork:advisor"

# Advisor completion gate signals
test_routing \
  "advisor: completion gate" \
  "Run the advisor gate — we need to declare done on this task" \
  "groundwork:advisor"

test_routing \
  "advisor: mark as complete" \
  "We are all done — mark as complete and run the completion gate" \
  "groundwork:advisor"

# Verifier — completion verification
test_routing \
  "verifier: is it done" \
  "Is it done? Can you verify this works and show evidence before we ship it?" \
  "groundwork:verifier"

test_routing \
  "verifier: can we merge" \
  "Can we merge this? Are all tests passing and does it pass the completion check?" \
  "groundwork:verifier"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "$(printf '%0.s─' {1..50})"
total=$((pass + fail + skip))
echo "Results: ${pass}/${total} passed, ${fail} failed, ${skip} skipped"

if [[ $fail -gt 0 ]]; then
  echo -e "${RED}ROUTING TESTS FAILED${NC}"
  exit 1
fi

echo -e "${GREEN}All routing tests passed${NC}"
exit 0
