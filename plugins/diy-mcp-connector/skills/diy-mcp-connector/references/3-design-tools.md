# Stage 3: Design Tools

Design 3-7 tools per app. Each tool should map to a user workflow, not a raw API endpoint.

## Tool Design Strategies

Follow [Anthropic's tool engineering guide](https://www.anthropic.com/engineering/writing-tools-for-agents):

### Consolidate related API calls
A single tool should match a user workflow, not an API endpoint. A `<app>_get_project` that fetches project details + members + recent activity in one call beats three separate tools. Fewer tools means fewer round-trips and less room for the LLM to pick the wrong tool.

### Combine search + detail
When users typically search then immediately drill in, return enriched results. If your search returns IDs and titles, and users always follow up with "tell me more about the first one," combine search + detail into one tool that returns richer data upfront.

### Synthesize search dimensions
If the API lacks a search parameter you need, overfetch and filter locally. Example: the API only filters by date range, but users want to filter by status. Fetch all items in the range, then filter by status in the tool handler. Expose the synthetic filter as a tool parameter — the user does not need to know it is client-side.

### Paginate with limit parameter
Use the API's native pagination when available. For APIs without it, implement local pagination. Always add a `limit` parameter with a sensible default (10-20 for lists, 50 for search). This prevents accidentally returning hundreds of items.

### Namespace by app
Prefix every tool name with the app name: `<app>_search_issues`, `<app>_get_thread`, `<app>_get_page`. This avoids collisions when multiple MCP servers are active.

### Return meaningful context
Return human-readable data: names, dates, durations, statuses — not raw UUIDs or internal IDs. Strip noise fields like `__typename`, internal tracking IDs, and empty optional fields. The LLM needs to answer the user's question directly from the tool response.

### Use resource_link for large payloads
Transcripts, documents, full exports — anything over ~8KB should be written to a file and returned as a `resource_link` URI. Always add an `inline` parameter via `INLINE_PARAM` from `output.js` so environments that cannot follow `resource_link` URIs can force content inline.

### Write descriptions like onboarding docs
Tool descriptions should explain what the tool does, when to use it, and what the output looks like. Use precise parameter names (`user_id` not `user`, `jql_query` not `query`). Include examples in parameter descriptions when the format is not obvious.

## Quick Mode (Single-String Batch)

Evaluate whether the app benefits from a quick-mode tool. Instead of structured JSON with arrays of objects, use a **single `commands` string parameter** with newline-separated shorthand commands. This is faster for the LLM to generate (less structured output, fewer tokens) and faster to parse.

### Design the command table

Define 1-3 letter abbreviations for each tool action. One command per line, arguments space-separated:

| Command | Action | Syntax | Example |
|---------|--------|--------|---------|
| `S` | Search | `S <query>` | `S status:open assignee:me` |
| `G` | Get detail | `G <id>` | `G PROJ-123` |
| `L` | List | `L <resource> [filters]` | `L members --active` |
| `U` | Update | `U <id> <field> <value>` | `U PROJ-123 status closed` |

The tool schema is just:

```json
{
  "name": "<app>_quick",
  "description": "Execute one or more commands. One per line. Commands: S <query> = search, G <id> = get detail, L <resource> = list, U <id> <field> <value> = update. See tool description for full command table.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "commands": {
        "type": "string",
        "description": "Newline-separated commands. Example:\nS status:open\nG PROJ-123\nG PROJ-456"
      }
    },
    "required": ["commands"]
  }
}
```

### Example usage

A search-then-detail workflow in one call:

```
S status:open assignee:me
G PROJ-123
G PROJ-456
```

### Output format

Return a `results` array with one entry per command, in order:

```json
{
  "ok": true,
  "results": [
    { "command": "S", "data": [ ... ] },
    { "command": "G", "data": { "id": "PROJ-123", ... } },
    { "command": "G", "data": { "id": "PROJ-456", ... } }
  ]
}
```

### Why single-string over structured JSON

- **Fewer output tokens**: `S status:open\nG PROJ-123` vs `{"operations":[{"action":"search","query":"status:open"},{"action":"get_detail","id":"PROJ-123"}]}`
- **Simpler schema**: One string param means the LLM spends less time on structural correctness
- **Faster generation**: Less structured output = fewer constrained-decoding steps
- **Easy to extend**: Adding a new command is one line in the parser, one row in the docs table

### Good candidates for quick mode
- Search-then-detail workflows (search returns IDs, immediately fetch details for top N)
- Dashboard data from multiple endpoints (aggregate stats from several API calls)
- Bulk lookups (get details for a list of known IDs)

### When NOT to add quick mode
- If the app only has 3-4 tools total — quick mode adds complexity without saving round-trips
- If each action requires different auth flows or long-running calls
- If responses are large — batching large responses into one call defeats file-based output
- If argument parsing is ambiguous (values with spaces that need complex quoting rules)

Only add quick mode if it genuinely saves round-trips for common workflows. Do not force it.

## Output Standardization

All tools return responses via `output.js`:

### buildResponse
Primary response builder. Auto-decides inline vs file based on response size:
```js
return output.buildResponse(data, {
  type: "search",      // Used in file naming
  id: args.query,      // Used in file naming (auto-sanitized)
  inline: args.inline, // Optional: force inline (only available when ALLOW_INLINE_LARGE=true)
  format: "json",      // "json" (default), "text", "markdown", "csv"
  forceFile: true,     // Optional: always write to file regardless of size
  summary: "Found 12 issues matching query"  // Brief summary for file-based responses
});
```

### When to force file output

Not all file-worthy responses are large. Some data is inherently **tabular or file-native** — it's more useful as a file the user can open, sort, filter, or pipe into other tools, even if it's under the 8KB inline threshold. Use `forceFile: true` for:

- **Tabular data** — lists of items with consistent columns (issues, contacts, transactions, time entries). A 3KB CSV of 20 rows is more useful as a file than as inline JSON.
- **Exports and reports** — CSV, TSV, or markdown tables that map to spreadsheet workflows
- **Structured documents** — meeting notes, changelogs, formatted summaries meant to be read outside the chat
- **Data the user will re-use** — anything they're likely to `cat`, `grep`, import, or attach elsewhere

When designing tools, tag each one with its expected output disposition:

| Output type | Disposition | Format |
|---|---|---|
| Single record detail | Inline | `json` |
| Short status / confirmation | Inline | `text` |
| List of records (>5 rows) | File | `csv` or `json` |
| Export / report | File | `csv` or `markdown` |
| Transcript / document | File | `markdown` or `text` |

Include this disposition in the tool design table so it's reviewed alongside the tool itself.

### set_output_dir
Every generated server includes a `set_output_dir` built-in tool. When large responses are saved to files, the `fileHint` tells the caller:
> "To access saved files, call set_output_dir to point output to your working directory, or read files from: <path>"

### ALLOW_INLINE_LARGE behavior
- **When off (default):** The `inline` parameter is omitted from tool schemas entirely. The agent never sees it. Large responses always go to files.
- **When on:** `INLINE_PARAM` is added to every app tool's schema. The agent can pass `inline: true` to force large content inline. Use this in Claude Chat or environments without filesystem access.

## Validate with User Flow Brainstorm (Subagent)

Before presenting the design, spawn an Opus subagent to brainstorm realistic user prompts that would exercise the tools. This catches coverage gaps before the user reviews.

```
Agent({
  description: "Brainstorm user flows for MCP tools",
  model: "opus",
  prompt: `You are validating an MCP tool design for <APP_DISPLAY_NAME> (<APP_DOMAIN>).

The app does: <1-2 sentence description of the app>.

Proposed tools:
<paste the tool design table here>

Generate 10-15 realistic prompts a user would type in Claude Code that would need these tools. Cover:
- Simple lookups ("show me my recent X")
- Search + drill-in ("find X matching Y, then get details on the first one")
- Cross-entity queries ("what's the status of all X in project Y?")
- Temporal queries ("what changed since last week?")
- Aggregation/summary ("summarize my activity this month")

For each prompt, note which tool(s) would be called and whether the current design handles it.

Output:
1. The prompts with tool mapping
2. GAPS: any prompts that the current tools cannot handle, with a suggested fix (new tool, additional parameter, or combine existing tools)

Keep it brief — bullet points, not essays.`
})
```

Review the subagent's gaps. If any are significant, adjust the tool design before presenting to the user. Minor gaps can be noted as future enhancements.

## Design Output Format

Produce a table mapping captured API operations to designed tools:

| HAR Operation(s) | Tool Name | What It Does | Output |
|---|---|---|---|
| `GET /api/issues`, `GET /api/issues/:id` | `<app>_search_issues` | Search issues by query. Returns key, summary, status, assignee. | File (csv) |
| `POST /graphql` (ProjectDetail, ProjectMembers) | `<app>_get_project` | Get project details including members and recent activity. | Inline (json) |
| `GET /api/export/csv` | `<app>_export_data` | Export data as CSV. Returns resource_link to saved file. | File (csv) |

### Get user feedback

Present the table and ask:
1. Does this cover your workflows?
2. Any common operations missing?
3. Any search-then-detail patterns we should combine into one tool?
4. Any tools here you would not use?

Incorporate feedback before moving to Stage 4.

## Gate Condition

**User has reviewed and approved the tool design table.** Do not start building until this is done. If the user requests changes, update the table and confirm again.
