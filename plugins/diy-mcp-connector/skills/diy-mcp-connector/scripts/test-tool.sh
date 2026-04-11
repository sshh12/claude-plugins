#!/usr/bin/env bash
#
# test-tool.sh — Parameterized stdio MCP test runner for generated servers.
#
# Usage:
#   ./test-tool.sh <tool-name> [json-args]   Call a specific tool
#   ./test-tool.sh --list                     List all available tools
#
# Examples:
#   ./test-tool.sh myapp_search_items '{"query": "test", "limit": 5}'
#   ./test-tool.sh myapp_get_item '{"id": "abc-123"}'
#   ./test-tool.sh --list
#
# The script sends JSON-RPC messages over stdin to the MCP server (node
# server/index.js), discards stderr (auth/debug logs), and pretty-prints
# the final JSON-RPC response from stdout.

set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve project root and server entry point
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Walk up from script location to find server/index.js.
# Supports being placed in: project root, scripts/, or nested deeper.
PROJECT_ROOT=""
candidate="$SCRIPT_DIR"
for _ in 1 2 3 4 5; do
  if [[ -f "$candidate/server/index.js" ]]; then
    PROJECT_ROOT="$candidate"
    break
  fi
  candidate="$(dirname "$candidate")"
done

if [[ -z "$PROJECT_ROOT" ]]; then
  echo "Error: Could not find server/index.js relative to this script." >&2
  echo "Run this script from the project root or place it within the project tree." >&2
  exit 1
fi

SERVER="$PROJECT_ROOT/server/index.js"

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------

usage() {
  echo "Usage:"
  echo "  $0 <tool-name> [json-args]    Call a tool"
  echo "  $0 --list                      List available tools"
  echo ""
  echo "Examples:"
  echo "  $0 myapp_search '{}'"
  echo "  $0 myapp_get_item '{\"id\": \"abc\"}'"
  echo "  $0 --list"
  exit 1
}

if [[ $# -lt 1 ]]; then
  usage
fi

# ---------------------------------------------------------------------------
# JSON-RPC message constructors
# ---------------------------------------------------------------------------

# Every MCP session starts with initialize + notifications/initialized.
INIT_MSG='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-tool","version":"1.0"}}}'
NOTIFY_MSG='{"jsonrpc":"2.0","method":"notifications/initialized"}'

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

if [[ "$1" == "--list" ]]; then
  LIST_MSG='{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

  RESPONSE=$(
    printf '%s\n%s\n%s\n' "$INIT_MSG" "$NOTIFY_MSG" "$LIST_MSG" \
      | node "$SERVER" 2>/dev/null \
      | tail -1
  )
else
  TOOL_NAME="$1"
  TOOL_ARGS="${2:-{}}"

  # Validate that args look like JSON (basic check)
  if [[ "$TOOL_ARGS" != "{"* ]]; then
    echo "Error: Tool arguments must be a JSON object (e.g. '{\"key\": \"value\"}')." >&2
    echo "Got: $TOOL_ARGS" >&2
    exit 1
  fi

  CALL_MSG=$(printf '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"%s","arguments":%s}}' "$TOOL_NAME" "$TOOL_ARGS")

  RESPONSE=$(
    printf '%s\n%s\n%s\n' "$INIT_MSG" "$NOTIFY_MSG" "$CALL_MSG" \
      | node "$SERVER" 2>/dev/null \
      | tail -1
  )
fi

# ---------------------------------------------------------------------------
# Pretty-print
# ---------------------------------------------------------------------------

if [[ -z "$RESPONSE" ]]; then
  echo "Error: No response received from server." >&2
  echo "Check that server/index.js exists and runs without errors:" >&2
  echo "  node $SERVER" >&2
  exit 1
fi

if command -v jq &>/dev/null; then
  echo "$RESPONSE" | jq .
else
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
fi
