# Stage 7: Test (Parallel Subagents)

Spawn three test subagents in parallel (single message, multiple Agent calls). Each writes results to `<app>/test/` and returns a summary.

## Setup

Create `test/.mcp-test.json` before spawning subagents:

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

## Subagents

Spawn all three in a single message:

### 1. stdio-tester

```
Agent({
  description: "stdio tool tests",
  prompt: `Test every tool in the MCP server at <APP_DIR>. Note: test-tool.sh may hang on first run if auth requires interactive login — if a tool times out, re-run after cookies are cached.

Run ./test/test-tool.sh --list to get all tools, then call each with representative arguments. For each tool report: tool name, arguments used, pass/fail, response summary, any errors.

Write results to <APP_DIR>/test/stdio-results.md. Return pass/fail count.`
})
```

### 2. consistency-checker

```
Agent({
  description: "tool-name consistency check",
  prompt: `Check tool-name consistency in <APP_DIR>/server/index.js.

Verify: every tool name in APP_TOOLS has a matching case in handleTool, and every case in handleTool has a matching APP_TOOLS entry. Built-in tools (set_output_dir, *_debug_env) are handled separately — exclude them.

Write results to <APP_DIR>/test/consistency-results.md. Return any mismatches found.`
})
```

### 3. pressure-tester

```
Agent({
  description: "Claude CLI pressure tests",
  prompt: `Pressure-test the MCP server at <APP_DIR> using Claude CLI.

Run: claude --mcp-config <APP_DIR>/test/.mcp-test.json --allowedTools 'mcp__<app>__*' -p '<prompt>'

Test 4 categories (2+ prompts each):
1. Happy path — straightforward queries the tools handle
2. Edge cases — empty results, missing data, large responses
3. Multi-tool — questions requiring multiple tool calls
4. Wrong tool — queries that should NOT trigger these tools

For each: record the prompt, tools called, token usage, accuracy (cross-check against expected behavior).

Write results to <APP_DIR>/test/pressure-results.md. Return overall pass/fail and any tools that need description or schema fixes.`
})
```

## Aggregation

After all subagents complete:

1. Read the three result files
2. Combine into `<app>/test/results.md` with an overall status
3. Track metrics: accuracy, tool call count, token usage, error frequency
4. If any subagent reported failures, identify which tools need fixes before Stage 8

## Verbose debug (manual fallback)

If a pressure test failure needs deeper inspection:

```bash
claude --mcp-config test/.mcp-test.json \
  --verbose --output-format stream-json \
  --allowedTools 'mcp__<app>__*' \
  -p 'prompt' 2>&1 | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line.strip())
        if d.get('type') == 'assistant':
            for c in d.get('message',{}).get('content',[]):
                if c.get('type') == 'text': print(c['text'])
                elif c.get('type') == 'tool_use':
                    print(f'TOOL: {c[\"name\"]}({json.dumps(c[\"input\"])})')
    except: pass
"
```

## Gate Condition

**All three subagents report pass. Aggregated results in `<app>/test/results.md` reported to user. Do not skip to Stage 9 (install) — testing must complete and pass before offering installation.**
