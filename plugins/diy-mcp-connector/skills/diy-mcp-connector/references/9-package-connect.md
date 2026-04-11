# Stage 9: Package & Connect

The connector you built runs anywhere that supports MCP servers. This stage covers connecting to the most common targets: Claude Code, Claude Desktop (Cowork), OpenClaw, and other MCP clients.

**Important:** Even if you're running inside Claude Code, always ask the user if they'd like help connecting the server to other tools too — e.g. *"I've added the server to Claude Code. Would you also like me to set it up for Cowork, OpenClaw, or any other MCP client?"* Most users have more than one MCP-capable tool and will appreciate the offer.

---

## Option A: Claude Code

Register the MCP server directly:

```bash
claude mcp add <app> node /absolute/path/to/<app>/server/index.js
```

The server runs as a stdio process — Claude Code launches it automatically when you start a session.

### Adding env vars

Pass environment variables with the `-e` flag:

```bash
# Enable inline for environments without file access
claude mcp add <app> -e ALLOW_INLINE_LARGE=true node /absolute/path/to/<app>/server/index.js

# Multiple env vars
claude mcp add <app> \
  -e ALLOW_INLINE_LARGE=true \
  -e INCLUDE_DEBUG_TOOLS=true \
  node /absolute/path/to/<app>/server/index.js
```

---

## Option B: Claude Desktop / Cowork

There are three ways to install on Claude Desktop (Cowork):

### B1: Package as .mcpb extension (recommended)

Create a `manifest.json` in the project root:

```json
{
  "manifest_version": "0.3",
  "name": "<app>",
  "version": "1.0.0",
  "display_name": "<App Name>",
  "description": "MCP tools for <App Name>",
  "author": { "name": "<your name>" },
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"],
      "env": {
        "ALLOW_INLINE_LARGE": "${user_config.allow_inline_large}",
        "MCP_OUTPUT_DIR": "${user_config.output_dir}"
      }
    }
  },
  "user_config": {
    "allow_inline_large": {
      "type": "boolean",
      "title": "Allow Inline Large Responses",
      "description": "Enable this if you're using the connector from Claude Chat or another non-coding tool where Claude can't open files on your computer. When off (default), large results are saved as files — which works great in Claude Code and Cowork but not in chat-only environments.",
      "default": false
    },
    "output_dir": {
      "type": "directory",
      "title": "Output Directory",
      "description": "Where large responses are saved as files",
      "required": false
    }
  },
  "tools": [
    { "name": "set_output_dir", "description": "Change output directory at runtime" }
  ]
}
```

Add your app-specific tools to the `tools` array. Then validate and pack:

```bash
npm install --production
npx @anthropic-ai/mcpb validate manifest.json
npx @anthropic-ai/mcpb pack .
```

This produces a `<app>-1.0.0.mcpb` file. Install it in Cowork by either:
- **Double-clicking** the `.mcpb` file, or
- **Settings > Extensions > Advanced settings > Install Extension** and selecting the file

### B2: Edit claude_desktop_config.json directly

If extension installation is blocked, add the server manually:

```json
{
  "mcpServers": {
    "<app>": {
      "command": "node",
      "args": ["/absolute/path/to/<app>/server/index.js"],
      "env": {
        "ALLOW_INLINE_LARGE": "true",
        "MCP_OUTPUT_DIR": "/path/to/output"
      }
    }
  }
}
```

Config file location:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

### B3: Cowork MCP settings UI

1. Open Cowork settings
2. Add a new MCP server entry
3. Set command to `node` with arg `/absolute/path/to/<app>/server/index.js`
4. Add environment variables as needed

---

## Option C: OpenClaw

[OpenClaw](https://docs.openclaw.ai) is an MCP client that maintains a centralized registry of MCP servers. Register the connector so any OpenClaw-launched runtime can use it:

```bash
openclaw mcp set <app> '{"command":"node","args":["/absolute/path/to/<app>/server/index.js"]}'
```

With environment variables:

```bash
openclaw mcp set <app> '{"command":"node","args":["/absolute/path/to/<app>/server/index.js"],"env":{"ALLOW_INLINE_LARGE":"true"}}'
```

Verify it was added:

```bash
openclaw mcp list
openclaw mcp show <app>
```

OpenClaw manages configuration only — it does not validate connectivity. After registering, launch a session through OpenClaw and verify tools appear and respond.

---

## Option D: Other MCP clients

Any application that supports the MCP protocol can use the connector. The server speaks stdio JSON-RPC — the client just needs to launch `node server/index.js` and communicate over stdin/stdout.

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `MCP_OUTPUT_DIR` | `~/.diy-mcp/<app>/output` | Override where large responses are saved. |
| `MCP_INLINE_THRESHOLD` | `8192` | Byte threshold for auto-filing responses. |
| `ALLOW_INLINE_LARGE` | `"false"` | Show `inline` param in tool schemas so agents can force large responses inline. |
| `INCLUDE_DEBUG_TOOLS` | `"false"` | Expose `<app>_debug_env` tool for troubleshooting. |

### When to enable ALLOW_INLINE_LARGE

- **Claude Code or Cowork:** Leave off (default). These are coding/agent environments where Claude can read files from your computer. Large results get saved as files, and Claude reads them when needed.
- **Claude Chat, API, or other non-coding tools:** Turn on. In these environments Claude can't open files on your machine, so large results need to come back directly in the conversation. The tradeoff is longer messages when responses are big.

---

## Verification

After connecting (via any method), verify end-to-end:

1. **Tools appear:** Check the MCP server is listed and your tools show up.
2. **Tools respond:** Ask a question that triggers a tool call. Verify real data comes back.
3. **Auth works:** First run should open Chrome for login. Subsequent calls reuse cookies.
4. **Output dir works:** Call `set_output_dir`, trigger a large response, verify the file appears.

## Gate Condition

**Tools appear in the client's tool list and return correct data when called.** The server starts without errors, authenticates successfully, and produces accurate responses. Verify at least one tool end-to-end before considering the integration complete.
