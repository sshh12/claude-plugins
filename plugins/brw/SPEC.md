# Browser Plugin Spec

A Claude Code plugin that provides browser automation via a CLI tool backed by Chrome DevTools Protocol (CDP). Designed to give Claude Code agents full browser interaction capabilities similar to the Chrome extension, but running a standalone Chrome instance with remote debugging.

## Architecture

```
┌────────────────┐      HTTP       ┌─────────────────┐     CDP/WS     ┌──────────┐
│  Claude Agent   │───────────────→│                  │──────────────→│          │
│  (calls CLI)    │                │  Browser Proxy   │               │  Chrome  │
│                 │←───────────────│  Server           │←──────────────│  (CDP)   │
├────────────────┤                │  (localhost:9225) │               │          │
│  Claude Agent   │───────────────→│                  │               │          │
│  (calls CLI)    │←───────────────│                  │               │          │
└────────────────┘                └─────────────────┘               └──────────┘
```

### Components

1. **Browser Proxy Server** — A long-running local HTTP server that:
   - Launches and manages a Chrome instance with `--remote-debugging-port`
   - Maintains CDP WebSocket connections
   - Serves a REST API for browser operations
   - Handles concurrent requests from multiple agents
   - Maintains per-page state (element ref maps, console logs, network requests)

2. **CLI Tool** (`brw`) — A stateless command-line interface that:
   - Sends HTTP requests to the proxy server
   - Auto-starts the proxy server if not running
   - Maps subcommands to browser operations
   - Returns structured output (JSON or plain text)
   - Saves screenshots to disk, returns file paths
   - Mutation commands auto-return a screenshot (see Output Design for full list)

3. **Claude Code Plugin** — A skill-based plugin that:
   - Teaches Claude how to use the CLI for browser automation
   - Provides a `browser` skill with detailed instructions
   - Bundled as a marketplace plugin

## Technology

- **Language**: TypeScript (Node.js)
- **CDP Library**: Direct CDP via `chrome-remote-interface` (low-level control, no Puppeteer abstraction layer)
- **HTTP Server**: Fastify (lightweight, fast)
- **CLI Framework**: Commander.js
- **Distribution**: Bundled within the plugin itself under `scripts/`. The CLI is a self-contained Node.js script with inline dependencies (using a bundler like `esbuild` to produce a single `.js` file). The skill instructs Claude to run it via `node ${SKILL_DIR}/scripts/brw.js <command>`, aliased as `brw` in the skill instructions.
- **Binary name in skill context**: `brw` (the SKILL.md defines it as `brw` but refers to it as `brw` in examples for brevity)

## Browser Proxy Server

### Lifecycle

1. **Auto-start**: When the CLI runs and no proxy is detected (health check on `localhost:9225/health`), it spawns the proxy as a background daemon process.
2. **Chrome launch**: On first request (or at startup), the proxy launches Chrome:
   ```
   chrome --remote-debugging-port=9222 \
          --user-data-dir=<configurable> \
          --no-first-run \
          --no-default-browser-check \
          --disable-background-timer-throttling \
          --disable-backgrounding-occluded-windows \
          --window-size=1280,800
   ```
3. **Connection**: Proxy connects to Chrome via CDP WebSocket on `localhost:9222`.
4. **Shutdown**: `brw server stop` sends a shutdown signal. Proxy closes Chrome and exits. Also exits if idle for a configurable timeout (default: 30 minutes).

### Configuration

Configuration is resolved in this priority order (highest wins):
1. **Environment variables** (`BRW_*`)
2. **Repo-local config** (`.claude/brw.json` in the current working directory)
3. **User config** (`~/.config/brw/config.json`)
4. **Defaults**

| Config | Env Var | Default | Description |
|--------|---------|---------|-------------|
| `proxyPort` | `BRW_PORT` | `9225` | Port for the proxy HTTP server |
| `cdpPort` | `BRW_CDP_PORT` | `9222` | Chrome remote debugging port |
| `chromeDataDir` | `BRW_DATA_DIR` | `~/.config/brw/chrome-data` | Chrome user data directory |
| `chromePath` | `BRW_CHROME_PATH` | Auto-detect | Path to Chrome/Chromium/Edge/Brave binary |
| `headless` | `BRW_HEADLESS` | `false` | Run Chrome in headless mode (default: headed) |
| `screenshotDir` | `BRW_SCREENSHOT_DIR` | `/tmp/brw-screenshots` | Where to save screenshots |
| `idleTimeout` | `BRW_IDLE_TIMEOUT` | `1800` (seconds) | Shutdown after idle period |
| `windowWidth` | `BRW_WIDTH` | `1280` | Default browser window width |
| `windowHeight` | `BRW_HEIGHT` | `800` | Default browser window height |
| `allowedUrls` | `BRW_ALLOWED_URLS` | `*` (all) | URL allowlist — comma-separated glob patterns |

#### Repo-local config (`.claude/brw.json`)

Projects can include a `.claude/brw.json` file to set per-repo defaults. This is especially useful for:
- Restricting which URLs agents can navigate to (e.g., only the project's dev server)
- Setting a custom Chrome data dir for the project
- Overriding headless/headed mode

Example `.claude/brw.json`:
```json
{
  "allowedUrls": ["https://localhost:*", "https://staging.myapp.com/*"],
  "chromeDataDir": "./.chrome-data",
  "headless": true
}
```

This file can be committed to the repo (shared with team) or gitignored (local only).

#### URL Allowlist

The `allowedUrls` config restricts which URLs the browser can navigate to. When set, any `navigate` command (or `N` quick command) to a URL not matching the allowlist is rejected with an error.

**Format**: Array of glob patterns (or comma-separated string in env var).

| Pattern | Matches |
|---------|---------|
| `*` | Everything (default — no restrictions) |
| `https://localhost:*` | Any localhost HTTPS URL on any port |
| `https://*.myapp.com/*` | Any subdomain of myapp.com |
| `https://example.com/app/*` | Only paths under /app/ on example.com |
| `http://localhost:3000/*` | Specific dev server |

**Behavior**:
- Checked on `navigate`, `new-tab` (with URL), and `N`/`NT` quick commands
- Does NOT block JS-initiated navigations (e.g., `window.location = ...`) — those happen inside the page context and can't be intercepted pre-navigation. However, the proxy can optionally check the URL after navigation and warn if it's outside the allowlist.
- When blocked: returns error `"URL https://evil.com is not in the allowlist. Allowed: https://localhost:*, https://staging.myapp.com/*"`
- Empty array `[]` blocks all navigation (useful if you only want to interact with the current page)

### Browser Detection

Auto-detects Chromium-based browsers in this priority order:
1. `BRW_CHROME_PATH` env var (explicit override)
2. Google Chrome
3. Chromium
4. Microsoft Edge
5. Brave Browser

Search paths vary by platform (macOS `/Applications`, Linux `/usr/bin`, Windows `Program Files`).

### REST API

All endpoints accept/return JSON. The CLI is a thin wrapper around these.

```
POST /api/screenshot          → capture screenshot
POST /api/click               → mouse click
POST /api/hover               → mouse hover
POST /api/type                → type text
POST /api/key                 → press keys
POST /api/scroll              → scroll
POST /api/drag                → drag
POST /api/navigate            → navigate to URL
POST /api/read-page           → accessibility tree
POST /api/form-input          → set form value
POST /api/get-text            → extract page text
POST /api/js                  → execute JavaScript
POST /api/console             → read console messages
POST /api/network             → read network requests
POST /api/resize              → resize window
POST /api/file-upload         → upload file to input
GET  /api/tabs                → list all tabs
POST /api/tabs/new            → create new tab
POST /api/tabs/switch         → switch active tab
POST /api/wait-for            → conditional wait
POST /api/dialog              → handle browser dialogs
POST /api/scroll-to           → scroll element into view
POST /api/cookies             → list/get/set/delete cookies
POST /api/storage             → localStorage/sessionStorage operations
POST /api/network-body        → get response body for a request
POST /api/intercept           → add/remove/list network interception rules
POST /api/pdf                 → save page as PDF
POST /api/emulate             → set device/viewport/media emulation
GET  /api/perf                → performance metrics
POST /api/tabs/close          → close a tab
POST /api/quick               → execute quick mode commands
POST /api/gif/start           → start GIF recording
POST /api/gif/stop            → stop GIF recording
POST /api/gif/export          → export recorded frames as GIF
POST /api/gif/clear           → discard recorded frames
GET  /health                  → health check
POST /shutdown                → stop server and Chrome
```

### Concurrency Model

- CDP is message-based and supports interleaving, but screenshots require exclusive access to avoid capturing mid-action states.
- The proxy uses a **per-tab mutex** for operations that modify state (click, type, navigate) or capture state (screenshot).
- Read-only operations (read-page, get-text, tabs list) can proceed concurrently.
- If two agents need isolation, they should work on separate tabs.

### State Management

The proxy maintains:
- **Tab registry**: Map of tab IDs to CDP targets
- **Element ref maps**: Per-tab WeakRef-style element maps for `ref` IDs (injected via `Runtime.evaluate`)
- **Console buffer**: Per-tab ring buffer of console messages (last 1000)
- **Network buffer**: Per-tab ring buffer of network requests (last 1000)
- **Active tab**: Default tab for commands that omit `--tab`

## CLI Reference

### Global Flags

```
--tab, -t <id>         Target tab ID (default: active tab)
--text                 Output as plain text instead of JSON (for human debugging)
--timeout <seconds>    CLI request timeout (default: 30)
--debug                Verbose logging to stderr (HTTP requests, CDP commands)
--port <port>          Proxy server port (default: 9225)
```

### Output Design

**JSON by default.** All commands output JSON to stdout. Use `--text` for human-readable plain text. This makes output reliably parseable by agents without ambiguity.

**Standard envelope:**

```jsonc
// Success (mutation commands — include screenshot)
{"ok": true, "screenshot": "/tmp/brw-screenshots/123.png"}

// Success (mutation commands — with extra data)
{"ok": true, "screenshot": "/tmp/brw-screenshots/123.png", "url": "https://...", "title": "..."}

// Success (read-only commands — no screenshot)
{"ok": true, "result": ...}

// Error
{"ok": false, "error": "Tab 99999 not found", "code": "TAB_NOT_FOUND", "hint": "Available tabs: 1, 2, 3"}
```

**Rules:**
- `ok` is always present (boolean)
- `screenshot` is present on all mutation commands unless `--no-screenshot` is passed. Mutation commands: click, hover, type, key, scroll, scroll-to, navigate, drag, form-input, resize, wait, wait-for, file-upload, dialog (accept/dismiss), switch-tab, quick.
- `page` object (`{url, title, contentLength}`) is present on all mutation commands, enabling agents to detect unexpected navigations between commands
- `error` + `code` + `hint` are present on failures. `code` is a machine-readable constant. `hint` provides actionable recovery guidance.
- Read-only commands (read-page, get-text, js, tabs, console, network, cookies, storage, perf, config) return data in command-specific top-level keys. These do NOT include `screenshot` or `page`.

**Page fingerprint** (included in every response for the active tab):
```json
{"ok": true, "screenshot": "...", "page": {"url": "https://example.com", "title": "Example", "contentLength": 48230}}
```
If an agent notices `page.url` changed unexpectedly between commands, it should re-screenshot before acting.

**Exit codes:**

| Code | Meaning | Example |
|------|---------|---------|
| 0 | Success | Command completed normally |
| 1 | Usage/argument error | Missing required arg, unknown flag |
| 2 | Proxy connection error | Proxy not running, timeout, auto-start failed |
| 3 | Browser/CDP error | Chrome crashed, target closed, CDP command failed |
| 4 | URL blocked | Navigation blocked by allowlist |

**Per-command output reference:**

Mutation commands return `ok` + `screenshot` + `page`. Read-only commands return `ok` + command-specific fields.

| Command | Type | Key fields |
|---------|------|------------|
| `screenshot` | mutation | `screenshot` |
| `click` | mutation | `screenshot`, `download` (if triggered) |
| `hover` | mutation | `screenshot` |
| `type` | mutation | `screenshot` |
| `key` | mutation | `screenshot` |
| `scroll` | mutation | `screenshot` |
| `scroll-to` | mutation | `screenshot` |
| `drag` | mutation | `screenshot` |
| `navigate` | mutation | `screenshot`, `download` (if triggered) |
| `wait` | mutation | `screenshot` |
| `wait-for` | mutation | `screenshot`, `matched` (bool), `elapsed` (ms) |
| `form-input` | mutation | `screenshot` |
| `resize` | mutation | `screenshot`, `width`, `height` |
| `file-upload` | mutation | `screenshot`, `files` (uploaded filenames) |
| `switch-tab` | mutation | `screenshot`, `tabId` |
| `dialog` | mutation | `screenshot`, `dialogType`, `message`, `action` |
| `quick` | mutation | `screenshot`, `results` (array of intermediate outputs from LT, J, etc.) |
| `read-page` | read | `tree` (string), `refCount` (int) |
| `get-text` | read | `title`, `url`, `text` |
| `js` | read | `result` (serialized JS return value) |
| `tabs` | read | `tabs` (array of `{id, url, title}`), `activeTab` (id) |
| `new-tab` | read | `tabId`, `url` |
| `close-tab` | read | `tabs` (updated list) |
| `console` | read | `messages` (array of `{level, text, timestamp, source}`) |
| `network` | read | `requests` (array of `{id, method, url, status, duration, size}`) |
| `network-body` | read | `body` (string), `base64` (bool), `mimeType` |
| `cookies` | read | `cookies` (array) or `cookie` (single) |
| `cookies get` | read | `cookie` (object) |
| `cookies set` | write | *(ok only)* |
| `cookies delete` | write | *(ok only)* |
| `cookies clear` | write | *(ok only)* |
| `storage get` | read | `value` |
| `storage list` | read | `entries` (object) |
| `storage set` | write | *(ok only)* |
| `storage delete` | write | *(ok only)* |
| `storage clear` | write | *(ok only)* |
| `intercept add` | write | `ruleId` |
| `intercept list` | read | `rules` (array of `{id, pattern, action, ...}`) |
| `intercept remove` | write | *(ok only)* |
| `intercept clear` | write | *(ok only)* |
| `pdf` | read | `path` |
| `emulate` | write | `active` (current emulation settings) |
| `emulate reset` | write | `active: null` |
| `perf` | read | `metrics` (object with named values) |
| `gif start` | write | `recording: true` |
| `gif stop` | write | `recording: false`, `frames` (count) |
| `gif export` | read | `path`, `frames`, `duration` (seconds) |
| `gif clear` | write | `cleared: true` |
| `config` | read | Full config object with sources (`--text` for pretty table) |
| `server start` | write | `pid`, `port` |
| `server stop` | write | *(ok only)* |
| `server status` | read | `running` (bool), `pid`, `port`, `chromeVersion` |

### Commands

#### `brw screenshot`

Capture a screenshot of the current page.

```bash
brw screenshot [--tab ID] [--region x1,y1,x2,y2] [--ref REF] [--full-page]
```

| Flag | Description |
|------|-------------|
| `--region` | Crop to bounding box `x1,y1,x2,y2` (CSS pixels) |
| `--ref` | Screenshot a single element's bounding box (from `read-page` ref) |
| `--full-page` | Capture the entire scrollable page, not just the viewport |

Implementation:
- `Page.captureScreenshot` via CDP
- Downscales Retina displays (devicePixelRatio normalization)
- Applies token-optimized resizing: max 1568px on longest side, minimum 28px per meaningful unit
- `--region` crops to bounding box (like the chrome extension's `zoom` action)
- `--ref` resolves element, gets bounding rect via `Runtime.evaluate`, then crops
- `--full-page` uses `captureBeyondViewport: true` with full page dimensions

---

#### `brw click`

Click at coordinates or element ref.

```bash
brw click <x> <y> [--tab ID] [--right] [--double] [--triple] [--modifiers MODS]
brw click --ref <ref_id> [--tab ID] [--right] [--double] [--triple] [--modifiers MODS]
brw click --selector <css> [--tab ID] [--right] [--double] [--triple] [--modifiers MODS]
```

| Flag | Description |
|------|-------------|
| `--ref` | Click element by ref ID (from `read-page`) |
| `--selector` | Click element by CSS selector (skips `read-page` round-trip) |
| `--right` | Right click |
| `--double` | Double click |
| `--triple` | Triple click |
| `--modifiers` | Modifier keys (e.g., `shift`, `ctrl+shift`) |

Implementation:
- Resolves `--ref` to coordinates via element map
- `Input.dispatchMouseEvent`: `mouseMoved` → `mousePressed` → `mouseReleased`
- 100ms delay before click for visual targeting
- Returns screenshot path after click

---

#### `brw hover`

Hover at coordinates.

```bash
brw hover <x> <y> [--tab ID]
brw hover --ref <ref_id> [--tab ID]
brw hover --selector <css> [--tab ID]
```

Implementation: `Input.dispatchMouseEvent` type `mouseMoved`. `--ref` and `--selector` resolve to center coordinates of the element.

---

#### `brw type`

Type text into the focused element.

```bash
brw type <text> [--tab ID] [--clear]
```

| Flag | Description |
|------|-------------|
| `--clear` | Select all existing content and replace it (Ctrl+A, Delete, then type). Equivalent to Playwright's `fill()`. |

Implementation:
- Character-by-character via `Input.insertText`
- Supports multi-line text (newlines become Enter keypresses)
- `--clear`: dispatches `Ctrl+A` then `Delete` before typing

---

#### `brw key`

Press keyboard keys/shortcuts.

```bash
brw key <keys> [--tab ID] [--repeat N]
```

Examples:
```bash
brw key Enter
brw key "cmd+a"
brw key "ctrl+shift+k"
brw key Tab --repeat 3
```

Implementation: `Input.dispatchKeyEvent` with proper keyDown/keyUp sequences. Key names match Chrome extension conventions.

---

#### `brw scroll`

Scroll the page.

```bash
brw scroll <direction> [--amount N] [--at X,Y] [--tab ID]
```

| Arg/Flag | Description |
|----------|-------------|
| `direction` | `up`, `down`, `left`, `right` |
| `--amount` | Scroll ticks 1-10 (default: 3) |
| `--at` | Scroll at specific coordinates (default: center of viewport) |

Implementation: `Input.dispatchMouseEvent` type `mouseWheel`, delta = amount × 100

---

#### `brw scroll-to`

Scroll an element into view.

```bash
brw scroll-to --ref <ref_id> [--tab ID]
brw scroll-to --selector <css> [--tab ID]
```

Implementation: Resolves ref or selector via element map / `document.querySelector`, calls `Element.scrollIntoView({ behavior: 'smooth', block: 'center' })` via `Runtime.evaluate`. Useful before interacting with off-screen elements (though `click --ref` and `form-input` already scroll into view automatically).

---

#### `brw drag`

Drag from one point to another.

```bash
brw drag <x1> <y1> <x2> <y2> [--tab ID]
brw drag --from-ref <ref> --to-ref <ref> [--tab ID]
brw drag --from-ref <ref> <x2> <y2> [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--from-ref` | Start drag from element center (by ref ID) |
| `--to-ref` | End drag at element center (by ref ID) |

Implementation: `mouseMoved` → `mousePressed` → `mouseMoved` (interpolated) → `mouseReleased`. Refs resolve to element center coordinates.

---

#### `brw navigate`

Navigate to a URL or use browser history.

```bash
brw navigate <url|back|forward> [--tab ID] [--wait STRATEGY]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--wait` | `dom` | Wait strategy: `none` (return immediately), `dom` (DOMContentLoaded), `network` (network idle for 500ms) |

Examples:
```bash
brw navigate "https://google.com"
brw navigate "https://spa-app.com" --wait network
brw navigate back
```

Implementation:
- URLs: `Page.navigate` (auto-prepends `https://` if no protocol)
- `back`/`forward`: `Page.navigateToHistoryEntry` via history API
- Wait strategies: `none` = fire and forget, `dom` = wait for `DOMContentLoaded`, `network` = wait for network idle (no requests for 500ms)

---

#### `brw read-page`

Extract the accessibility tree of the current page.

```bash
brw read-page [--filter interactive|all] [--depth N] [--ref REF] [--max-chars N] [--search TEXT] [--frame INDEX|NAME] [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--filter` | `all` | `interactive` = only interactive elements; `all` = full tree including headings, text, regions |
| `--depth` | `15` | Max tree traversal depth |
| `--ref` | — | Scope to children of this ref ID |
| `--max-chars` | `50000` | Truncate output |
| `--search` | — | Filter tree to elements whose name/text contains this string (case-insensitive). Dramatically reduces output tokens on complex pages. |
| `--frame` | — | Target an iframe by index (0-based), name, or URL substring. Without this, only the main frame is read. |

**Output**: Hierarchical accessibility tree with ref IDs, roles, names, states.

Implementation:
- Injects accessibility tree extraction script via `Runtime.evaluate`
- Assigns persistent ref IDs (`ref_1`, `ref_2`, ...) stored in `window.__brwElementMap` using WeakRef
- Maps DOM elements to ARIA roles
- Extracts accessible names from: `aria-label`, `placeholder`, `title`, `alt`, associated `<label>`, text content
- For `<select>`: lists all options with selection state

---

#### `brw form-input`

Set a form element's value using a ref ID.

```bash
brw form-input --ref <ref_id> --value <value> [--tab ID] [--frame INDEX|NAME]
brw form-input --selector <css> --value <value> [--tab ID] [--frame INDEX|NAME]
```

Implementation:
- Resolves ref via `window.__brwElementMap`
- Scrolls element into view
- Sets value based on element type (input, select, checkbox, radio, contenteditable)
- Dispatches `change` and `input` events with bubbling

---

#### `brw get-text`

Extract the text content of the page.

```bash
brw get-text [--max-chars N] [--tab ID]
```

**Output**: Page title, URL, and extracted text content.

Implementation:
- Priority-ordered content extraction: `article`, `main`, `[role="main"]`, `.content`, `#content`, `body`
- Strips navigation, ads, sidebars where possible
- Default max 50,000 chars

---

#### `brw js`

Execute JavaScript in the page context.

```bash
brw js <code> [--tab ID] [--frame INDEX|NAME]
```

Examples:
```bash
brw js "document.title"
brw js "document.querySelectorAll('a').length"
brw js "document.querySelector('iframe').contentDocument.title" # or use --frame
```

Implementation: `Runtime.evaluate` with `awaitPromise: true` for async code. Returns the serialized result. `--frame` targets an iframe's execution context via `Page.getFrameTree` + `Runtime.evaluate` on the frame's context.

---

#### `brw console`

Read browser console messages.

```bash
brw console [--tab ID] [--errors-only] [--clear] [--pattern REGEX] [--limit N]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--errors-only` | `false` | Only show errors |
| `--clear` | `false` | Clear buffer after reading |
| `--pattern` | — | Regex filter on message text |
| `--limit` | `100` | Max messages to return |

Implementation: Proxy captures `Runtime.consoleAPICalled` and `Runtime.exceptionThrown` events into a per-tab ring buffer.

---

#### `brw network`

Read captured network requests.

```bash
brw network [--tab ID] [--url-pattern PATTERN] [--clear] [--limit N]
```

Implementation: Proxy captures `Network.requestWillBeSent` and `Network.responseReceived` events. Returns method, URL, status, timing.

---

#### `brw resize`

Resize the browser window.

```bash
brw resize <width> <height> [--tab ID]
```

Implementation: `Emulation.setDeviceMetricsOverride` or `Browser.setWindowBounds`

---

#### `brw file-upload`

Upload files to a file input element.

```bash
brw file-upload --ref <ref_id> --files <path1> [<path2> ...] [--tab ID]
```

Implementation: `DOM.setFileInputFiles` via CDP. Does not click the input (avoids native file dialog).

---

#### `brw tabs`

List all open tabs.

```bash
brw tabs
```

**Output**: Tab ID, URL, title for each tab.

---

#### `brw new-tab`

Open a new tab.

```bash
brw new-tab [url]
```

**Output**: New tab ID.

Implementation: `Target.createTarget` with optional URL.

---

#### `brw switch-tab`

Switch the active/default tab.

```bash
brw switch-tab <tab_id>
```

Implementation: `Target.activateTarget`, updates proxy's active tab state. Auto-returns a screenshot of the newly active tab so the agent immediately sees what it switched to.

---

#### `brw close-tab`

Close a tab.

```bash
brw close-tab <tab_id>
```

Implementation: `Target.closeTarget`. If the closed tab was the active tab, switches to the most recently used remaining tab. Returns updated tab list.

---

#### `brw wait`

Wait for the page to settle.

```bash
brw wait [--duration SECONDS] [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--duration` | `2` | Max seconds to wait (0-30) |

Implementation: Combination of waiting for network idle and requestAnimationFrame settling.

---

#### `brw wait-for`

Wait until a condition is met on the page. Essential for SPAs and dynamic content.

```bash
brw wait-for --selector <css> [--timeout SECONDS] [--tab ID]
brw wait-for --text <text> [--timeout SECONDS] [--tab ID]
brw wait-for --url <glob> [--timeout SECONDS] [--tab ID]
brw wait-for --js <expression> [--timeout SECONDS] [--tab ID]
brw wait-for --network-idle [--timeout SECONDS] [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--selector` | — | Wait for a CSS selector to match an element in the DOM |
| `--text` | — | Wait for text to appear anywhere on the page |
| `--url` | — | Wait for the page URL to match a glob pattern |
| `--js` | — | Wait for a JS expression to return truthy |
| `--network-idle` | — | Wait for no network requests for 500ms |
| `--timeout` | `10` | Max seconds to wait before returning `matched: false` |

**Output**: `{"ok": true, "matched": true, "elapsed": 1234, "screenshot": "..."}` or `{"ok": true, "matched": false, "elapsed": 10000, "screenshot": "..."}` on timeout. Does NOT fail on timeout — returns `matched: false` so the agent can decide what to do.

Implementation: Polls via CDP at 100ms intervals. `--selector` uses `Runtime.evaluate` with `document.querySelector`. `--text` checks `document.body.innerText.includes(text)`. `--url` matches against the current `page.url`. `--js` evaluates the expression. `--network-idle` uses the proxy's network event tracking.

---

#### `brw dialog`

Handle browser dialogs (alert, confirm, prompt).

```bash
brw dialog [--tab ID]                          # Check for pending dialog
brw dialog accept [--text RESPONSE] [--tab ID]  # Accept/OK the dialog
brw dialog dismiss [--tab ID]                    # Cancel/dismiss the dialog
```

**Output**: `{"ok": true, "dialogType": "confirm", "message": "Are you sure?", "action": "accept", "screenshot": "..."}`

Implementation:
- Proxy listens for `Page.javascriptDialogOpening` events and queues them per-tab
- `brw dialog` (no subcommand) returns the pending dialog info, or `{"ok": true, "pending": false}` if none
- `brw dialog accept` calls `Page.handleJavaScriptDialog(accept: true)`
- `brw dialog dismiss` calls `Page.handleJavaScriptDialog(accept: false)`
- `--text` provides response text for `prompt` dialogs
- If no dialog handler is installed, the proxy auto-dismisses dialogs after 5 seconds to prevent Chrome from hanging. The auto-dismissed dialog is logged and returned in the next command's response as a warning.

**Auto-dismiss policy**: By default, the proxy auto-dismisses dialogs after 5 seconds. This prevents agents from getting stuck. The auto-dismiss action is `dismiss` for `confirm`/`prompt` and `accept` for `alert`. Agents that need to handle dialogs explicitly should check `brw dialog` after actions that might trigger them.

---

#### `brw quick`

Execute a batch of quick-mode commands.

```bash
brw quick <commands> [--tab ID]
```

The compact command format (one command per line):

| Command | Action | Syntax |
|---------|--------|--------|
| `C x y` | Left click | `C 100 200` |
| `RC x y` | Right click | `RC 100 200` |
| `DC x y` | Double click | `DC 100 200` |
| `TC x y` | Triple click | `TC 100 200` |
| `H x y` | Hover | `H 100 200` |
| `T text` | Type text | `T hello world` (multi-line: subsequent lines until next command) |
| `K keys` | Press keys | `K Enter`, `K cmd+a` |
| `S dir amt x y` | Scroll | `S down 3 640 400` |
| `D x1 y1 x2 y2` | Drag | `D 100 200 300 400` |
| `Z x1 y1 x2 y2` | Zoom screenshot | `Z 0 0 500 500` |
| `N url` | Navigate | `N https://google.com`, `N back` |
| `J code` | JavaScript | `J document.title` (multi-line: subsequent lines until next command) |
| `W` | Wait | `W` |
| `ST tabId` | Switch tab | `ST 3` |
| `NT url` | New tab | `NT https://google.com` |
| `LT` | List tabs | `LT` |

**Behavior**: Executes all commands in sequence. Returns a screenshot after the final command. Intermediate results (like LT, J) are collected and returned alongside the screenshot.

Example:
```bash
brw quick "N https://google.com
W
C 500 300
T hello world
K Enter"
```

---

#### `brw server`

Manage the proxy server directly.

```bash
brw server start [--port PORT] [--chrome-data-dir PATH] [--headless]
brw server stop [--port PORT]
brw server status [--port PORT]
```

---

#### `brw config`

Show the resolved configuration and where each value comes from.

```bash
brw config
```

**Output** (example):
```
Config resolution:
  env:        BRW_PORT=9300
  repo:       .claude/brw.json (found)
  user:       ~/.config/brw/config.json (found)

Resolved config:
  proxyPort:      9300        (env: BRW_PORT)
  cdpPort:        9222        (default)
  chromeDataDir:  ./.chrome   (repo: .claude/brw.json)
  chromePath:     /Applications/Google Chrome.app/...  (auto-detected)
  headless:       false       (default)
  screenshotDir:  /tmp/brw-screenshots  (default)
  idleTimeout:    1800        (default)
  windowWidth:    1280        (default)
  windowHeight:   800         (default)
  allowedUrls:    https://localhost:*, https://staging.myapp.com/*  (repo: .claude/brw.json)

Proxy status:    running (pid 12345, port 9300)
Chrome binary:   /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
Chrome version:  131.0.6778.85
```

Each value shows its source in parentheses: `(default)`, `(env: VAR_NAME)`, `(repo: .claude/brw.json)`, or `(user: ~/.config/brw/config.json)`. This makes it easy to debug which config is being picked up and why.

---

#### `brw cookies`

Manage browser cookies.

```bash
brw cookies [--tab ID]                                     # List all cookies for current page
brw cookies get <name> [--tab ID]                          # Get a specific cookie
brw cookies set <name> <value> [--domain D] [--path P] [--expires EPOCH] [--secure] [--httponly] [--tab ID]
brw cookies delete <name> [--tab ID]                       # Delete a specific cookie
brw cookies clear [--tab ID]                               # Clear all cookies for current domain
```

Implementation:
- `Network.getCookies` — list/get (filtered by current page URL)
- `Network.setCookie` — set with optional domain, path, expires, secure, httpOnly flags
- `Network.deleteCookies` — delete by name + domain
- `Storage.clearCookies` — clear all for domain

Useful for: auth testing, resetting login state, injecting session tokens, verifying cookie behavior.

---

#### `brw storage`

Read/write localStorage and sessionStorage.

```bash
brw storage get <key> [--session] [--tab ID]               # Get a value
brw storage set <key> <value> [--session] [--tab ID]       # Set a value
brw storage delete <key> [--session] [--tab ID]            # Delete a key
brw storage list [--session] [--tab ID]                    # List all keys
brw storage clear [--session] [--tab ID]                   # Clear all entries
```

| Flag | Default | Description |
|------|---------|-------------|
| `--session` | `false` | Use sessionStorage instead of localStorage |

Implementation: `Runtime.evaluate` with `localStorage.*` / `sessionStorage.*` calls. Returns JSON values.

---

#### `brw network-body`

Get the response body for a captured network request.

```bash
brw network-body <request_id> [--tab ID]
```

The `request_id` comes from `brw network` output. Returns the full response body (text or base64 for binary).

Implementation: `Network.getResponseBody` with the requestId. Proxy must have `Network.enable` active (already needed for `brw network`).

Useful for: inspecting API responses, verifying data returned by backend, debugging.

---

#### `brw intercept`

Intercept and modify network requests.

```bash
brw intercept add <url_pattern> [--status CODE] [--body TEXT] [--body-file PATH] [--header "K: V"] [--block] [--tab ID]
brw intercept list [--tab ID]
brw intercept remove <rule_id> [--tab ID]
brw intercept clear [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--status` | Override response status code (e.g., `200`, `404`, `500`) |
| `--body` | Override response body (inline string) |
| `--body-file` | Override response body from a file path |
| `--header` | Add/override response header (repeatable) |
| `--block` | Block the request entirely (returns network error) |

Examples:
```bash
# Mock an API response
brw intercept add "*/api/users" --status 200 --body '{"users": []}'

# Block analytics
brw intercept add "*analytics*" --block

# Simulate server error
brw intercept add "*/api/checkout" --status 500 --body '{"error": "test"}'

# Remove a rule
brw intercept list   # shows rule IDs
brw intercept remove rule_1
```

Implementation: CDP `Fetch` domain. `Fetch.enable` with `requestPatterns`, then handle `Fetch.requestPaused` events. For non-intercepted requests, call `Fetch.continueRequest`. For intercepted ones, call `Fetch.fulfillRequest` with the override.

Useful for: testing error states, mocking APIs, blocking third-party scripts, testing offline behavior.

---

#### `brw pdf`

Save the current page as a PDF.

```bash
brw pdf [--output PATH] [--tab ID] [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--output` | `/tmp/brw-screenshots/<timestamp>.pdf` | Output file path |
| `--landscape` | `false` | Landscape orientation |
| `--print-background` | `true` | Include background graphics |
| `--scale` | `1` | Scale factor (0.1-2.0) |
| `--paper` | `letter` | Paper size: `letter`, `a4`, `legal`, `tabloid` |

Implementation: `Page.printToPDF` with the given options. Returns the output file path.

---

#### `brw emulate`

Set device emulation and browser overrides.

```bash
brw emulate [--device DEVICE] [--tab ID]
brw emulate --width W --height H [--scale N] [--mobile] [--touch] [--tab ID]
brw emulate --user-agent UA [--tab ID]
brw emulate --geolocation LAT,LNG [--tab ID]
brw emulate --media FEATURE=VALUE [--tab ID]
brw emulate --timezone ZONE [--tab ID]
brw emulate --locale LOCALE [--tab ID]
brw emulate reset [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--device` | Preset device name (e.g., `"iPhone 15"`, `"Pixel 7"`, `"iPad Pro"`) |
| `--width`, `--height` | Custom viewport dimensions |
| `--scale` | Device scale factor (default: 1) |
| `--mobile` | Enable mobile mode (affects viewport meta, touch events) |
| `--touch` | Enable touch event emulation |
| `--user-agent` | Override User-Agent string |
| `--geolocation` | Override geolocation (latitude,longitude) |
| `--media` | Override CSS media feature (e.g., `prefers-color-scheme=dark`, `prefers-reduced-motion=reduce`) |
| `--timezone` | Override timezone (e.g., `America/New_York`, `Europe/London`) |
| `--locale` | Override navigator.language (e.g., `fr-FR`, `ja-JP`) |

Examples:
```bash
# Emulate iPhone 15
brw emulate --device "iPhone 15"

# Custom mobile viewport with dark mode
brw emulate --width 390 --height 844 --scale 3 --mobile --media prefers-color-scheme=dark

# Test geolocation
brw emulate --geolocation 37.7749,-122.4194

# Reset all emulation
brw emulate reset
```

Implementation:
- `--device`: Lookup from a built-in device descriptor table (same list as Chrome DevTools), sets viewport + UA + touch + scale
- `--width/height/scale/mobile`: `Emulation.setDeviceMetricsOverride`
- `--touch`: `Emulation.setTouchEmulationEnabled`
- `--user-agent`: `Emulation.setUserAgentOverride`
- `--geolocation`: `Emulation.setGeolocationOverride`
- `--media`: `Emulation.setEmulatedMedia`
- `--timezone`: `Emulation.setTimezoneOverride`
- `--locale`: `Emulation.setLocaleOverride`
- `reset`: Clears all overrides

---

#### `brw perf`

Get performance metrics for the current page.

```bash
brw perf [--tab ID]
```

**Output**: Key performance metrics including:
- Page load time (DOMContentLoaded, load event)
- First Contentful Paint
- DOM node count
- JS heap size
- Layout count, recalc style count

Implementation: `Performance.getMetrics` via CDP. Returns structured JSON.

---

#### `brw gif`

Record browser actions as an animated GIF.

```bash
brw gif start [--tab ID] [--max-frames N]
brw gif stop [--tab ID]
brw gif export [--output PATH] [--tab ID] [options]
brw gif clear [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--output` | `/tmp/brw-screenshots/<timestamp>.gif` | Output file path |
| `--quality` | `10` | GIF quality 1-30 (lower = better quality, larger file) |
| `--show-clicks` | `true` | Show click indicator overlays |
| `--show-drags` | `true` | Show drag path overlays |
| `--show-labels` | `false` | Show action text labels |
| `--show-progress` | `true` | Show progress bar |
| `--max-frames` | `200` | Max frames before auto-stopping (on `gif start`). Prevents unbounded memory growth. |

**Workflow**:
1. `brw gif start` — begins recording. The proxy captures a screenshot after every subsequent action (click, type, navigate, etc.) on that tab.
2. Perform browser actions normally (via `brw` commands or `brw quick`).
3. `brw gif stop` — stops recording.
4. `brw gif export --output demo.gif` — assembles captured frames into an animated GIF with optional overlays. Returns the file path.
5. `brw gif clear` — discards recorded frames.

Implementation:
- Proxy stores per-tab frame buffer: list of `{screenshot: Buffer, action: string, coordinates?: [x,y], timestamp: number}`
- On `start`, proxy sets a flag to capture a frame after every mutating action on that tab
- On `export`, proxy uses a GIF encoder library (e.g., `gif-encoder-2` or `gifenc`) to assemble frames
- Click indicators: red circle overlay at click coordinates
- Drag paths: line from start to end coordinates
- Frame timing: derived from actual timestamps between actions (capped at 2s max per frame)

---

## Claude Code Plugin

### Plugin Structure

```
plugins/brw/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── brw/
│       ├── SKILL.md
│       ├── scripts/
│       │   ├── brw.js          # Bundled CLI (single-file, esbuild output)
│       │   └── proxy.js        # Bundled proxy server (single-file, esbuild output)
│       └── references/
│           ├── COMMANDS.md
│           └── QUICK-MODE.md
├── src/                        # TypeScript source (not distributed, used for development)
│   ├── cli/
│   │   ├── index.ts            # CLI entry point
│   │   └── commands/           # One file per subcommand
│   ├── proxy/
│   │   ├── server.ts           # HTTP server
│   │   ├── chrome.ts           # Chrome lifecycle
│   │   ├── cdp.ts              # CDP connection management
│   │   └── handlers/           # One file per API endpoint
│   ├── shared/
│   │   ├── config.ts
│   │   └── types.ts
│   └── scripts/
│       └── a11y-tree.ts        # Accessibility tree injection script
├── package.json                # Dev dependencies (esbuild, typescript, chrome-remote-interface types)
├── tsconfig.json
├── build.sh                    # Bundles src/ → skills/brw/scripts/
└── spec.md
```

The `src/` directory contains the TypeScript source. Running `build.sh` uses esbuild to produce two self-contained JS files (`brw.js` and `proxy.js`) under `skills/brw/scripts/`. Only the `skills/` directory and `.claude-plugin/` are needed at runtime — the rest is development infrastructure.

### plugin.json

```json
{
  "name": "brw",
  "version": "0.1.0",
  "description": "Browser automation for Claude Code via Chrome DevTools Protocol",
  "author": {
    "name": "shrivu"
  },
  "repository": "https://github.com/shrivu/claude-plugins",
  "license": "MIT",
  "keywords": ["browser", "automation", "chrome", "cdp", "web"]
}
```

### SKILL.md

The skill teaches Claude how to use brw. Key sections:

1. **When to use**: User asks to interact with a web page, test a web app, scrape content, fill forms, etc.
2. **Setup**: Define the alias: `brw="brw"` (relative to the skill directory). The skill includes a setup block that Claude runs once per session.
3. **Prerequisites**: Node.js 18+ must be available. A Chromium-based browser must be installed.
4. **Workflow pattern**:
   - Take a screenshot first to see the current state
   - Use `read-page` to see the full page structure, or `read-page --filter interactive` for a focused view of just form elements and buttons
   - Interact via click/type/key commands
   - Mutation commands auto-return a screenshot path
   - Read the screenshot to verify results
5. **Command reference**: Summary of all commands with examples (detailed reference in `references/COMMANDS.md`)
6. **Quick mode**: When to use quick mode for chaining multiple simple actions (details in `references/QUICK-MODE.md`)
7. **Tips**: Element refs persist until navigation; prefer refs over coordinates when available; use `--no-screenshot` to skip auto-screenshot when chaining multiple actions before a manual screenshot

### SKILL.md Design (Best Practices Applied)

Based on the [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):

**Conciseness**: Claude already knows what browsers, HTML, DOM, and accessibility trees are. The SKILL.md should NOT explain these concepts. It should only provide: the CLI command interface, workflow patterns specific to `brw`, and edge cases Claude wouldn't know.

**Progressive disclosure**:
- **SKILL.md** (~200-300 lines): Core workflow, most-used commands (screenshot, click, type, navigate, read-page), quick examples
- **references/COMMANDS.md**: Full command reference with all flags, edge cases, output formats
- **references/QUICK-MODE.md**: Quick mode command table and multi-command examples

**Description** (third person, specific triggers):
```yaml
description: >-
  Automates browser interactions via Chrome DevTools Protocol.
  Screenshots, clicks, types, navigates, reads page accessibility trees,
  extracts text, and executes JavaScript in web pages. Use when the user
  asks to interact with a website, test a web app, fill web forms, scrape
  web content, or automate browser tasks.
```

**Degrees of freedom**: Medium-low. Browser automation is fragile — specific commands must be used in specific ways. Provide exact command syntax, but let Claude decide workflow (which elements to click, what to type, etc.).

**Feedback loop**: The screenshot-after-action pattern IS the feedback loop. Claude takes an action → sees the result via `page` fingerprint and screenshot → decides next action. The SKILL.md should emphasize this loop. Use `wait-for` to wait for dynamic content instead of polling with `read-page`.

**Output parsing**: All commands return JSON. The SKILL.md should teach Claude to check `ok` field, read `screenshot` path, and use `page.url` to detect unexpected navigations. Error responses have `code` and `hint` fields for actionable recovery.

**Script execution over reading**: Claude should execute `brw.js` commands, never read the script source. The SKILL.md should say "Run `brw screenshot`", not "See scripts/brw.js for the screenshot implementation".

**Naming**: Plugin name is `brw`, skill name is `brw`. Invoked as `/brw:brw`. One name for everything — CLI binary, plugin, and skill.

**Consistent terminology**: Always "tab" (not "window" or "page" for the tab concept), always "ref" or "ref ID" (not "element reference" or "element ID"), always "screenshot" (not "capture" or "image").

**Avoid time-sensitive info**: No version-specific Chrome features. No "as of 2026" statements.

### Hooks

A `SessionStart` hook checks that Node.js is available (required to run the bundled scripts):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node -e 'const v=parseInt(process.versions.node);if(v<18){console.error(\"brw requires Node.js 18+, found \"+process.version);process.exit(1)}' 2>/dev/null || echo 'Node.js 18+ not found. brw requires Node.js 18+ to run.'"
          }
        ]
      }
    ]
  }
}
```

## Screenshot Handling

Screenshots are saved to disk and the CLI returns the file path. Claude Code can read images via its `Read` tool, so the workflow is:

1. CLI: `brw screenshot` → prints `/tmp/brw-screenshots/1709234567890.png`
2. Claude: Uses `Read` tool on that path to view the image
3. Claude: Reasons about what it sees and decides next action
4. Mutation commands (click, type, etc.) auto-return a screenshot path, saving a round-trip

Screenshot optimization:
- Max dimension: 1568px (matches Claude's vision sweet spot)
- Format: PNG for quality, JPEG for speed (configurable)
- Retina: Downscale by devicePixelRatio to get CSS pixel dimensions
- Cleanup: Screenshots older than 1 hour are auto-deleted by the proxy

## Multi-Agent Support

### Tab Isolation

Each agent should claim/create its own tab(s) and pass `--tab ID` to all commands. The proxy does not enforce isolation — agents are responsible for using their own tabs.

### Proxy Discovery

1. CLI checks `localhost:9225/health`
2. If proxy is running → use it
3. If not → spawn proxy as a detached background process
4. Write PID to `~/.config/brw/proxy.pid` for lifecycle management
5. Subsequent CLI calls reuse the running proxy

### Concurrent Access

- Per-tab mutex for mutating operations prevents interleaving issues
- Multiple agents on different tabs can operate concurrently without blocking
- Screenshot requests queue behind any pending mutations on the same tab

## Edge Cases & Advanced Behavior

### Iframe Support

Many web apps embed iframes (payment forms, rich text editors, third-party widgets). CDP requires targeting the correct frame's execution context.

- `read-page`, `js`, `form-input` accept `--frame INDEX|NAME` to target an iframe
- Frame resolution: by 0-based index, by `name`/`id` attribute, or by URL substring
- `read-page --filter all` on the main frame includes iframe placeholders with frame index, so the agent can discover them
- Click/type/key work across frames since they dispatch at the viewport level (coordinates are global)
- Nested iframes: `--frame "0.1"` targets the second iframe inside the first iframe

### Download Handling

When the browser downloads a file (via click or navigation), the proxy tracks it:

- Download directory: `${screenshotDir}/downloads/` (configurable)
- `brw navigate` and `brw click` responses include `"download"` field if a download was triggered: `{"download": {"path": "/tmp/brw-screenshots/downloads/file.pdf", "filename": "file.pdf", "size": 102400}}`
- CDP `Browser.setDownloadBehavior` with `behavior: "allow"` and `downloadPath` set on proxy start
- CDP `Page.downloadProgress` events tracked per tab

### Login Persistence

The Chrome data directory (`~/.config/brw/chrome-data` by default) persists cookies, localStorage, and session data across proxy restarts. This means:

- Log in once → subsequent sessions are already authenticated
- Different Chrome data dirs isolate different auth contexts
- `brw cookies` can verify session state before re-authenticating
- Per-project data dirs (via `.claude/brw.json` `chromeDataDir`) keep project auth separate

The SKILL.md should instruct Claude to: (1) check if already logged in before re-authenticating, (2) use `brw cookies` or `brw js "document.cookie"` to verify session state.

### Chrome Process Safety

- **Existing Chrome instance**: If the CDP port is already in use, the proxy checks whether it's a Chrome instance it previously launched (via PID file). If it's an unknown process, it errors with: `"Port 9222 is in use by another process (PID 12345). Use BRW_CDP_PORT to specify a different port."` The proxy never connects to the user's personal browser.
- **Stale PID file**: If `~/.config/brw/proxy.pid` exists but the process is dead, the CLI detects this and starts a fresh proxy (overwriting the stale PID file).
- **Chrome crash**: Proxy monitors the Chrome child process. On unexpected exit, it sets an internal flag. The next CLI command triggers a Chrome relaunch.

### Retry & Resilience

CDP operations can fail transiently (target closed during navigation, session detached, etc.). The proxy implements:

- **One automatic retry** on transient errors (`Target closed`, `Session detached`, `Cannot find context`)
- **No retry** on permanent errors (invalid arguments, URL blocked, ref not found)
- The retry is transparent to the CLI caller — either the retried attempt succeeds or the error is returned

## Excluded Features

The following Chrome extension features are **not** included:

| Feature | Reason |
|---------|--------|
| Permission system | Not needed — Claude Code has its own permission model |
| Domain classification/blocking | Not applicable for local automation |
| `update_plan` tool | Extension-specific UI feature |
| `turn_answer_start` tool | Extension-specific internal control |
| `shortcuts_list/execute` | Extension-specific feature |
| `upload_image` (by image ID) | Extension-specific; file-upload covers the use case |
| `find` (semantic element search) | Requires nested LLM call; Claude can do this itself using `read-page` output |
| Tab groups | Extension-specific; plain tab IDs suffice |
| MCP native messaging | Extension-specific integration |
| Message compaction | Extension-specific optimization |
| Workflow recording | Extension-specific feature |

## Resolved Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLI binary name | `brw` | 3 chars, token-efficient, intuitive abbreviation of "browser" |
| Auto-screenshot | Yes, with `--no-screenshot` opt-out | Matches Chrome extension behavior; reduces round-trips for agents |
| Display mode | Headed by default, `--headless` flag | Easier to debug and demo; agents can opt into headless |
| Browser support | Any Chromium-based (Chrome > Chromium > Edge > Brave) | Flexible; works with whatever the user has installed |
| A11y tree | CDP built-in `Accessibility.getFullAXTree` first | Simpler to start; switch to custom script injection if ref ID control is insufficient |
| Tech stack | TypeScript / Node.js | CDP is native to JS; mature libraries |
| Distribution | Bundled in plugin `scripts/` | Self-contained; no separate npm install; esbuild produces single-file bundles |
| Output format | JSON by default, `--text` opt-out | Agents parse structured output reliably; humans use `--text` for debugging |
| `read-page` default filter | `all` | Agents need structural context (headings, text) not just interactive elements |
| Page fingerprint | Included in every response | Agents detect unexpected navigations via `page.url` and `page.contentLength` |
| Dialog handling | Auto-dismiss after 5s | Prevents Chrome from hanging; agents can handle explicitly with `brw dialog` |
| Exit codes | Structured (0-4) | Machine-readable error classification without parsing text |

## Implementation Phases

### Parallelism Guide

Work that can happen in parallel is marked with lane letters (A, B, C...). Items in the same lane are sequential; different lanes can run concurrently.

```
Phase 1:
  Lane A: Project setup → Proxy server → CDP connection → Chrome lifecycle
  Lane B: CLI framework → Subcommand scaffolding (screenshot, click, type, key, navigate, tabs, wait)
  Lane C: SKILL.md + plugin.json + marketplace registration
  (A must finish before B can integrate; C is fully independent)

Phase 2:
  Lane A: read-page (a11y tree + ref IDs + --search + --frame) → form-input (depends on refs)
  Lane B: get-text + js execution (independent of refs) + iframe support
  Lane C: hover + scroll + scroll-to + drag (independent input dispatching)
  Lane D: wait-for + dialog handling
  Lane E: close-tab + --selector support across commands
  Lane F: references/COMMANDS.md (can write as commands are finalized)

Phase 3:
  Lane A: Console capture (Runtime.consoleAPICalled) + console command
  Lane B: Network capture (Network.*) + network command + network-body
  Lane C: Quick mode parser + executor
  Lane D: GIF recording (frame buffer) → GIF export (encoder)
  Lane E: resize + file-upload (small, independent)
  (A, B, C, D, E are all independent)

Phase 4:
  Lane A: cookies + storage (both are simple CDP calls)
  Lane B: intercept (Fetch domain — more complex, standalone)
  Lane C: emulate (Emulation domain — many sub-features but one domain)
  Lane D: pdf + perf (simple single-call commands)
  (A, B, C, D are all independent)

Phase 5:
  Lane A: Config file + idle timeout + graceful shutdown
  Lane B: Error messages + Chrome crash recovery
  Lane C: esbuild optimization + bundle testing
  Lane D: E2E tests + multi-agent tests
  Lane E: SessionStart hook + final SKILL.md polish
  (mostly independent; D depends on everything else being done)
```

### Phase 1: Core

- [ ] Project setup: `package.json`, `tsconfig.json`, esbuild config, `build.sh`
- [ ] Proxy server with Chrome lifecycle management and auto-detection
- [ ] CDP connection management
- [ ] Core CLI commands: `screenshot`, `click`, `type`, `key`, `navigate`, `tabs`, `new-tab`, `switch-tab`, `wait`
- [ ] Auto-screenshot on mutation commands (with `--no-screenshot`)
- [ ] Screenshot capture, file management, and Retina downscaling
- [ ] Auto-start proxy from CLI when not running
- [ ] Basic SKILL.md for the plugin
- [ ] Plugin manifest (`plugin.json`) and marketplace registration

**Test plan:**

| # | Test | Command(s) | Expected |
|---|------|-----------|----------|
| 1.1 | Build produces valid bundles | `./build.sh && node skills/brw/scripts/brw.js --help` | Prints help text, exit 0 |
| 1.2 | Proxy starts and Chrome launches | `brw server start` | Health endpoint `GET /health` returns 200; Chrome process visible in `ps` |
| 1.3 | Browser auto-detection | Unset `BRW_CHROME_PATH`, verify proxy finds Chrome/Chromium/Edge/Brave in order | Proxy logs which binary it found; Chrome launches |
| 1.4 | Custom chrome data dir | `BRW_DATA_DIR=/tmp/test-profile brw server start` | `/tmp/test-profile` directory created and used |
| 1.5 | Auto-start proxy from CLI | Kill proxy, run `brw screenshot` | Proxy spawns automatically, screenshot succeeds |
| 1.6 | Screenshot capture | `brw screenshot` | Returns valid PNG path; file exists; dimensions ≤ 1568px on longest side |
| 1.7 | Screenshot Retina downscale | Run on Retina display (devicePixelRatio=2) | Screenshot is CSS-pixel dimensions, not physical pixels |
| 1.8 | Navigate to URL | `brw navigate "https://example.com"` | Page loads; auto-screenshot shows Example Domain page |
| 1.9 | Navigate back/forward | Navigate to A, then B, then `brw navigate back` | Returns to page A |
| 1.10 | Navigate auto-prepends https | `brw navigate "example.com"` | Navigates to `https://example.com` |
| 1.11 | Click at coordinates | Navigate to a page with a button, `brw click X Y` | Button activates; auto-screenshot shows post-click state |
| 1.12 | Click variants | `brw click X Y --right`, `--double`, `--triple` | Right-click shows context menu; double-click selects word; triple-click selects line |
| 1.13 | Click with modifiers | `brw click X Y --modifiers shift` | Shift-click behavior (e.g., extends selection) |
| 1.14 | Type text | Click a text input, then `brw type "hello world"` | Text appears in the input field |
| 1.15 | Type multiline | `brw type "line1\nline2"` | Newlines produce Enter keypresses; both lines appear |
| 1.16 | Key press | `brw key Enter`, `brw key "cmd+a"`, `brw key Tab` | Correct key events dispatched (verify via JS event listener) |
| 1.17 | Key repeat | `brw key Tab --repeat 3` | Tab pressed 3 times (focus moves through 3 elements) |
| 1.18 | Tabs list | Open default tab, run `brw tabs` | Returns at least 1 tab with ID, URL, title |
| 1.19 | New tab | `brw new-tab "https://example.com"` | Returns new tab ID; `brw tabs` shows 2 tabs |
| 1.20 | Switch tab | `brw switch-tab <id>` | Subsequent commands target the switched tab |
| 1.21 | Wait | `brw wait --duration 1` | Returns after ~1s; no error |
| 1.22 | Auto-screenshot on mutation | `brw click X Y` (no `--no-screenshot`) | Output includes screenshot path |
| 1.23 | `--no-screenshot` suppresses | `brw click X Y --no-screenshot` | Output does NOT include screenshot path |
| 1.24 | Default JSON output | `brw tabs` | Output is valid JSON with `ok`, `tabs`, `activeTab` fields |
| 1.25 | Server stop | `brw server stop` | Proxy exits; Chrome process terminates; health check fails |
| 1.26 | Headless mode | `BRW_HEADLESS=true brw server start` then `brw screenshot` | No visible window; screenshot still captures page |
| 1.27 | Invalid command | `brw nonexistent` | Prints usage help, exit 1 |
| 1.28 | Proxy not running, non-auto | `brw server status` when proxy is down | Reports not running, exit 1 |
| 1.29 | Navigate `--wait none` | `brw navigate "https://example.com" --wait none` | Returns immediately; page may still be loading |
| 1.30 | Navigate `--wait network` | `brw navigate "https://example.com" --wait network` | Returns after network idle; page fully loaded |
| 1.31 | Navigate default `--wait dom` | `brw navigate "https://example.com"` | Returns after DOMContentLoaded |

### Phase 2: Page Reading & Interaction

- [ ] `read-page` with CDP `Accessibility.getFullAXTree`, ref IDs, `--search`, `--frame`
- [ ] `form-input` using ref IDs and `--selector`
- [ ] `get-text` with content extraction
- [ ] `js` execution with `--frame` support
- [ ] `hover`, `scroll`, `scroll-to`, `drag` (with `--ref`, `--from-ref`/`--to-ref`)
- [ ] `close-tab`
- [ ] `wait-for` with selector/text/url/js/network-idle conditions
- [ ] `dialog` handling with auto-dismiss policy
- [ ] `--selector` alternative on click, hover, form-input
- [ ] `--frame` support for iframe targeting
- [ ] Iframe discovery in `read-page` output
- [ ] `type --clear` flag
- [ ] Download tracking
- [ ] Update SKILL.md with full command reference
- [ ] `references/COMMANDS.md` detailed reference

**Test plan:**

Use a local test HTML file (`test-fixtures/form-page.html`) served via a simple HTTP server for deterministic testing. The fixture should contain: text inputs, checkboxes, radio buttons, selects, textareas, contenteditable divs, buttons, links, headings, scrollable regions, and draggable elements.

| # | Test | Command(s) | Expected |
|---|------|-----------|----------|
| 2.1 | Read page — interactive filter | `brw read-page --filter interactive` on form page | Returns only interactive elements (inputs, buttons, links, selects) with ref IDs |
| 2.2 | Read page — all filter | `brw read-page --filter all` | Returns full a11y tree including headings, paragraphs, regions |
| 2.3 | Ref ID persistence | `brw read-page`, then `brw click --ref ref_1` | Ref resolves correctly; element is clicked |
| 2.4 | Ref ID reset on navigation | `brw read-page`, navigate away, `brw click --ref ref_1` | Error: ref not found (or stale ref message) |
| 2.5 | Read page — depth limit | `brw read-page --depth 2` | Tree truncated at depth 2; deep elements not included |
| 2.6 | Read page — scoped by ref | `brw read-page`, then `brw read-page --ref ref_5` | Returns subtree rooted at ref_5 only |
| 2.7 | Read page — max chars | `brw read-page --max-chars 500` | Output truncated to ~500 chars |
| 2.8 | Select element options | `brw read-page` on page with `<select>` | Select element lists all options with selection state and values |
| 2.9 | Accessible names | `brw read-page` on elements with `aria-label`, `placeholder`, `title`, `alt`, `<label>` | Correct name extracted for each method |
| 2.10 | Form input — text | `brw form-input --ref <text_input_ref> --value "test"` | Input value set; `change` and `input` events fired |
| 2.11 | Form input — checkbox | `brw form-input --ref <checkbox_ref> --value true` | Checkbox checked |
| 2.12 | Form input — select | `brw form-input --ref <select_ref> --value "option2"` | Option selected; verify via `brw read-page` |
| 2.13 | Form input — radio | `brw form-input --ref <radio_ref> --value true` | Radio selected; other radios in group deselected |
| 2.14 | Form input — contenteditable | `brw form-input --ref <ce_ref> --value "edited"` | Content updated |
| 2.15 | Form input — scrolls into view | Place element below fold, `brw form-input --ref <ref>` | Element scrolled into viewport before setting value |
| 2.16 | Form input — invalid ref | `brw form-input --ref nonexistent --value "x"` | Clear error message: ref not found |
| 2.17 | Get text — article page | Navigate to page with `<article>`, `brw get-text` | Returns article text content (not nav, sidebar, etc.) |
| 2.18 | Get text — fallback | Navigate to page with no semantic elements, `brw get-text` | Falls back to `body` text |
| 2.19 | Get text — max chars | `brw get-text --max-chars 200` | Truncated to ~200 chars |
| 2.20 | Get text — includes metadata | `brw get-text` | Output includes page title and URL |
| 2.21 | JS execution — sync | `brw js "document.title"` | Returns page title string |
| 2.22 | JS execution — async | `brw js "await fetch('/api').then(r => r.status)"` (on appropriate page) | Returns the status code |
| 2.23 | JS execution — error | `brw js "throw new Error('test')"` | Returns error message, exit 1 |
| 2.24 | JS execution — DOM mutation | `brw js "document.body.style.background = 'red'"` then screenshot | Screenshot shows red background |
| 2.25 | Hover | `brw hover X Y` on element with `:hover` CSS | Hover style applied (verify via screenshot or JS check) |
| 2.26 | Hover by ref | `brw hover --ref ref_1` | Resolves ref to coordinates, hovers |
| 2.27 | Scroll down | `brw scroll down --amount 3` | Page scrolls down; `window.scrollY` increases |
| 2.28 | Scroll up | Scroll down first, then `brw scroll up` | `window.scrollY` decreases |
| 2.29 | Scroll at coordinates | `brw scroll down --at 200,400` on page with scrollable div at those coords | Inner div scrolls, not the page |
| 2.30 | Scroll left/right | `brw scroll right` on horizontally scrollable page | `window.scrollX` increases |
| 2.31 | Drag | `brw drag 100 100 300 300` on page with draggable element at (100,100) | Element moves; drop event fires at (300,300) |
| 2.32 | Scroll-to by ref | `brw read-page`, then `brw scroll-to --ref <off_screen_ref>` | Element scrolled into viewport center |
| 2.33 | Scroll-to — already visible | `brw scroll-to --ref <visible_ref>` | No-op or minimal scroll; no error |
| 2.34 | Scroll-to — invalid ref | `brw scroll-to --ref nonexistent` | Error: ref not found |
| 2.35 | Close tab | Create tab, `brw close-tab <new_tab_id>` | Tab closed; `brw tabs` no longer lists it |
| 2.36 | Close tab — active tab | Close the currently active tab | Active tab switches to most recent remaining tab |
| 2.37 | Close tab — last tab | Close the only remaining tab | Error or new blank tab created (browser requires ≥1 tab) |
| 2.38 | Close tab — invalid ID | `brw close-tab 99999` | Error: tab not found |
| 2.39 | Read page — search filter | `brw read-page --search "Submit"` on form page | Returns only elements containing "Submit" (e.g., submit button) |
| 2.40 | Read page — search no matches | `brw read-page --search "xyznonexistent"` | Returns empty tree, refCount 0 |
| 2.41 | Read page — search case-insensitive | `brw read-page --search "submit"` | Matches "Submit" button |
| 2.42 | Click by selector | `brw click --selector "button.submit"` | Clicks the matching element |
| 2.43 | Click by selector — not found | `brw click --selector ".nonexistent"` | Error with code `SELECTOR_NOT_FOUND` |
| 2.44 | Hover by selector | `brw hover --selector "a.nav-link"` | Hovers over the matching element |
| 2.45 | Form-input by selector | `brw form-input --selector "#email" --value "test@example.com"` | Sets value on matching element |
| 2.46 | Drag by ref | `brw drag --from-ref ref_1 --to-ref ref_5` | Drags from element 1 to element 5 |
| 2.47 | Drag mixed ref+coord | `brw drag --from-ref ref_1 300 400` | Drags from element to absolute coordinate |
| 2.48 | Type with --clear | Type "old text" in input, then `brw type "new text" --clear` | Input contains only "new text" |
| 2.49 | Wait-for selector | Navigate to page that adds element after 1s, `brw wait-for --selector ".delayed-element"` | Returns `matched: true`, elapsed ~1000ms |
| 2.50 | Wait-for selector timeout | `brw wait-for --selector ".never-exists" --timeout 2` | Returns `matched: false`, elapsed ~2000ms, exit 0 (not an error) |
| 2.51 | Wait-for text | Page loads "Loading..." then changes to "Done", `brw wait-for --text "Done"` | Returns `matched: true` |
| 2.52 | Wait-for URL | Click a link, `brw wait-for --url "*/dashboard*"` | Returns `matched: true` after navigation |
| 2.53 | Wait-for JS condition | `brw wait-for --js "document.querySelectorAll('li').length > 5"` | Returns `matched: true` when condition met |
| 2.54 | Wait-for network idle | Navigate to SPA, `brw wait-for --network-idle` | Returns `matched: true` after XHR/fetch requests settle |
| 2.55 | Dialog — alert auto-dismiss | Navigate to page with `alert("hello")`, wait 6s | Dialog auto-dismissed; next command response includes warning |
| 2.56 | Dialog — explicit accept | Trigger confirm dialog, `brw dialog accept` | Dialog accepted; screenshot shows post-dialog state |
| 2.57 | Dialog — explicit dismiss | Trigger confirm dialog, `brw dialog dismiss` | Dialog dismissed |
| 2.58 | Dialog — prompt with text | Trigger prompt dialog, `brw dialog accept --text "user input"` | Prompt receives text; page handles it |
| 2.59 | Dialog — check pending | `brw dialog` with no pending dialog | Returns `{"ok": true, "pending": false}` |
| 2.60 | Read-page iframe | Page with `<iframe src="form.html">`, `brw read-page --frame 0` | Returns a11y tree of iframe content |
| 2.61 | JS in iframe | `brw js "document.title" --frame 0` | Returns iframe document title |
| 2.62 | Form-input in iframe | `brw form-input --selector "#iframe-input" --value "test" --frame 0` | Sets value in iframe element |
| 2.63 | Screenshot by ref | `brw read-page`, `brw screenshot --ref ref_3` | Screenshot cropped to element bounding box |
| 2.64 | Screenshot full-page | Navigate to long page, `brw screenshot --full-page` | Screenshot captures entire scrollable content |
| 2.65 | Download tracking | Click a download link, check response | Response includes `download: {path, filename, size}` |
| 2.66 | Output JSON format | `brw click 100 200` | Response is valid JSON with `ok`, `screenshot`, `page` fields |
| 2.67 | Output page fingerprint | `brw click 100 200` | Response includes `page: {url, title, contentLength}` |
| 2.68 | Exit code — usage error | `brw click` (missing coordinates) | Exit code 1 |
| 2.69 | Exit code — CDP error | `brw js "invalid{{{syntax"` | Exit code 3 |

### Phase 3: Observability, Quick Mode & GIF

- [ ] Console message capture and `console` command
- [ ] Network request capture and `network` command
- [ ] `network-body` for response body retrieval
- [ ] `resize` command
- [ ] `file-upload` command
- [ ] `quick` mode command parser and executor
- [ ] `gif` recording, export, and frame management
- [ ] `references/QUICK-MODE.md` reference

**Test plan:**

Use the same test fixture page, plus a fixture that logs to console and makes fetch requests on load.

| # | Test | Command(s) | Expected |
|---|------|-----------|----------|
| 3.1 | Console — capture logs | Navigate to page that calls `console.log("hello")`, `brw console` | Shows "hello" message with log level |
| 3.2 | Console — errors only | Page with both log and error, `brw console --errors-only` | Only error messages returned |
| 3.3 | Console — pattern filter | `brw console --pattern "^Error"` | Only messages matching regex |
| 3.4 | Console — clear | `brw console --clear`, then `brw console` | Second call returns empty (buffer cleared) |
| 3.5 | Console — limit | Page with 50 log messages, `brw console --limit 5` | Returns only 5 messages |
| 3.6 | Console — exception capture | Page with uncaught exception, `brw console --errors-only` | Exception appears with stack trace |
| 3.7 | Network — capture requests | Navigate to page that fetches `/api/data`, `brw network` | Shows GET /api/data with status, timing |
| 3.8 | Network — URL pattern | Page makes multiple requests, `brw network --url-pattern "api"` | Only API requests shown |
| 3.9 | Network — clear | `brw network --clear`, then `brw network` | Second call shows only new requests |
| 3.10 | Network — limit | `brw network --limit 3` | Returns max 3 entries |
| 3.11 | Resize | `brw resize 800 600` then `brw js "JSON.stringify({w: window.innerWidth, h: window.innerHeight})"` | Returns `{"w":800,"h":600}` (approximately) |
| 3.12 | Resize — screenshot reflects | `brw resize 400 300` then `brw screenshot` | Screenshot dimensions reflect 400x300 viewport |
| 3.13 | File upload | Page with `<input type="file">`, `brw file-upload --ref <ref> --files /tmp/test.txt` | File attached; input shows filename (verify via JS: `input.files[0].name`) |
| 3.14 | File upload — multiple | `brw file-upload --ref <ref> --files /tmp/a.txt /tmp/b.txt` | Both files attached (`input.files.length === 2`) |
| 3.15 | File upload — invalid ref | `brw file-upload --ref bad_ref --files /tmp/test.txt` | Error: ref not found |
| 3.16 | File upload — file not found | `brw file-upload --ref <ref> --files /nonexistent` | Error: file not found |
| 3.17 | Quick — single click | `brw quick "C 100 200"` | Click at (100,200); returns screenshot |
| 3.18 | Quick — multi-command | `brw quick "N https://example.com\nW\nC 500 300"` | Navigates, waits, clicks; returns final screenshot |
| 3.19 | Quick — type | `brw quick "C 100 200\nT hello world"` | Clicks then types; screenshot shows typed text |
| 3.20 | Quick — key | `brw quick "K cmd+a\nK Backspace"` | Selects all then deletes |
| 3.21 | Quick — scroll | `brw quick "S down 5 640 400"` | Scrolls down 5 ticks at (640,400) |
| 3.22 | Quick — drag | `brw quick "D 100 100 300 300"` | Drags from (100,100) to (300,300) |
| 3.23 | Quick — navigate back | `brw quick "N https://a.com\nW\nN https://b.com\nW\nN back"` | Ends on page A |
| 3.24 | Quick — JS execution | `brw quick "J document.title"` | Returns title in intermediate results |
| 3.25 | Quick — tab management | `brw quick "NT https://example.com\nLT"` | Creates tab; LT lists both tabs in intermediate results |
| 3.26 | Quick — switch tab | `brw quick "NT https://a.com\nST <original_tab_id>"` | Switches back to original tab |
| 3.27 | Quick — zoom screenshot | `brw quick "Z 0 0 200 200"` | Returns cropped screenshot of top-left 200x200 region |
| 3.28 | Quick — wait | `brw quick "W"` | Waits for page settle; returns screenshot |
| 3.29 | Quick — hover | `brw quick "H 100 200"` | Hovers at (100,200) |
| 3.30 | Quick — all click variants | `brw quick "RC 100 200"`, `"DC 100 200"`, `"TC 100 200"` | Right-click, double-click, triple-click respectively |
| 3.31 | Quick — invalid command | `brw quick "X 100 200"` | Error: unknown command "X" |
| 3.32 | Quick — empty input | `brw quick ""` | No-op; returns screenshot of current state |
| 3.33 | Quick — with `--tab` | `brw quick "C 100 200" --tab <id>` | Executes on specified tab |
| 3.34 | GIF — start recording | `brw gif start` | Returns success; proxy begins capturing frames |
| 3.35 | GIF — frames captured | `brw gif start`, `brw click 100 200`, `brw click 200 300`, `brw gif stop` | Frames captured for each action |
| 3.36 | GIF — export default | `brw gif export` | Returns path to valid GIF file; file is a valid animated GIF with multiple frames |
| 3.37 | GIF — export custom path | `brw gif export --output /tmp/demo.gif` | GIF saved to `/tmp/demo.gif` |
| 3.38 | GIF — export quality | `brw gif export --quality 1` vs `--quality 30` | Lower quality = larger file, better visual fidelity |
| 3.39 | GIF — click indicators | `brw gif start`, click, `brw gif stop`, `brw gif export --show-clicks` | GIF frames show red circle overlay at click coordinates |
| 3.40 | GIF — drag paths | `brw gif start`, drag, `brw gif stop`, `brw gif export --show-drags` | GIF frames show line from drag start to end |
| 3.41 | GIF — no overlays | `brw gif export --no-show-clicks --no-show-drags --no-show-progress` | Clean GIF with no overlays |
| 3.42 | GIF — action labels | `brw gif export --show-labels` | Frames show action text (e.g., "click 100,200") |
| 3.43 | GIF — clear | `brw gif start`, click, `brw gif stop`, `brw gif clear`, `brw gif export` | Error or empty GIF (no frames to export) |
| 3.44 | GIF — no recording | `brw gif export` without start | Error: no recording in progress / no frames |
| 3.45 | GIF — frame timing | Record actions with 500ms gaps, export | GIF frame delays approximate real timing (capped at 2s) |
| 3.46 | GIF — per-tab isolation | Start recording on tab 1, act on tab 2, stop on tab 1 | Only tab 1 actions captured |
| 3.47 | GIF — with quick mode | `brw gif start`, `brw quick "C 100 200\nT hello\nK Enter"`, `brw gif stop`, `brw gif export` | All quick mode actions captured as frames |
| 3.48 | Network body — JSON | Fetch a JSON API, `brw network` to get request ID, `brw network-body <id>` | Returns JSON response body |
| 3.49 | Network body — binary | Fetch an image, `brw network-body <id>` | Returns base64-encoded body |
| 3.50 | Network body — invalid ID | `brw network-body nonexistent` | Error: request not found |
| 3.51 | Quick — malformed: missing Y | `brw quick "C 100"` | Error: "C requires 2 coordinates (x y), got 1" |
| 3.52 | Quick — malformed: missing text | `brw quick "T"` | Error: "T requires text argument" |
| 3.53 | Quick — malformed: incomplete scroll | `brw quick "S left"` | Error: "S requires direction, amount, x, y" |
| 3.54 | Quick — malformed: incomplete drag | `brw quick "D 100 200 300"` | Error: "D requires 4 coordinates (x1 y1 x2 y2)" |
| 3.55 | GIF — max frames limit | `brw gif start --max-frames 3`, perform 5 actions, `brw gif stop` | Only 3 frames captured; recording auto-stopped after frame 3 |

### Phase 4: Advanced Browser Features

- [ ] `cookies` — list, get, set, delete, clear
- [ ] `storage` — localStorage and sessionStorage CRUD
- [ ] `intercept` — network request interception and mocking
- [ ] `pdf` — save page as PDF
- [ ] `emulate` — device, viewport, media, geolocation, timezone, locale
- [ ] `perf` — performance metrics

**Test plan:**

| # | Test | Command(s) | Expected |
|---|------|-----------|----------|
| 4.1 | Cookies — list | Navigate to a site that sets cookies, `brw cookies` | Lists cookies with name, value, domain, path, expiry |
| 4.2 | Cookies — get | `brw cookies get "session_id"` | Returns cookie value |
| 4.3 | Cookies — set | `brw cookies set "test" "value123" --domain localhost` | Cookie set; `brw cookies get "test"` returns "value123" |
| 4.4 | Cookies — set with flags | `brw cookies set "secure_cookie" "val" --secure --httponly --expires 1999999999` | Cookie set with correct flags |
| 4.5 | Cookies — delete | `brw cookies set "temp" "val"`, then `brw cookies delete "temp"` | Cookie removed; `brw cookies get "temp"` returns not found |
| 4.6 | Cookies — clear | Set multiple cookies, `brw cookies clear` | All cookies for current domain cleared |
| 4.7 | Cookies — cross-domain isolation | Set cookie on domain A, switch to domain B tab, `brw cookies` | Does not show domain A cookies |
| 4.8 | Storage — set and get | `brw storage set "key1" "value1"`, `brw storage get "key1"` | Returns "value1" |
| 4.9 | Storage — list | Set multiple keys, `brw storage list` | Lists all keys and values |
| 4.10 | Storage — delete | `brw storage delete "key1"` | Key removed; get returns not found |
| 4.11 | Storage — clear | `brw storage clear` | All localStorage entries removed |
| 4.12 | Storage — sessionStorage | `brw storage set "sk" "sv" --session`, `brw storage get "sk" --session` | Works with sessionStorage |
| 4.13 | Storage — JSON values | `brw storage set "obj" '{"a":1}'`, `brw storage get "obj"` | JSON preserved as string |
| 4.14 | Intercept — mock API | `brw intercept add "*/api/data" --status 200 --body '{"mock":true}'`, navigate to page that fetches /api/data | Page receives mocked response |
| 4.15 | Intercept — block request | `brw intercept add "*analytics*" --block`, navigate to page with analytics | Analytics request blocked; page loads without it |
| 4.16 | Intercept — simulate error | `brw intercept add "*/api/save" --status 500 --body '{"error":"test"}'`, trigger save | Page receives 500 error |
| 4.17 | Intercept — custom headers | `brw intercept add "*/api/*" --header "X-Test: true"` | Intercepted responses include custom header |
| 4.18 | Intercept — list rules | Add multiple rules, `brw intercept list` | Lists all active rules with IDs and patterns |
| 4.19 | Intercept — remove rule | `brw intercept remove <rule_id>` | Rule removed; subsequent requests not intercepted |
| 4.20 | Intercept — clear all | `brw intercept clear` | All rules removed |
| 4.21 | Intercept — body from file | `brw intercept add "*/api/data" --body-file /tmp/mock.json` | Response body loaded from file |
| 4.22 | Intercept — passthrough | Requests not matching any rule | Pass through unmodified |
| 4.23 | PDF — basic save | `brw pdf` | Returns valid PDF file path; file is a valid PDF |
| 4.24 | PDF — custom output | `brw pdf --output /tmp/test.pdf` | Saved to specified path |
| 4.25 | PDF — landscape | `brw pdf --landscape` | PDF is landscape orientation |
| 4.26 | PDF — A4 paper | `brw pdf --paper a4` | PDF uses A4 dimensions |
| 4.27 | PDF — no background | `brw pdf --no-print-background` | PDF omits background graphics |
| 4.28 | Emulate — preset device | `brw emulate --device "iPhone 15"`, `brw screenshot` | Screenshot shows mobile viewport (390x844 approx) |
| 4.29 | Emulate — custom viewport | `brw emulate --width 768 --height 1024 --mobile`, `brw screenshot` | Tablet-sized viewport |
| 4.30 | Emulate — dark mode | `brw emulate --media prefers-color-scheme=dark`, screenshot page with dark mode CSS | Screenshot shows dark theme |
| 4.31 | Emulate — geolocation | `brw emulate --geolocation 37.7749,-122.4194`, `brw js "navigator.geolocation.getCurrentPosition(p => document.title = p.coords.latitude)"` | Title set to 37.7749 |
| 4.32 | Emulate — user agent | `brw emulate --user-agent "TestBot/1.0"`, `brw js "navigator.userAgent"` | Returns "TestBot/1.0" |
| 4.33 | Emulate — timezone | `brw emulate --timezone "Asia/Tokyo"`, `brw js "Intl.DateTimeFormat().resolvedOptions().timeZone"` | Returns "Asia/Tokyo" |
| 4.34 | Emulate — locale | `brw emulate --locale "fr-FR"`, `brw js "navigator.language"` | Returns "fr-FR" |
| 4.35 | Emulate — reset | `brw emulate --device "iPhone 15"`, then `brw emulate reset` | Viewport returns to default 1280x800 |
| 4.36 | Emulate — touch | `brw emulate --touch`, `brw js "'ontouchstart' in window"` | Returns true |
| 4.37 | Perf — basic metrics | Navigate to a page, `brw perf` | Returns JSON with DOMContentLoaded, load timing, DOM nodes, heap size |
| 4.38 | Perf — after interaction | Click around, then `brw perf` | Layout count, recalc style count reflect interactions |

### Phase 5: Polish

- [ ] Idle timeout and graceful shutdown
- [ ] Screenshot cleanup (auto-delete after 1 hour)
- [ ] Configuration file support (`~/.config/brw/config.json` + `.claude/brw.json`)
- [ ] Stale PID file detection and cleanup
- [ ] Chrome process safety (detect occupied CDP port, never connect to user's browser)
- [ ] Comprehensive error messages with `code` + `hint` fields
- [ ] Structured exit codes (0-4)
- [ ] `--debug` verbose logging to stderr
- [ ] `--timeout` global flag
- [ ] `--text` output mode (human-readable alternative to JSON)
- [ ] Page fingerprint (`page` object) in all responses
- [ ] Retry on transient CDP errors
- [ ] SessionStart hook for Node.js 18+ version check
- [ ] esbuild bundle optimization (tree-shaking, minification)
- [ ] End-to-end testing with a real browser

**Test plan:**

| # | Test | Command(s) | Expected |
|---|------|-----------|----------|
| 5.1 | Idle timeout | Start proxy with `BRW_IDLE_TIMEOUT=5`, wait 6s, check health | Proxy has exited; health check fails |
| 5.2 | Idle timeout reset | Start proxy with short timeout, send command within timeout, wait | Timeout resets; proxy stays alive during activity |
| 5.3 | Graceful shutdown | `brw server stop` while a long `wait` command is running | Wait completes (or is cancelled cleanly); proxy exits; Chrome terminates |
| 5.4 | Chrome crash recovery | Kill Chrome process directly, then `brw screenshot` | Proxy detects Chrome died, relaunches Chrome, screenshot succeeds |
| 5.5 | Screenshot cleanup | Create screenshots, set cleanup to 1s (for test), wait | Old screenshots deleted; recent ones preserved |
| 5.6 | Config file | Write `{"proxyPort": 9300}` to `~/.config/brw/config.json`, start proxy | Proxy listens on 9300 |
| 5.7 | Env var overrides config file | Config file says port 9300, `BRW_PORT=9400 brw server start` | Proxy listens on 9400 (env wins) |
| 5.8 | Error — Chrome not found | Set `BRW_CHROME_PATH=/nonexistent`, `brw server start` | Error: "Chrome not found at /nonexistent. Install Chrome or set BRW_CHROME_PATH." |
| 5.9 | Error — port in use | Start proxy, then start another on same port | Error: "Port 9225 already in use. Is another brw proxy running? Check: brw server status" |
| 5.10 | Error — CDP connection failed | Start proxy with wrong CDP port | Error: "Cannot connect to Chrome on port 9222. Ensure Chrome is running with --remote-debugging-port=9222." |
| 5.11 | Error — tab not found | `brw screenshot --tab 99999` | Error: "Tab 99999 not found. Available tabs: [list]" |
| 5.12 | Bundle size | `ls -lh skills/brw/scripts/brw.js` | Reasonable size (< 2MB for CLI, < 2MB for proxy) |
| 5.13 | Bundle — no external deps | `node skills/brw/scripts/brw.js --help` in clean env (no node_modules) | Works without npm install |
| 5.14 | Plugin loads in Claude Code | `claude --plugin-dir ./plugins/brw` | Plugin loads without errors; skill appears in `/help` |
| 5.15 | Skill invocation | `/brw:brw` in Claude Code | Skill activates; Claude can run brw commands |
| 5.16 | SessionStart hook | Start Claude Code with plugin, no Node.js in PATH | Hook prints "Node.js not found" warning |
| 5.17 | Multi-agent — separate tabs | Two concurrent processes: each creates a tab and operates on it | No interference; both get correct screenshots |
| 5.18 | Multi-agent — same tab contention | Two concurrent processes screenshot the same tab rapidly | Per-tab mutex serializes; both get valid (non-corrupt) screenshots |
| 5.19 | Headless + headed parity | Run full test suite in both modes | All tests pass in both modes (except window-visibility checks) |
| 5.20 | E2E — Google search | `brw navigate "https://google.com"`, read-page, click search box, type query, key Enter, screenshot | Full workflow succeeds; search results visible |
| 5.21 | E2E — form fill | Navigate to test form, read-page, form-input multiple fields, submit, verify | Form submitted successfully with correct values |
| 5.22 | E2E — SPA navigation | Navigate to a React/SPA app, click links, verify content changes without full page loads | Screenshots reflect SPA state changes |
| 5.23 | E2E — quick mode workflow | `brw quick "N https://google.com\nW\nC <search_x> <search_y>\nT claude code\nK Enter\nW"` | Full search workflow in one quick call |
| 5.24 | URL allowlist — allowed | Set `allowedUrls: ["https://example.com/*"]`, `brw navigate "https://example.com"` | Navigation succeeds |
| 5.25 | URL allowlist — blocked | Set `allowedUrls: ["https://example.com/*"]`, `brw navigate "https://evil.com"` | Error: URL not in allowlist, lists allowed patterns |
| 5.26 | URL allowlist — wildcard port | Set `allowedUrls: ["http://localhost:*"]`, `brw navigate "http://localhost:3000"` | Navigation succeeds |
| 5.27 | URL allowlist — subdomain glob | Set `allowedUrls: ["https://*.myapp.com/*"]`, `brw navigate "https://staging.myapp.com/app"` | Succeeds |
| 5.28 | URL allowlist — empty blocks all | Set `allowedUrls: []`, `brw navigate "https://example.com"` | Error: all navigation blocked |
| 5.29 | URL allowlist — default allows all | No `allowedUrls` configured, `brw navigate "https://anything.com"` | Succeeds |
| 5.30 | URL allowlist — new-tab | Set allowlist, `brw new-tab "https://blocked.com"` | Error: URL not in allowlist |
| 5.31 | URL allowlist — quick mode N | Set allowlist, `brw quick "N https://blocked.com"` | Error: URL not in allowlist |
| 5.32 | URL allowlist — env var | `BRW_ALLOWED_URLS="https://a.com/*,https://b.com/*" brw navigate "https://a.com"` | Succeeds; `brw navigate "https://c.com"` blocked |
| 5.33 | Repo-local config | Create `.claude/brw.json` with `{"headless": true}`, start proxy | Proxy runs headless |
| 5.34 | Repo-local config — allowlist | `.claude/brw.json` with `{"allowedUrls": ["http://localhost:*"]}` | Only localhost URLs allowed |
| 5.35 | Config precedence | `.claude/brw.json` says port 9300, `~/.config/brw/config.json` says 9400, run `brw server start` | Proxy on 9300 (repo-local wins over user) |
| 5.36 | Config precedence — env wins all | `.claude/brw.json` says port 9300, `BRW_PORT=9500 brw server start` | Proxy on 9500 (env wins) |
| 5.37 | `brw config` — shows sources | Set env var + repo config + user config, `brw config` | Each value shows correct source in parentheses |
| 5.38 | `brw config` — no repo config | Run outside a repo (no `.claude/brw.json`), `brw config` | Shows "repo: .claude/brw.json (not found)"; falls through to user/default |
| 5.39 | `brw config` — proxy status | `brw config` with proxy running vs stopped | Shows "running (pid, port)" or "not running" |
| 5.40 | `brw config` — chrome detection | `brw config` | Shows detected Chrome binary path and version |
| 5.41 | Stale PID file | Write dead PID to `~/.config/brw/proxy.pid`, `brw screenshot` | Detects stale PID, starts fresh proxy, screenshot succeeds |
| 5.42 | CDP port occupied by unknown | Start a non-Chrome process on port 9222, `brw server start` | Error: "Port 9222 is in use by another process. Use BRW_CDP_PORT to specify a different port." |
| 5.43 | JSON output structure | Run 10 different commands, parse all outputs | All outputs valid JSON with `ok` field; mutation commands have `screenshot` + `page`; errors have `code` + `hint` |
| 5.44 | Exit codes | Trigger each error type | Exit 1 for usage, 2 for proxy, 3 for CDP, 4 for URL blocked |
| 5.45 | `--debug` flag | `brw --debug screenshot` | stderr shows HTTP request to proxy and CDP commands sent |
| 5.46 | `--timeout` flag | `brw --timeout 1 wait --duration 30` | Times out after ~1s with exit code 2 |
| 5.47 | `--text` output mode | `brw tabs --text` | Human-readable table format, not JSON |
| 5.48 | Page fingerprint consistency | `brw screenshot`, check `page.url`, navigate, `brw screenshot`, check `page.url` changed | `page.url` accurately reflects current page after each command |
| 5.49 | Retry on transient error | Simulate `Target closed` during navigation, verify retry | Command succeeds on retry; no error returned to caller |
| 5.50 | Download tracking | Click download link, verify response | `download` field in response with path, filename, size |

## Spec Deviations

Differences between the spec above and the actual implementation.

### File Structure

- CLI entry point is `src/cli/main.ts` (spec says `src/cli/index.ts`)
- Proxy entry point is `src/proxy/main.ts` (spec says `src/proxy/server.ts`)
- All CLI commands are in a single `src/cli/main.ts` (spec says one file per subcommand in `src/cli/commands/`)
- Accessibility tree script is inlined in `src/proxy/handlers/read-page.ts` (spec says separate `src/scripts/a11y-tree.ts`)
- Added `src/cli/proxy-launcher.ts`, `src/cli/http.ts`, and `src/types/*.d.ts` (not in spec layout)

### Implementation Choices

- Accessibility tree uses custom `Runtime.evaluate` script injection directly (spec says try CDP `Accessibility.getFullAXTree` first)
- Auto-dismissed dialog warnings are returned as a `dialogWarnings` array (spec says generic "warning" in the response)
