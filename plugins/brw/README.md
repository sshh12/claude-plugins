# brw

Browser automation plugin for Claude Code. Control a real Chrome browser via CLI commands — click, type, navigate, screenshot, read pages, and more.

## Why brw?

- **Open and transparent**: Claude for Chrome is a black box requiring a subscription. brw is open source with full visibility into what's happening.
- **Agent-friendly architecture**: Playwright MCP and Chrome DevTools MCP servers weren't designed for parallel agent workflows — they struggle with multiple agents sharing one browser. brw uses a proxy with per-tab mutexes, stateless CLI commands, and structured JSON output built for concurrent agent access.
- **Lightweight**: No heavy MCP server overhead. A single proxy manages Chrome, and each CLI call is a simple HTTP request.

## What it does

Gives Claude Code agents the ability to interact with web browsers through a CLI tool (`brw`) backed by Chrome DevTools Protocol. A proxy server manages the Chrome instance and handles concurrent access from multiple agents.

**Capabilities:**
- Screenshots (viewport, full-page, element-level), clicks, typing, keyboard shortcuts, scrolling, dragging
- Page accessibility tree reading with element refs and text search filtering
- Form filling (by ref or CSS selector), text extraction, JavaScript execution
- Conditional waiting (`wait-for` selector/text/URL/JS condition)
- Tab management (create, switch, close, list)
- Iframe targeting for read-page, JS execution, and form input
- Browser dialog handling (alert, confirm, prompt) with auto-dismiss
- Console and network monitoring, response body inspection
- Network request interception and mocking
- Cookie and localStorage/sessionStorage management
- GIF recording of browser actions with click/drag overlays
- Device/viewport emulation, geolocation, timezone, dark mode
- PDF export, performance metrics, download tracking
- Quick mode for batching multiple actions in one call
- URL allowlisting for restricting navigation scope
- JSON output by default with page fingerprinting for navigation detection

## Requirements

- **Node.js 18+**
- **A Chromium-based browser** (Chrome, Chromium, Edge, or Brave)

## Install

### From the marketplace

```bash
# Add the marketplace (if not already added)
/plugin marketplace add sshh12/claude-plugins

# Install the plugin
/plugin install brw@shrivu-plugins
```

### For development

```bash
claude --plugin-dir ./plugins/brw
```

## Usage

Once installed, Claude will automatically use `brw` when you ask it to interact with websites. You can also invoke the skill directly:

```
/brw:brw
```

### Example prompts

- "Go to example.com and take a screenshot"
- "Fill out the login form on localhost:3000 with test credentials"
- "Navigate to our staging app and check if the signup flow works"
- "Record a GIF of the checkout process on our dev server"
- "Test the mobile layout of our landing page"

## Configuration

Configuration is resolved in priority order: env vars > `.claude/brw.json` (repo-local) > `~/.config/brw/config.json` (user) > defaults.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRW_PORT` | `9225` | Proxy server port |
| `BRW_CDP_PORT` | `9222` | Chrome debugging port |
| `BRW_DATA_DIR` | `~/.config/brw/chrome-data` | Chrome profile directory |
| `BRW_CHROME_PATH` | Auto-detect | Path to browser binary |
| `BRW_HEADLESS` | `false` | Run headless (no visible window) |
| `BRW_SCREENSHOT_DIR` | `/tmp/brw-screenshots` | Screenshot output directory |
| `BRW_ALLOWED_URLS` | `*` | Comma-separated URL glob patterns |

### Per-project config (`.claude/brw.json`)

Restrict agents to your dev server and configure the browser per-project:

```json
{
  "allowedUrls": ["http://localhost:*", "https://staging.myapp.com/*"],
  "chromeDataDir": "./.chrome-data",
  "headless": true
}
```

### Debug config

```bash
brw config
```

Shows every resolved config value and where it came from (env, repo config, user config, or default).

## Architecture

```
Claude Agent ──HTTP──→ Proxy Server ──CDP/WS──→ Chrome
                       (localhost:9225)          (localhost:9222)
```

- **Proxy server**: Auto-launches on first CLI call. Manages Chrome lifecycle, CDP connections, tab state, and per-tab mutexes for safe concurrent access.
- **CLI (`brw`)**: Stateless — each call sends an HTTP request to the proxy and prints the result. Mutation commands auto-return a screenshot.
- **Multi-agent**: Multiple agents share one Chrome/proxy instance, isolated by tabs.