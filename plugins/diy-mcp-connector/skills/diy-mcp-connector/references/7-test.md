# Stage 7: Test

All test types below are required. Do not skip the Claude CLI pressure test — it catches issues that stdio tests miss (wrong tool selection, poor descriptions, response size problems).

## Direct stdio Test

Use the bundled test runner for fast single-tool verification:

```bash
# Call a specific tool with arguments
./test/test-tool.sh <app>_<tool_name> '{"key":"value"}'

# List all available tools
./test/test-tool.sh --list
```

The test runner handles the JSON-RPC envelope (initialize, notifications/initialized, tools/call) so you do not need to construct it manually. It pretty-prints the response and exits with a non-zero code on errors.

For raw stdio testing without the helper:

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"<app>_<tool>","arguments":{"key":"value"}}}\n' | node server/index.js 2>/dev/null | tail -1 | python3 -m json.tool
```

## Tool-Name Consistency Check

For each tool name defined in `APP_TOOLS`, verify that `handleTool` has a matching `case` in the switch statement. Missing cases cause "Unknown tool" errors at runtime.

Automated check:

```bash
# Extract tool names from APP_TOOLS definitions
DEFINED=$(grep -oP 'name:\s*"(\K[^"]+)' server/index.js)

# Extract case labels from handleTool
HANDLED=$(grep -oP 'case\s+"(\K[^"]+)' server/index.js)

# Find tools defined but not handled
echo "Defined but not handled:"
comm -23 <(echo "$DEFINED" | sort) <(echo "$HANDLED" | sort)

# Find cases with no matching tool definition
echo "Handled but not defined:"
comm -13 <(echo "$DEFINED" | sort) <(echo "$HANDLED" | sort)
```

Both lists should be empty. Built-in tools (`set_output_dir`, `get_output_dir`, `<app>_debug_env`) are handled separately and will appear in the second list — that is expected.

## Claude CLI Pressure Test

### Setup

Create `test/.mcp-test.json` (add to `.gitignore`):

```json
{
  "mcpServers": {
    "<app>": {
      "command": "node",
      "args": ["/absolute/path/to/<app>/server/index.js"]
    }
  }
}
```

### Run test queries

```bash
claude --mcp-config test/.mcp-test.json \
  --allowedTools 'mcp__<app>__*' \
  -p 'your test prompt here'
```

### Test categories

Generate test prompts that mimic real user queries. Cover all four categories:

1. **Happy path** — straightforward queries the tools are designed for
   - "What are the open tickets assigned to me?"
   - "Search for documents about onboarding"
2. **Edge cases** — missing data, empty results, very large responses
   - "Find tickets from project NONEXISTENT"
   - "Get the full transcript for meeting X" (tests large response handling)
3. **Multi-tool workflows** — questions requiring data from multiple tools
   - "Find the latest sprint and list all bugs in it"
   - "Search for user X and show their recent activity"
4. **Wrong tool selection** — queries that sound similar but should not trigger your tools
   - Queries about unrelated domains to verify the LLM does not force-fit your tools

## Verbose Debug

For full tool call inspection, use stream-json output parsing:

```bash
claude --mcp-config test/.mcp-test.json \
  --verbose --output-format stream-json \
  --allowedTools 'mcp__<app>__*' \
  -p 'your prompt' 2>&1 | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line.strip())
        if d.get('type') == 'system':
            print('MCP:', json.dumps(d.get('mcp_servers', []), indent=2))
        elif d.get('type') == 'assistant':
            for c in d.get('message',{}).get('content',[]):
                if c.get('type') == 'text': print(c['text'])
                elif c.get('type') == 'tool_use':
                    print(f'TOOL: {c[\"name\"]}({json.dumps(c[\"input\"])})')
    except: pass
"
```

This shows exactly which tools Claude selects, what arguments it passes, and what responses it receives — essential for diagnosing wrong-tool-selection and parameter issues.

## Evaluation Metrics

Track these metrics across all pressure test prompts:

| Metric | What to look for |
|---|---|
| **Accuracy** | Did the tool return the correct data? Cross-check against the app UI. |
| **Tool call count** | Excessive calls indicate tools need consolidation or richer responses. |
| **Token usage** | Large inline responses waste context window. Switch to `resource_link` for anything over the inline threshold. |
| **Error frequency** | Repeated errors mean schemas or descriptions need work. Check for parameter type mismatches, missing required fields, and unclear descriptions. |

Record results for each test prompt. If any metric is consistently poor for a specific tool, return to Stage 8 (Optimize) to fix it.

## Gate Condition

**All test types pass: direct stdio returns valid data, tool-name consistency check shows no gaps, Claude CLI pressure test covers all four categories, and evaluation metrics are acceptable.** Report results to the user before proceeding to Stage 8.
