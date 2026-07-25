#!/usr/bin/env bash
# Groundwork Skills Suite — ACP Smoke Test (Progressive Disclosure)
# Verifies the agent correctly routes: bugs→diagnose, changes→default direct.
# Run interactively via the opencode-acp skill pattern.
set -euo pipefail

echo "=== Groundwork ACP Smoke Test (Progressive Disclosure) ==="
echo ""
echo "This script documents the expected test flow."
echo "Execute via: opencode-acp skill (start ACP via PTY, send each prompt)"
echo ""

echo "--- Test 1: Bug → diagnose ---"
echo "Prompt: 'There is a bug where the Submit button is invisible in dark mode'"
echo "Expected: agent loads diagnose skill, builds feedback loop,"
echo "          reproduces, hypothesises, fixes, writes regression test, advisor-gate"
echo ""

echo "--- Test 2: Well-specified change → direct implementation ---"
echo "Prompt: 'Add a toggle-all button to the todo list'"
echo "Expected: agent implements directly without loading interview,"
echo "          finishes with advisor-gate. Skips interview/vertical-slice/plan."
echo ""

echo "--- Test 3: Ambiguous change → interview escalation ---"
echo "Prompt: 'Improve the todo app — make it better somehow'"
echo "Expected: agent detects ambiguity, loads interview skill, asks clarifying questions,"
echo "          then implements based on answers, advisor-gate"
echo ""

echo "--- Test 4: Multi-file change → interview ---"
echo "Prompt: 'Add user authentication with OAuth2 across the entire app'"
echo "Expected: agent detects >1 file scope, loads interview skill,"
echo "          scopes the work, then implements, advisor-gate"
echo ""

echo "--- Test 5: Clearly ≥1d feature → interview + plan + slice ---"
echo "Prompt: 'We need to add user authentication with OAuth2 — this will take a few days'"
echo "Expected: agent classifies as feature (≥1d), loads interview skill,"
echo "          asks questions, synthesizes a plan, then vertical-slice, fan-out coders, advisor-gate"
echo ""

echo "--- Test 6: Completion gate trigger ---"
echo "Prompt: 'The fix is done, we can mark this task complete'"
echo "Expected: agent loads advisor-gate skill, sends completion gate request,"
echo "          waits for APPROVE before declaring done"
echo ""

echo "=== ACP interaction pattern (using opencode-acp skill) ==="
echo ""
echo "1. Start:      pty_spawn(command='opencode', args=['acp', '--port', '9880'], title='ACP Test')"
echo "2. Wait:       bash(command='sleep 3 && curl -sf http://localhost:9880/health || echo NOT READY')"
echo "3. Send each prompt:"
echo "   opencode run '<prompt>' --attach http://localhost:9880 --dir /tmp/todo-app --format json"
echo "4. Stop:       pty_kill(id='<pty-id>', cleanup=true)"
echo ""
echo "=== Pass criteria ==="
echo "- Test 1: output includes diagnose skill or diagnosis activity"
echo "- Test 2: output implements directly, no interview/create-prd"
echo "- Test 3: output includes clarifying questions"
echo "- Test 4: output includes interview/scoping questions"
echo "- Test 5: output includes interview, PRD, or mention of planning"
