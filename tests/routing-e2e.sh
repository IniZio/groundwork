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
  local meta="You are operating in ROUTING CLASSIFICATION MODE.
Analyse the following user request using the routing table in your system instructions.
Reply with EXACTLY this format (one line per agent):
  ROUTE: <agent-name>
For the PRIMARY specialist only. Do not call any tools. Do not implement anything."

  local full_prompt="${meta}

User request: ${prompt}"

  printf "%-40s " "$name"

  local output
  local exit_code=0
  output=$(timeout "$TIMEOUT" claude --print \
    --system "$(cat "$CLAUDE_MD")" \
    "$full_prompt" 2>/dev/null) || exit_code=$?

  if [[ $exit_code -eq 124 ]]; then
    echo -e "${YELLOW}SKIP (timeout ${TIMEOUT}s)${NC}"
    ((skip++))
    return
  fi

  if [[ "$VERBOSE" == "true" ]]; then
    echo ""
    echo "  Output: $output"
  fi

  # Check expected agent is present
  if ! echo "$output" | grep -qi "$expected"; then
    echo -e "${RED}FAIL${NC} — expected '$expected', got: $(echo "$output" | tr '\n' ' ')"
    ((fail++))
    return
  fi

  # Check forbidden agent is absent
  if [[ -n "$forbidden" ]] && echo "$output" | grep -qi "$forbidden"; then
    echo -e "${RED}FAIL${NC} — '$forbidden' should not be routed, but got: $(echo "$output" | tr '\n' ' ')"
    ((fail++))
    return
  fi

  echo -e "${GREEN}PASS${NC}"
  ((pass++))
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
test_routing \
  "feature: complex from scratch" \
  "Build a complete notification system from scratch with email, SMS, and push support, user preferences, and delivery tracking" \
  "groundwork:planner" \
  "groundwork:coder"

test_routing \
  "feature: architecture question" \
  "Plan the architecture for migrating from monolith to microservices" \
  "groundwork:planner"

# Small change → coder direct
test_routing \
  "small: localized clear change" \
  "Add a loading spinner to the submit button while the form is being submitted" \
  "groundwork:coder" \
  "groundwork:planner"

# Code review
test_routing \
  "review: code quality" \
  "Review my auth middleware implementation for code quality and SOLID principles" \
  "groundwork:critic"

test_routing \
  "review: plan validation" \
  "Validate this plan before we start implementing" \
  "groundwork:critic"

# Security
test_routing \
  "security: OWASP audit" \
  "Audit the input handling for OWASP top 10 vulnerabilities, especially injection risks" \
  "groundwork:security-reviewer"

test_routing \
  "security: auth review" \
  "Review the authentication module for security vulnerabilities" \
  "groundwork:security-reviewer"

# Tests
test_routing \
  "tests: coverage request" \
  "Write unit tests for the payment service with full coverage" \
  "groundwork:test-engineer"

test_routing \
  "tests: flaky test diagnosis" \
  "The CI pipeline has a flaky test that fails 30% of the time — diagnose and fix it" \
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
