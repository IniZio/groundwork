#!/usr/bin/env bash
# Groundwork Skills Suite — ACP Smoke Test
# Verifies the agent loop triggers the correct skill for each scenario.
# Run interactively via the opencode-acp skill pattern.
set -euo pipefail

echo "=== Groundwork ACP Smoke Test ==="
echo ""
echo "This script documents the expected test flow."
echo "Execute via: opencode-acp skill (start ACP, initialize, create session, send each prompt below)"
echo ""

echo "--- Test 1: BDD trigger ---"
echo "Prompt: 'There is a bug where the Submit button is invisible in dark mode'"
echo "Expected: agent loads bdd-implement skill, mentions XCUITest or Playwright,"
echo "          takes screenshot before fix, takes screenshot after fix"
echo ""

echo "--- Test 2: Nested PRD trigger ---"
echo "Prompt: 'We need to switch from SQLite to Postgres — this changes the entire data layer in the master plan'"
echo "Expected: agent loads nested-prd skill, stops implementation,"
echo "          offers to create a child PRD, uses question tool to present options"
echo ""

echo "--- Test 3: Completion gate trigger ---"
echo "Prompt: 'The fix is done, we can mark this task complete'"
echo "Expected: agent loads advisor-gate skill, sends completion gate request to advisor,"
echo "          waits for APPROVE before declaring done to user"
echo ""

echo "--- Test 4: Session-continue trigger ---"
echo "Prompt: 'This session is getting really long, what should we do?'"
echo "Expected: agent loads session-continue skill, uses question tool to offer"
echo "          same-session summary OR /handoff options"
echo ""

echo "--- Test 5: available_skills injection ---"
echo "Prompt: 'What skills do you have available?'"
echo "Expected: response references groundwork skills by name"
echo "          (advisor-gate, bdd-implement, nested-prd, consolidate-docs, session-continue)"
echo ""

echo "=== ACP interaction pattern (using opencode-acp skill) ==="
echo ""
echo "1. Start:      opencode acp  (background)"
echo "2. Initialize: {\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"initialize\",...}"
echo "3. New session:{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session/new\",\"params\":{\"cwd\":\"/tmp/groundwork-test\",\"mcpServers\":[]}}"
echo "4. For each test prompt:"
echo "   Send:  {\"jsonrpc\":\"2.0\",\"id\":N,\"method\":\"session/prompt\",\"params\":{\"sessionId\":\"...\",\"prompt\":[{\"type\":\"text\",\"text\":\"<prompt>\"}]}}"
echo "   Poll:  every 2s until stopReason received"
echo "   Check: response text contains expected skill keywords"
echo ""
echo "=== Pass criteria ==="
echo "- All 5 tests show expected skill keywords in agent response"
echo "- Test 3 never declares done without advisor gate language"
echo "- Test 4 always uses question tool (not a direct statement)"
