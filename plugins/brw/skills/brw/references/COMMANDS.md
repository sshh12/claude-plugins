# brw Command Reference

Full reference for all brw CLI commands, flags, and output formats.

## Global Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--tab, -t <id>` | Target tab ID | Active tab |
| `--plain` | Plain text output instead of JSON | JSON |
| `--http-timeout <seconds>` | CLI request timeout | 30 |
| `--debug` | Verbose logging to stderr | Off |
| `--port <port>` | Proxy server port | 9225 |
| `--no-screenshot` | Skip auto-screenshot on mutation commands | Screenshot on |

## Output Format

### Success (Mutation Commands)

Mutation commands return a screenshot and page fingerprint:

```json
{
  "ok": true,
  "screenshot": "/tmp/brw-screenshots/1709234567890.png",
  "page": {"url": "https://example.com", "title": "Example", "contentLength": 48230}
}
```

Mutation commands: screenshot, click, hover, type, key, scroll, scroll-to, drag, navigate, wait, wait-for, form-input, resize, file-upload, switch-tab, dialog (accept/dismiss), quick.

### Success (Read-Only Commands)

Read-only commands return command-specific fields without screenshot or page:

```json
{"ok": true, "tree": "...", "refCount": 42}
```

Read-only commands: read-page, get-text, js, tabs, new-tab, close-tab, console, network, network-body, cookies, storage, perf, config.

### Error

```json
{
  "ok": false,
  "error": "Tab 99999 not found",
  "code": "TAB_NOT_FOUND",
  "hint": "Available tabs: 1, 2, 3"
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage/argument error |
| 2 | Proxy connection error |
| 3 | Browser/CDP error |
| 4 | URL or protocol blocked by security policy |

---

## Navigation

### `brw navigate`

```bash
brw navigate <url> [--wait dom|network|render|none] [--tab ID]
brw navigate back [--tab ID]
brw navigate forward [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--wait` | `dom` | When to resolve: `dom` (DOMContentLoaded), `network` (network idle 500ms), `render` (full SPA render: readyState complete + network idle + layout stable + paint), `none` (immediately) |

- Auto-prepends `https://` if no protocol given
- `back` and `forward` use browser history
- Returns `download` field if a file download was triggered
- Subject to protocol blocklist (`BRW_BLOCKED_PROTOCOLS`) and URL policy (`BRW_ALLOWED_URLS`, `BRW_BLOCKED_URLS`)
- Blocked protocols by default: `file`, `javascript`, `data`, `chrome`, `chrome-extension`, `view-source`, `ftp`

---

## Screenshot

### `brw screenshot`

```bash
brw screenshot [--full-page] [--ref REF] [--region x1,y1,x2,y2] [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--full-page` | Capture entire scrollable page |
| `--ref` | Crop to element bounding box |
| `--region` | Crop to coordinates `x1,y1,x2,y2` (CSS pixels) |

- Max dimension: 1568px (Claude vision sweet spot)
- Retina displays are downscaled to CSS pixel dimensions
- Screenshots saved to `BRW_SCREENSHOT_DIR` (default: `/tmp/brw-screenshots`)

---

## Mouse

### `brw click`

```bash
brw click <x> <y> [flags] [--tab ID]
brw click --ref <ref_id> [flags] [--tab ID]
brw click --selector <css> [flags] [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--ref` | Click by ref ID from `read-page` |
| `--selector` | Click by CSS selector |
| `--right` | Right click |
| `--double` | Double click |
| `--triple` | Triple click |
| `--modifiers` | Modifier keys: `shift`, `ctrl`, `alt`, `meta`, `cmd+shift`, etc. |

### `brw hover`

```bash
brw hover <x> <y> [--tab ID]
brw hover --ref <ref_id> [--tab ID]
brw hover --selector <css> [--tab ID]
```

### `brw drag`

```bash
brw drag <x1> <y1> <x2> <y2> [--tab ID]
brw drag --from-ref <ref> --to-ref <ref> [--tab ID]
brw drag --from-ref <ref> <x2> <y2> [--tab ID]
```

---

## Keyboard

### `brw type`

```bash
brw type <text> [--clear] [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--clear` | Select all and delete before typing (like Playwright's `fill()`) |

- Types character-by-character into the focused element
- Newlines produce Enter keypresses
- Multi-line text supported

### `brw key`

```bash
brw key <keys> [--repeat N] [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--repeat` | 1 | Number of times to press |

Key names: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `Space`.

Modifiers: `cmd+a`, `ctrl+c`, `shift+Tab`, `alt+F4`, `ctrl+shift+i`.

---

## Page Reading

### `brw read-page`

```bash
brw read-page [--filter all|interactive] [--search TEXT] [--ref REF] [--scope CSS] [--depth N] [--max-chars N] [--frame INDEX|NAME] [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--filter` | `all` | `all` = full tree, `interactive` = inputs/buttons/links only |
| `--search` | — | Case-insensitive text search, returns matching elements |
| `--ref` | — | Return subtree rooted at this ref |
| `--scope` | — | Return subtree rooted at CSS selector (alternative to --ref) |
| `--depth` | unlimited | Max tree depth |
| `--limit` | unlimited | Max number of ref elements to include (truncates tree with hint to use --search) |
| `--include-hidden` | false | Include elements with `aria-hidden="true"` (useful for overlays, compose UIs) |
| `--max-chars` | unlimited | Truncate output |
| `--frame` | main frame | Target iframe by 0-based index, `name`/`id` attribute, or URL substring |

Output: `{"ok": true, "tree": "...", "refCount": 42}`

Additional response fields:
- `hint` — returned when page has canvas elements and tree is sparse (suggests using screenshot/js instead)
- `iframes` — number of iframes on the page (when `--frame` is not used)
- `searchDiagnostics` — returned when `--search` finds no matches (includes query, totalRefs, searchFields, hint)

Notes:
- Returns accessibility tree with ref IDs (e.g., `ref_1`, `ref_2`)
- Ref IDs persist until navigation or DOM mutation (SPAs re-render invalidates refs)
- Select elements include options with selection state
- Iframes appear as placeholders with frame index

### `brw get-text`

```bash
brw get-text [--max-chars N] [--tab ID]
```

Extracts main content text (prefers `<article>`, falls back to `<body>`).

Output: `{"ok": true, "title": "...", "url": "...", "text": "..."}`

### `brw js`

```bash
brw js <expression> [--frame INDEX|NAME] [--tab ID]
brw js --file <path> [--frame INDEX|NAME] [--tab ID]
brw js - [--frame INDEX|NAME] [--tab ID]
cat script.js | brw js [--frame INDEX|NAME] [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--file` | Read JavaScript from a file path |
| `--frame` | Target iframe by index, name, or URL |

Evaluates JavaScript in the page context. Supports `await` for async expressions. Returns serialized result.

Use `-` as the expression or pipe to stdin for complex/multi-line JS to avoid shell quoting issues. **Note**: multi-line heredoc/file input requires explicit `return` for the last value (single-line expressions auto-return the last expression value).

---

## Scroll

### `brw scroll`

```bash
brw scroll <direction> [--amount N] [--at x,y] [--tab ID]
```

| Param | Values |
|-------|--------|
| direction | `up`, `down`, `left`, `right` |
| `--amount` | Number of scroll ticks (default: 3) |
| `--at` | Scroll element at these coordinates instead of the page |

### `brw scroll-to`

```bash
brw scroll-to --ref <ref_id> [--tab ID]
```

Scrolls an element into the viewport center.

---

## Form Input

### `brw form-input`

```bash
brw form-input --ref <ref_id> --value <value> [--tab ID]
brw form-input --selector <css> --value <value> [--tab ID]
```

Sets form element values programmatically, firing `change` and `input` events.

- Text inputs: sets `value` property
- Checkboxes/radio: `--value true` or `--value false`
- Select: `--value "option_value"`
- Contenteditable: sets `textContent`
- Auto-scrolls element into view

---

## Wait

### `brw wait`

```bash
brw wait --duration <seconds> [--tab ID]
```

Simple timed wait.

### `brw wait-for`

```bash
brw wait-for --selector <css> [--timeout N] [--tab ID]
brw wait-for --text <text> [--timeout N] [--tab ID]
brw wait-for --url <glob> [--timeout N] [--tab ID]
brw wait-for --js <expression> [--timeout N] [--tab ID]
brw wait-for --network-idle [--timeout N] [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--timeout` | 10 | Max seconds to wait |

Returns `matched: true/false` — does NOT error on timeout. Polls at 100ms intervals.

Note: `--timeout` here is the handler timeout (how long `wait-for` polls). This is distinct from the global CLI `--timeout` (HTTP socket timeout). The CLI timeout auto-extends when `--timeout` is passed to `wait-for`.

---

## Tabs

### `brw tabs`

```bash
brw tabs [--tab ID]
```

Output: `{"ok": true, "tabs": [{"id": 1, "url": "...", "title": "..."}], "activeTab": 1}`

### `brw new-tab`

```bash
brw new-tab [url] [--wait dom|network|render] [--alias NAME]
```

| Flag | Description |
|------|-------------|
| `--wait` | Wait strategy before returning |
| `--alias` | Atomically assign alias to the new tab (avoids race conditions in multi-agent setups) |

Output: `{"ok": true, "tabId": 2, "url": "...", "alias": "inbox"}`

### `brw switch-tab`

```bash
brw switch-tab <id>
```

`<id>` accepts a numeric tab ID or a named alias (see `name-tab`). Mutation command — returns screenshot of the switched-to tab.

### `brw name-tab`

```bash
brw name-tab <alias> [tabId]
```

Assigns a human-readable alias to the current or specified tab. The alias can then be used anywhere `--tab` or tab IDs are accepted (e.g., `--tab inbox`, `brw switch-tab docs`).

Output: `{"ok": true, "tabId": 2, "alias": "inbox"}`

### `brw close-tab`

```bash
brw close-tab <id>
```

Output: `{"ok": true, "tabs": [...]}`

---

## Dialogs

### `brw dialog`

```bash
brw dialog [--tab ID]                           # Check for pending dialog
brw dialog accept [--text RESPONSE] [--tab ID]  # Accept/OK
brw dialog dismiss [--tab ID]                    # Cancel/dismiss
```

- Auto-dismiss policy: dialogs are dismissed after 5 seconds if not handled
- `--text` provides response for `prompt` dialogs
- Output includes `dialogType`, `message`, `action`

---

## Console & Network

### `brw console`

```bash
brw console [--errors-only] [--pattern REGEX] [--limit N] [--clear] [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--errors-only` | Only error-level messages |
| `--pattern` | Regex filter on message text |
| `--limit` | Max messages to return |
| `--clear` | Clear the buffer after reading |

Output: `{"ok": true, "messages": [{"level": "log", "text": "...", "timestamp": 123, "source": "..."}]}`

### `brw network`

```bash
brw network [--url-pattern PATTERN] [--limit N] [--clear] [--tab ID]
```

Output: `{"ok": true, "requests": [{"id": "...", "method": "GET", "url": "...", "status": 200, "duration": 123, "size": 4096}]}`

### `brw network-body`

```bash
brw network-body <request_id> [--tab ID]
```

Output: `{"ok": true, "body": "...", "base64": false, "mimeType": "application/json"}`

---

## File Upload

### `brw file-upload`

```bash
brw file-upload --ref <ref_id> --files <path> [path2...] [--tab ID]
```

Attaches files to a file input element.

---

## Cookies & Storage

### `brw cookies`

```bash
brw cookies [--all-domains] [--tab ID]                     # List cookies (default: current domain only)
brw cookies get <name> [--tab ID]                          # Get one
brw cookies set <name> <value> [--domain D] [--path P] [--expires EPOCH] [--secure] [--httponly] [--tab ID]
brw cookies delete <name> [--tab ID]
brw cookies clear [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--all-domains` | Show cookies from all domains (default: current tab domain only) |

Cookie listing is scoped to the current tab's domain by default. This prevents cross-domain cookie access via prompt injection. Use `--all-domains` for explicit cross-domain access, or set `cookieScope: "all"` in config.

### `brw storage`

```bash
brw storage get <key> [--session] [--tab ID]
brw storage set <key> <value> [--session] [--tab ID]
brw storage delete <key> [--session] [--tab ID]
brw storage list [--session] [--tab ID]
brw storage clear [--session] [--tab ID]
```

`--session` targets sessionStorage instead of localStorage.

---

## Network Interception

### `brw intercept`

```bash
brw intercept add <url_pattern> [--status CODE] [--body TEXT] [--body-file PATH] [--header "K: V"] [--block] [--tab ID]
brw intercept list [--tab ID]
brw intercept remove <rule_id> [--tab ID]
brw intercept clear [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--status` | Override response status code |
| `--body` | Override response body (inline) |
| `--body-file` | Override response body from file |
| `--header` | Add/override response header (repeatable) |
| `--block` | Block the request entirely |

---

## Viewport & Emulation

### `brw resize`

```bash
brw resize <width> <height> [--tab ID]
```

### `brw emulate`

```bash
brw emulate --device "iPhone 15" [--tab ID]
brw emulate --width 375 --height 812 [--scale 3] [--mobile] [--touch] [--tab ID]
brw emulate --user-agent <ua> [--tab ID]
brw emulate --geolocation <lat>,<lng> [--tab ID]
brw emulate --media prefers-color-scheme=dark [--tab ID]
brw emulate --timezone "America/New_York" [--tab ID]
brw emulate --locale "fr-FR" [--tab ID]
brw emulate reset [--tab ID]
```

---

## PDF & Performance

### `brw pdf`

```bash
brw pdf [--output PATH] [--landscape] [--paper letter|a4|legal|tabloid] [--scale N] [--tab ID]
```

**Note:** PDF generation requires headless mode. Set `BRW_HEADLESS=true` or start with `brw server start --headless`.

### `brw perf`

```bash
brw perf [--tab ID]
```

Returns: DOM node count, DOM depth, JS heap size, paint timing, layout count. Supplements CDP metrics with live Runtime.evaluate data for accurate SPA metrics.

---

## GIF Recording

```bash
brw gif start [--max-frames N] [--tab ID]
brw gif stop [--tab ID]
brw gif export [--output PATH] [--quality N] [--show-clicks] [--show-drags] [--show-labels] [--tab ID]
brw gif clear [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--max-frames` | 200 | Auto-stop after N frames |
| `--quality` | 10 | GIF quality 1-30 (lower = better) |
| `--show-clicks` | true | Red circle overlay at click points |
| `--show-drags` | true | Line overlay for drag paths |
| `--show-labels` | false | Action text labels on frames |

---

## Server Management

```bash
brw server start [--port PORT] [--chrome-data-dir PATH] [--headless]
brw server stop [--port PORT]
brw server restart [--port PORT]
brw server status [--port PORT]
```

- `server stop` kills both the proxy and Chrome (all tabs lost)
- `server restart` restarts only the proxy, keeping Chrome alive (tabs preserved)
- `server status` returns runtime info plus all resolved security config (blockedProtocols, blockedUrls, allowedUrls, disabledCommands, cookieScope, auditLog, etc.)

### `brw log`

```bash
brw log [--lines N]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--lines` | 50 | Number of recent log lines to show |

Shows recent proxy log entries directly from the log file (no running proxy required). Useful for diagnosing Chrome crashes, CDP errors, and tab loss. Logs include timestamps, request durations, and error details.

### `brw config`

```bash
brw config
```

Shows resolved configuration with source for each value (default, env, repo config, user config).

---

## Configuration

Priority (highest wins): Environment variables > `.claude/brw.json` > `~/.config/brw/config.json` > defaults.

| Config | Env Var | Default |
|--------|---------|---------|
| Proxy port | `BRW_PORT` | 9225 |
| CDP port | `BRW_CDP_PORT` | 9222 |
| Chrome data dir | `BRW_DATA_DIR` | `~/.config/brw/chrome-data` |
| Chrome path | `BRW_CHROME_PATH` | Auto-detect |
| Headless | `BRW_HEADLESS` | false |
| Screenshot dir | `BRW_SCREENSHOT_DIR` | `/tmp/brw-screenshots` |
| Idle timeout | `BRW_IDLE_TIMEOUT` | 1800s |
| Window size | `BRW_WIDTH` / `BRW_HEIGHT` | 1280 x 800 |
| URL allowlist | `BRW_ALLOWED_URLS` | `*` (all) |
| URL blocklist | `BRW_BLOCKED_URLS` | `*169.254.169.254*,*metadata.google.internal*` |
| Blocked protocols | `BRW_BLOCKED_PROTOCOLS` | `file,javascript,data,chrome,chrome-extension,view-source,ftp` |
| Disabled commands | `BRW_DISABLED_COMMANDS` | (none) |
| Cookie scope | `BRW_COOKIE_SCOPE` | `tab` |
| Audit log | `BRW_AUDIT_LOG` | (disabled) |
| Allowed paths | `BRW_ALLOWED_PATHS` | (unrestricted) |
| Auto-screenshot | `BRW_AUTO_SCREENSHOT` | true |
| Log file | `BRW_LOG_FILE` | `/tmp/brw-proxy.log` |

---

## App Profiles

### `brw profile list`

```bash
brw profile list
```

Lists all discovered profiles with name, description, match patterns, and available actions.

Output: `{"ok": true, "profiles": [{"name": "...", "description": "...", "actions": [...], "selectors": [...]}]}`

### `brw profile show`

```bash
brw profile show <name>
```

Shows full profile details including action definitions, parameters, selectors map, and observers.

Output: `{"ok": true, "name": "...", "actions": {...}, "selectors": {...}}`

### `brw run`

```bash
brw run <profile>:<action> [--param key=value ...] [--no-screenshot] [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--param` | Action parameters as `key=value` pairs (repeatable) |
| `--no-screenshot` | Skip auto-screenshot (also skipped if action has `noScreenshot: true`) |

Executes a profile action's step sequence. Steps map to existing brw commands (`js`, `click`, `type`, `key`, `form-input`, `wait`, `wait-for`, `navigate`, `scroll`, `hover`, `screenshot`, `read-page`).

JS steps with `file` reference run a JS IIFE from the profile directory in the page context. The IIFE receives action params as its argument and can return data.

Output: `{"ok": true, "screenshot": "...", "page": {...}, "profile": "...", "action": "...", "data": ..., "stepResults": [...]}`

- `data`: return value from the last JS step (if any)
- `stepResults`: array of `{step, action, data}` for JS steps that returned data
