#!/usr/bin/env bash
set -euo pipefail

# ACP Test Harness for Groundwork Skill Routing (Relaxed Progressive Disclosure)
# Tests that OpenCode ACP correctly routes to skills:
#   - bugs → diagnose (non-obvious only)
#   - changes/features → direct by default (no skill loading unless ambiguity escalates)
#   - orchestrator must never spawn task subagents on itself
#
# The `test` command will auto-start the ACP server if not already running.
# For manual testing, start the server first with the `start` command, then
# use `run` and `test` against it. Stop with the `stop` command when done.

DEFAULT_PORT=9877
PORT="${DEFAULT_PORT}"
RESULTS_DIR="/tmp/acp-test-results"
PID_FILE="/tmp/acp-server.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Trap to clean up on exit
cleanup() {
    if [[ -f "$PID_FILE" ]]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
        rm -f "$PID_FILE"
    fi
}
trap cleanup SIGINT SIGTERM EXIT

usage() {
    cat <<EOF
Usage: $(basename "$0") [command] [options]

Commands:
    start   - Start ACP server on specified port
    stop    - Stop ACP server
    run     - Run a single test case, capture JSON output
    test    - Run all test cases and report results

Options:
    --port PORT     Port for ACP server (default: $DEFAULT_PORT)
    --name NAME     Test case name (for run)
    --prompt TEXT   Prompt to send (for run)
    --dir DIR       Working directory (for run)
    --timeout SECS  Timeout in seconds (default: 60)
    --session ID    Session ID to attach to (for run)
    --expect-skills SKILL1,SKILL2  Expected skills (comma-separated, for run)

Examples:
    $(basename "$0") start --port 9877
    $(basename "$0") run --name trivial --prompt "What is 2+2?" --dir /tmp/todo-app
    $(basename "$0") test --port 9877
EOF
}

cmd_start() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --port)
                PORT="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1" >&2
                usage >&2
                exit 1
                ;;
        esac
    done

    # Check if already running
    if [[ -f "$PID_FILE" ]]; then
        local existing_pid
        existing_pid=$(cat "$PID_FILE")
        if kill -0 "$existing_pid" 2>/dev/null; then
            echo "ACP server already running on PID $existing_pid (port $PORT)"
            return 0
        else
            rm -f "$PID_FILE"
        fi
    fi

    echo "Starting ACP server on port $PORT..."
    local server_log="/tmp/acp-server-${PORT}.log"
    rm -f "$server_log"
    opencode acp --port "$PORT" > "$server_log" 2>&1 &
    local server_pid=$!
    echo "$server_pid" > "$PID_FILE"

    # Wait for server to be ready with active polling
    echo "Waiting for server to start..."
    local max_wait=30
    local waited=0
    while [[ $waited -lt $max_wait ]]; do
        if curl -sf "http://localhost:$PORT/" > /dev/null 2>&1; then
            echo -e "${GREEN}ACP server started successfully${NC}"
            echo "  PID: $server_pid"
            echo "  Port: $PORT"
            echo "  URL: http://localhost:$PORT/"
            return 0
        fi
        if ! kill -0 "$server_pid" 2>/dev/null; then
            echo -e "${RED}ACP server process exited unexpectedly${NC}" >&2
            echo "Server log ($server_log):" >&2
            cat "$server_log" >&2
            rm -f "$PID_FILE"
            return 1
        fi
        sleep 1
        ((waited++))
    done

    echo -e "${RED}Failed to start ACP server (timed out after ${max_wait}s)${NC}" >&2
    echo "Server log ($server_log):" >&2
    cat "$server_log" >&2
    kill "$server_pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    return 1
}

cmd_stop() {
    if [[ ! -f "$PID_FILE" ]]; then
        echo "No PID file found at $PID_FILE"
        return 0
    fi

    local pid
    pid=$(cat "$PID_FILE")

    if kill -0 "$pid" 2>/dev/null; then
        echo "Stopping ACP server (PID: $pid)..."
        kill "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        echo -e "${GREEN}ACP server stopped${NC}"
    else
        echo "ACP server not running (PID: $pid)"
    fi

    rm -f "$PID_FILE"
}

cmd_run() {
    local name=""
    local prompt=""
    local dir=""
    local timeout_secs=60
    local session_id=""
    local expect_skills=""
    local multi_turn="false"
    local max_turns=5

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --name)
                name="$2"
                shift 2
                ;;
            --prompt)
                prompt="$2"
                shift 2
                ;;
            --dir)
                dir="$2"
                shift 2
                ;;
            --timeout)
                timeout_secs="$2"
                shift 2
                ;;
            --session)
                session_id="$2"
                shift 2
                ;;
            --expect-skills)
                expect_skills="$2"
                shift 2
                ;;
            --multi-turn)
                multi_turn="true"
                shift
                ;;
            --max-turns)
                max_turns="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1" >&2
                usage >&2
                exit 1
                ;;
        esac
    done

    if [[ -z "$name" || -z "$prompt" || -z "$dir" ]]; then
        echo "Error: --name, --prompt, and --dir are required" >&2
        usage >&2
        exit 1
    fi

    mkdir -p "$RESULTS_DIR"

    local output_file="$RESULTS_DIR/${name}.json"
    local summary_file="$RESULTS_DIR/${name}.summary.json"

    echo "Running test case: $name"
    echo "  Prompt: ${prompt:0:60}..."
    echo "  Directory: $dir"
    echo "  Timeout: ${timeout_secs}s"

    local start_time end_time duration_ms
    start_time=$(date +%s%3N)

    # Build command
    local cmd=(opencode run --attach "http://localhost:$PORT" --format json --dir "$dir")
    if [[ -n "$session_id" ]]; then
        cmd+=(--session "$session_id")
    fi
    cmd+=("$prompt")

    # Run with timeout
    local exit_code=0
    timeout "$timeout_secs" "${cmd[@]}" > "$output_file" 2>&1
    local cmd_status=$?
    if [[ $cmd_status -eq 124 ]]; then
        echo -e "${YELLOW}Test timed out after ${timeout_secs}s${NC}"
        exit_code=1
    elif [[ $cmd_status -ne 0 ]]; then
        echo -e "${RED}Test command failed with status $cmd_status${NC}" >&2
        exit_code=2
    fi

    end_time=$(date +%s%3N)
    duration_ms=$((end_time - start_time))

    # Parse JSON output
    local session_id_found=""
    local text_content=""
    local skills_loaded="[]"
    local tools_used="[]"
    local task_subagent_types="[]"
    local finish_reason=""

    if [[ -s "$output_file" ]]; then
        # JSON Lines format — slurp with -s, process as array
        # Extract session ID from first step_start event
        session_id_found=$(jq -rs 'map(select(.type == "step_start")) | .[0].sessionID // empty' "$output_file" 2>/dev/null || true)

        # Extract all text content (nested under .part.text)
        text_content=$(jq -rs 'map(select(.type == "text") | .part.text) | join(" ")' "$output_file" 2>/dev/null || true)

        # Extract skills loaded from tool_use events where .part.tool == "skill"
        # Skill name is at .part.state.input.name
        skills_loaded=$(jq -rs 'map(select(.type == "tool_use" and .part.tool == "skill") | .part.state.input.name // empty)' "$output_file" 2>/dev/null || true)

        # Extract all tool calls (tool type at .part.tool)
        tools_used=$(jq -rs 'map(select(.type == "tool_use") | .part.tool)' "$output_file" 2>/dev/null || true)

        # Extract task subagent types from task tool calls
        task_subagent_types=$(jq -rs 'map(select(.type == "tool_use" and .part.tool == "task") | .part.state.input.subagent_type // empty)' "$output_file" 2>/dev/null || true)

    # Extract finish reason from step_finish event (nested under .part.reason)
    finish_reason=$(jq -rs 'map(select(.type == "step_finish")) | .[0].part.reason // empty' "$output_file" 2>/dev/null || true)
    fi

    # Multi-turn continuation for feature conversations
    if [[ "$multi_turn" == "true" && -n "$session_id_found" ]]; then
        local turn=1
        local canned_answers=(
            "Yes, this is a significant multi-day feature. Please proceed with the interview to gather requirements."
            "The target users are developers and project managers. We need a visual rule builder UI, localStorage persistence, and a simulation mode to test rules."
            "Please go ahead and create the PRD now."
        )

        while [[ $turn -lt $max_turns ]]; do
            if echo "$skills_loaded" | jq -e 'contains(["vertical-slice"])' > /dev/null 2>&1; then
                echo "Multi-turn: vertical-slice loaded on turn $turn, stopping"
                break
            fi

            if ! echo "$skills_loaded" | jq -e 'contains(["interview"])' > /dev/null 2>&1; then
                echo "Multi-turn: interview not loaded, stopping multi-turn"
                break
            fi

            local answer_idx=$(( (turn - 1) % ${#canned_answers[@]} ))
            local follow_up_prompt="${canned_answers[$answer_idx]}"

            echo "Multi-turn turn $turn: continuing session $session_id_found"

            local follow_cmd=(opencode run --attach "http://localhost:$PORT" --format json --dir "$dir" --session "$session_id_found")
            follow_cmd+=("$follow_up_prompt")

            local follow_output_file="$RESULTS_DIR/${name}_turn${turn}.json"
            local follow_exit_code=0
            timeout "$timeout_secs" "${follow_cmd[@]}" > "$follow_output_file" 2>&1
            local follow_status=$?
            if [[ $follow_status -eq 124 ]]; then
                echo -e "${YELLOW}Multi-turn turn $turn timed out after ${timeout_secs}s${NC}"
                follow_exit_code=1
                break
            elif [[ $follow_status -ne 0 ]]; then
                echo -e "${YELLOW}Multi-turn turn $turn failed with status $follow_status${NC}"
                follow_exit_code=2
                break
            fi

            # Merge this turn's output into the main output file for unified parsing
            cat "$follow_output_file" >> "$output_file"

            # Re-extract from combined output (preserve order — no unique)
            skills_loaded=$(jq -rs 'map(select(.type == "tool_use" and .part.tool == "skill") | .part.state.input.name // empty)' "$output_file" 2>/dev/null || true)
            tools_used=$(jq -rs 'map(select(.type == "tool_use") | .part.tool)' "$output_file" 2>/dev/null || true)
            task_subagent_types=$(jq -rs 'map(select(.type == "tool_use" and .part.tool == "task") | .part.state.input.subagent_type // empty)' "$output_file" 2>/dev/null || true)
            text_content=$(jq -rs 'map(select(.type == "text") | .part.text) | join(" ")' "$output_file" 2>/dev/null || true)

            ((turn++))
        done
    fi

    # Write summary (build valid JSON — use jq for proper string escaping)
    text_json=$(echo "$text_content" | jq -R -s . 2>/dev/null || echo '""')
    prompt_json=$(echo "$prompt" | jq -R -s . 2>/dev/null || echo '""')
    skills_json="${skills_loaded:-[]}"
    tools_json="${tools_used:-[]}"
    task_types_json="${task_subagent_types:-[]}"
    cat > "$summary_file" <<EOF
{
  "name": "$name",
  "session_id": "${session_id_found:-}",
  "text": $text_json,
  "skills_loaded": $skills_json,
  "tools_used": $tools_json,
  "task_subagent_types": $task_types_json,
  "finish_reason": "${finish_reason:-}",
  "duration_ms": $duration_ms,
  "prompt": $prompt_json
}
EOF

    # Check expected skills
    local pass=true
    if [[ -n "$expect_skills" ]]; then
        IFS=',' read -ra expected_array <<< "$expect_skills"
        for skill in "${expected_array[@]}"; do
            skill=$(echo "$skill" | xargs) # trim whitespace
            if [[ -z "$skill" ]]; then
                continue
            fi
            if ! echo "$skills_loaded" | jq -e "contains([\"$skill\"])" > /dev/null 2>&1; then
                echo -e "${RED}FAIL: Expected skill '$skill' not loaded${NC}"
                pass=false
            fi
        done
    fi

    if $pass; then
        echo -e "${GREEN}PASS: Skill loading correct${NC}"
    fi

    echo "  Output: $output_file"
    echo "  Summary: $summary_file"
    echo "  Duration: ${duration_ms}ms"

    return $exit_code
}

cmd_test() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --port)
                PORT="$2"
                shift 2
                ;;
            *)
                echo "Unknown option: $1" >&2
                usage >&2
                exit 1
                ;;
        esac
    done

    # Clean results directory
    rm -rf "$RESULTS_DIR"
    mkdir -p "$RESULTS_DIR"

    # Reset test project (recreate from scratch to avoid test pollution)
    echo "Creating fresh test project at /tmp/todo-app..."
    rm -rf /tmp/todo-app
    mkdir -p /tmp/todo-app/src
    cat > /tmp/todo-app/src/style.css <<'EOF'
.todo-app {
  backgroud: white;
  color: black;
}
EOF
    cat > /tmp/todo-app/index.html <<'EOF'
<!DOCTYPE html>
<html>
<head><title>Todo App</title></head>
<body>
  <div id="app"></div>
  <script src="src/app.js"></script>
</body>
</html>
EOF
    cat > /tmp/todo-app/src/app.js <<'EOF'
const todos = [
  { id: 1, text: 'Learn OpenCode', completed: false },
  { id: 2, text: 'Build something', completed: true },
];
function render() {
  const app = document.getElementById('app');
  app.innerHTML = '<ul>' + todos.map(t => '<li>' + t.text + '</li>').join('') + '</ul>';
}
render();
EOF

    # Start server if not running
    if [[ ! -f "$PID_FILE" ]] || ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        cmd_start --port "$PORT"
    fi

    echo ""
    echo "========================================"
    echo "Running ACP Skill Routing Tests"
    echo "========================================"
    echo ""

    # Test results array
    declare -a results

    # Test 1: Trivial
    echo "--- Test 1: trivial ---"
    if cmd_run --name trivial \
        --prompt "What is 2+2? Just give me the number." \
        --dir /tmp/todo-app \
        --timeout 60 \
        --expect-skills ""; then
        results+=("trivial|PASS")
    else
        results+=("trivial|FAIL")
    fi
    echo ""

    # Test 2: Obvious bug (typo) — direct fix, no diagnose needed
    echo "--- Test 2: trivial-bug ---"
    if cmd_run --name trivial-bug \
        --prompt "Fix the typo in /tmp/todo-app/src/style.css where it says 'backgroud' instead of 'background'" \
        --dir /tmp/todo-app \
        --timeout 120 \
        --expect-skills ""; then
        results+=("trivial-bug|PASS")
    else
        results+=("trivial-bug|FAIL")
    fi
    echo ""

    # Test 3: Non-obvious Bug — needs diagnose
    echo "--- Test 3: standard-bug ---"
    if cmd_run --name standard-bug \
        --prompt "The todo app filters don't work correctly. When I click 'Active' filter, completed items still show. Debug and fix it." \
        --dir /tmp/todo-app \
        --timeout 180 \
        --expect-skills "diagnose"; then
        results+=("standard-bug|PASS")
    else
        results+=("standard-bug|FAIL")
    fi
    echo ""

    # Test 4: Small Change — direct by default, no skills needed
    echo "--- Test 4: small-change ---"
    if cmd_run --name small-change \
        --prompt "Add a button to the todo app that toggles all todos between completed and uncompleted" \
        --dir /tmp/todo-app \
        --timeout 120 \
        --expect-skills ""; then
        results+=("small-change|PASS")
    else
        results+=("small-change|FAIL")
    fi
    echo ""

    # Test 5: Feature — clearly multi-day, should trigger interview then vertical-slice
    echo "--- Test 5: feature ---"
    if cmd_run --name feature \
        --prompt 'Build a workflow engine for the todo app: users can create custom automation rules with triggers (e.g., "when a todo is marked complete"), conditions (e.g., "if the todo has tag #work"), and actions (e.g., "move to Done list and notify via email"). Include a visual rule builder UI, rule persistence in localStorage, and a simulation mode to test rules without affecting real data.' \
        --dir /tmp/todo-app \
        --timeout 300 \
        --multi-turn \
        --max-turns 5 \
        --expect-skills "interview,vertical-slice"; then
        results+=("feature|PASS")
    else
        results+=("feature|FAIL")
    fi
    echo ""

    # Test 6: Orchestrator self-task prevention — must not spawn task subagents
    echo "--- Test 6: orchestrator-no-self-task ---"
    if cmd_run --name orchestrator-no-self-task \
        --prompt "Add a search bar to the todo app that filters todos in real-time as the user types" \
        --dir /tmp/todo-app \
        --timeout 120 \
        --expect-skills ""; then
        results+=("orchestrator-no-self-task|PASS")
    else
        results+=("orchestrator-no-self-task|FAIL")
    fi
    echo ""

    # Print summary table
    echo "========================================"
    echo "Test Results Summary"
    echo "========================================"
    printf "%-18s | %-16s | %-16s | %-10s | %-6s\n" "Test Case" "Skills Expected" "Skills Loaded" "Duration" "Result"
    printf "%-18s-+-%-16s-+-%-16s-+-%-10s-+-%-6s\n" "------------------" "----------------" "----------------" "----------" "------"

    local total_passed=0
    local total_failed=0

    for result in "${results[@]}"; do
        local test_name test_result
        test_name="${result%%|*}"
        test_result="${result##*|}"

        # Read summary
        local summary_file="$RESULTS_DIR/${test_name}.summary.json"
        local skills_loaded duration_ms
        skills_loaded="(none)"
        duration_ms="0"

        if [[ -f "$summary_file" ]]; then
            skills_loaded=$(jq -r '[.skills_loaded[]] | if length > 0 then join(", ") else "(none)" end' "$summary_file" 2>/dev/null || echo "(none)")
            duration_ms=$(jq -r '.duration_ms // 0' "$summary_file" 2>/dev/null || echo "0")
        fi

        local expected_skills=""
        case "$test_name" in
            trivial) expected_skills="(none)" ;;
            trivial-bug) expected_skills="(none)" ;;
            standard-bug) expected_skills="diagnose" ;;
            small-change) expected_skills="(none)" ;;
            feature) expected_skills="interview, vertical-slice" ;;
            orchestrator-no-self-task) expected_skills="(none)" ;;
        esac

        local duration_sec
        duration_sec=$(echo "scale=1; $duration_ms / 1000" | bc 2>/dev/null || echo "0")

        if [[ "$test_result" == "PASS" ]]; then
            printf "%-18s | %-16s | %-16s | %-10s | ${GREEN}%-6s${NC}\n" "$test_name" "$expected_skills" "$skills_loaded" "${duration_sec}s" "PASS"
            ((total_passed++))
        else
            printf "%-18s | %-16s | %-16s | %-10s | ${RED}%-6s${NC}\n" "$test_name" "$expected_skills" "$skills_loaded" "${duration_sec}s" "FAIL"
            ((total_failed++))
        fi
    done

    echo ""
    echo "Total: $total_passed passed, $total_failed failed"

    if [[ $total_failed -gt 0 ]]; then
        return 1
    fi
    return 0
}

# Main
main() {
    if [[ $# -eq 0 ]]; then
        usage >&2
        exit 1
    fi

    local command="$1"
    shift

    case "$command" in
        start)
            cmd_start "$@"
            ;;
        stop)
            cmd_stop "$@"
            ;;
        run)
            cmd_run "$@"
            ;;
        test)
            cmd_test "$@"
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            echo "Unknown command: $command" >&2
            usage >&2
            exit 1
            ;;
    esac
}

main "$@"
