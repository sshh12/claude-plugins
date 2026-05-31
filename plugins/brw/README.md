# brw

Browser automation plugin for Claude Code. Control a real Chrome browser via CLI commands — click, type, navigate, screenshot, read pages, and more.



https://github.com/user-attachments/assets/4f3ae6e4-f53e-4c57-9cea-48957bb82cf9



## Why brw?

- **Open and transparent**: Claude for Chrome is a black box requiring a subscription. brw is open source with full visibility into what's happening.
- **Agent-friendly architecture**: Playwright MCP and Chrome DevTools MCP servers weren't designed for parallel agent workflows — they struggle with multiple agents sharing one browser. brw uses a proxy with per-tab mutexes, stateless CLI commands, and structured JSON output built for concurrent agent access.
- **Lightweight**: No heavy MCP server overhead. A single proxy manages Chrome, and each CLI call is a simple request over a per-user Unix socket.

## What it does

Gives Claude Code agents the ability to interact with web browsers through a CLI tool (`brw`) backed by Chrome DevTools Protocol. A proxy server manages the Chrome instance and handles concurrent access from multiple agents.

**Capabilities:**
- Screenshots (viewport, full-page, element-level), clicks, typing, keyboard shortcuts, scrolling, dragging
- Page accessibility tree reading with element refs and text search filtering
- Form filling (by ref or CSS selector), text extraction, JavaScript execution
- Conditional waiting (`wait-for` selector/text/URL/JS condition)
- Tab management (create, switch, close, list); per-tab viewport override at creation
- Iframe targeting for read-page, JS execution, and form input
- Browser dialog handling (alert, confirm, prompt) with auto-dismiss
- Console and network monitoring, response body inspection (with inline body previews + status/url filtering)
- **Script-driven data extraction**: `script run` evaluates a `.js` file in the page's runtime (cookies + CSRF + auth available); `script gen` produces a fetch-based starter from captured network requests. Useful for paginating an inbox, exporting history, scraping behind login.
- **Credential discovery**: `auth-tokens` enumerates session cookies / localStorage / sessionStorage / captured Authorization headers, decodes JWT claims, optionally fires a probe to confirm login state
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
- "Pull a list of all my LinkedIn messages into a JSON file" — uses the script feature: capture the API call, generate a fetch-based starter, paginate, save structured data. See `skills/brw/references/SCRIPT-WORKFLOW.md`.

## Configuration

Configuration is resolved in priority order: env vars > `.claude/brw.json` (repo-local) > `~/.config/brw/config.json` (user) > defaults.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BRW_SOCKET` | `~/.config/brw/proxy.sock` | Proxy Unix domain socket path |
| `BRW_DATA_DIR` | `~/.config/brw/chrome-data` | Chrome profile directory |
| `BRW_CHROME_PATH` | Auto-detect | Path to browser binary |
| `BRW_HEADLESS` | `false` | Run headless (no visible window) |
| `BRW_SCREENSHOT_DIR` | `~/.config/brw/screenshots` | Screenshot output directory |
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
Claude Agent ──unix sock (0600)──→ Proxy Server ──FD pipe──→ Chrome
              (~/.config/brw/proxy.sock)          (--remote-debugging-pipe)
```

There is no TCP anywhere. The CLI talks to the proxy over a per-user Unix domain socket (mode `0600`) at `~/.config/brw/proxy.sock`, and the proxy talks to Chrome over `--remote-debugging-pipe` (inherited FDs 3/4 — no debugging port). The socket permissions plus the inherited pipe FDs give OS-enforced per-user isolation, so no other user (or process outside the proxy) can reach the browser.

- **Proxy server**: Auto-launches on first CLI call. Manages Chrome lifecycle, CDP connections over the pipe, tab state, and per-tab mutexes for safe concurrent access. A server restart relaunches Chrome — open tabs are lost, but logins persist via the on-disk profile.
- **CLI (`brw`)**: Stateless — each call sends a request over the Unix socket and prints the result. Mutation commands auto-return a screenshot.
- **Multi-agent**: Multiple agents share one Chrome/proxy instance, isolated by tabs.
