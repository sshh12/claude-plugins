# brw Command Reference

Full reference for all brw CLI commands, flags, and output formats.

## Global Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--tab, -t <id>` | Target tab ID | Active tab |
| `--text` | Plain text output instead of JSON | JSON |
| `--timeout <seconds>` | CLI request timeout | 30 |
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
| 4 | URL blocked by allowlist |

---

## Navigation

### `brw navigate`

```bash
brw navigate <url> [--wait dom|network|none] [--tab ID]
brw navigate back [--tab ID]
brw navigate forward [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--wait` | `dom` | When to resolve: `dom` (DOMContentLoaded), `network` (network idle), `none` (immediately) |

- Auto-prepends `https://` if no protocol given
- `back` and `forward` use browser history
- Returns `download` field if a file download was triggered
- Subject to URL allowlist (`BRW_ALLOWED_URLS`)

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
brw read-page [--filter all|interactive] [--search TEXT] [--ref REF] [--depth N] [--max-chars N] [--frame INDEX|NAME] [--tab ID]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--filter` | `all` | `all` = full tree, `interactive` = inputs/buttons/links only |
| `--search` | — | Case-insensitive text search, returns matching elements |
| `--ref` | — | Return subtree rooted at this ref |
| `--depth` | unlimited | Max tree depth |
| `--max-chars` | unlimited | Truncate output |
| `--frame` | main frame | Target iframe by 0-based index, `name`/`id` attribute, or URL substring |

Output: `{"ok": true, "tree": "...", "refCount": 42}`

- Returns accessibility tree with ref IDs (e.g., `ref_1`, `ref_2`)
- Ref IDs persist until navigation
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
```

Evaluates JavaScript in the page context. Supports `await` for async expressions. Returns serialized result.

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

---

## Tabs

### `brw tabs`

```bash
brw tabs [--tab ID]
```

Output: `{"ok": true, "tabs": [{"id": 1, "url": "...", "title": "..."}], "activeTab": 1}`

### `brw new-tab`

```bash
brw new-tab [url]
```

Output: `{"ok": true, "tabId": 2, "url": "..."}`

### `brw switch-tab`

```bash
brw switch-tab <id>
```

Mutation command — returns screenshot of the switched-to tab.

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
brw cookies [--tab ID]                                     # List all
brw cookies get <name> [--tab ID]                          # Get one
brw cookies set <name> <value> [--domain D] [--path P] [--expires EPOCH] [--secure] [--httponly] [--tab ID]
brw cookies delete <name> [--tab ID]
brw cookies clear [--tab ID]
```

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

### `brw perf`

```bash
brw perf [--tab ID]
```

Returns: DOM node count, JS heap size, paint timing, layout count.

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
brw server status [--port PORT]
```

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
