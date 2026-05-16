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

Read-only commands: read-page, get-text, js, tabs, new-tab, close-tab, console, network, network-request, network-body, cookies, storage, perf, config, auth-tokens, script run, script gen.

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

All mouse/form commands support element targeting by: `--ref` (from read-page), `--selector` (CSS), `--text` (visible name), `--label` (form label), or coordinates. Priority: ref > selector > text > label > coordinates.

### `brw click`

```bash
brw click <x> <y> [flags] [--tab ID]
brw click --ref <ref_id> [flags] [--tab ID]
brw click --selector <css> [flags] [--tab ID]
brw click --text <text> [flags] [--tab ID]
brw click --label <label> [flags] [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--ref` | Click by ref ID from `read-page` |
| `--selector` | Click by CSS selector |
| `--text` | Click interactive element by visible text (case-insensitive substring match) |
| `--label` | Click form input by associated label text |
| `--wait [N]` | Wait up to N seconds for element (default 10, max 30). Works with --text, --label, --selector |
| `--right` | Right click |
| `--double` | Double click |
| `--triple` | Triple click |
| `--modifiers` | Modifier keys: `shift`, `ctrl`, `alt`, `meta`, `cmd+shift`, etc. |

### `brw hover`

```bash
brw hover <x> <y> [--tab ID]
brw hover --ref <ref_id> [--tab ID]
brw hover --selector <css> [--tab ID]
brw hover --text <text> [--tab ID]
brw hover --label <label> [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--text` | Hover interactive element by visible text |
| `--label` | Hover form input by label |
| `--wait [N]` | Wait up to N seconds for element |

### `brw drag`

```bash
brw drag <x1> <y1> <x2> <y2> [--tab ID]
brw drag --from-ref <ref> --to-ref <ref> [--tab ID]
brw drag --from-ref <ref> <x2> <y2> [--tab ID]
brw drag --from-text <text> --to-text <text> [--tab ID]
brw drag --from-label <label> --to-label <label> [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--from-text` | Start element by visible text |
| `--to-text` | End element by visible text |
| `--from-label` | Start element by label |
| `--to-label` | End element by label |

---

## Keyboard

### `brw type`

```bash
brw type <text> [--clear] [--tab ID]
brw type <text> --text <target> [--clear] [--tab ID]
brw type <text> --label <label> [--clear] [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--ref` | Focus element by ref before typing |
| `--selector` | Focus element by CSS selector before typing |
| `--text` | Focus element by visible text before typing |
| `--label` | Focus form input by label before typing |
| `--wait [N]` | Wait up to N seconds for element |
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

Evaluates JavaScript in the page context. Returns the serialized result.

Use `-` as the expression or pipe to stdin for complex/multi-line JS to avoid shell quoting issues. Multi-line inputs are auto-wrapped in an async IIFE — top-level `await` and top-level `return <value>` both work. Single-line expressions auto-return the expression value (no `return` needed).

For larger scripts with `--param key=value` arguments, helper globals (`log`, `sleep`, `cookie`, `gjson`, `xssiUnwrap`), and a `{result, logs, durationMs}` envelope, use `brw script run` instead.

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
brw form-input --text <text> --value <value> [--tab ID]
brw form-input --label <label> --value <value> [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--text` | Find element by visible text |
| `--label` | Find form input by label text |
| `--wait [N]` | Wait up to N seconds for element |

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
brw new-tab [url] [--wait dom|network|render] [--alias NAME] [--viewport WxH] [--window]
```

| Flag | Description |
|------|-------------|
| `--wait` | Wait strategy before returning |
| `--alias` | Atomically assign alias to the new tab (avoids race conditions in multi-agent setups) |
| `--viewport <WxH>` | Override the tab's viewport before first paint (e.g. `1600x4000`). Useful for virtualized lists that mount only what fits on-screen. |
| `--window` | Open in a new Chrome window rather than a tab |

Output: `{"ok": true, "tabId": 2, "url": "...", "alias": "inbox", "viewport": {"width": 1600, "height": 4000}}`

If the page redirects after load (e.g. an app silently sends you to /login when not authenticated), the response includes a `redirect` field:

```json
{"ok": true, "tabId": 2, "url": "...", "redirect": {"from": "https://app.example.com/main", "to": "https://app.example.com/login", "loginPageHeuristic": true}}
```

`loginPageHeuristic: true` is set when the final path matches `/login|/signin|/auth|/sso|/oauth`.

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
brw network [--url-pattern P]... [--status CODE]... [--limit N] [--clear] [--full] [--with-body-preview N] [--tab ID]
```

| Flag | Description |
|------|-------------|
| `--url-pattern` | URL substring filter. Repeatable (OR-matched) or comma-separated (`--url-pattern A --url-pattern B`, or `--url-pattern A,B`) |
| `--status` | Status code filter. Repeatable. Accepts exact (`--status 401`) or class (`--status 4xx`, `--status 2xx`) |
| `--limit` | Take the last N matching requests |
| `--clear` | Clear the buffer after reading |
| `--full` | Include `requestHeaders`, `requestBody`, and (when applicable) `requestBodyJson` / `requestBodyForm` (auto-parsed) per entry |
| `--with-body-preview [chars]` | Fetch and inline the first N chars of each matched response body (default 300, max 2000). The XSSI prefix `)]}'` is stripped automatically. |

Output: `{"ok": true, "requests": [{"id": "...", "method": "GET", "url": "...", "status": 200, "duration": 123, "size": 4096, "resourceType": "Fetch"}]}`

With `--full`, each entry includes `requestHeaders`, `requestBody` (gzipped/deflate/br request bodies are transparently decoded), and either `requestBodyJson` (when the body is JSON) or `requestBodyForm` (when it's URL-encoded with JSON values, e.g. Google's `f.req=<URL-encoded JSON>`).

With `--with-body-preview N`, each entry also includes `bodyPreview` (first N chars of the response body), `bodyTruncated` (boolean), and `bodyTotalSize`.

### `brw network-request`

```bash
brw network-request <request_id> [--tab ID]
```

Returns the full captured request — method, URL, headers, body, response status, duration, size. Auto-parses JSON / form-encoded JSON request bodies (same `requestBodyJson` / `requestBodyForm` fields as `network --full`).

Output: `{"ok": true, "request": {...same shape as network entry but always full...}}`

### `brw network-body`

```bash
brw network-body <request_id> [--tab ID]
```

Output: `{"ok": true, "body": "...", "base64": false, "mimeType": "application/json"}`

---

## Auth Tokens

### `brw auth-tokens`

```bash
brw auth-tokens [--verbose] [--probe URL] [--probe-method GET|POST|...] [--probe-body BODY] [--tab ID]
```

Enumerates session credentials present in the current tab:
- Non-httpOnly cookies (`--verbose` includes httpOnly cookies too — they aren't readable from JS but are auto-sent with `credentials: 'include'`)
- `localStorage` and `sessionStorage` entries
- The most recently captured `Authorization` / `csrf-token` / `x-csrf-token` / `x-xsrf-token` / `x-framework-xsrf-token` request header values

JWT-shaped values have their `payload` claims decoded inline (so `custom:user_id`, `email`, `exp` etc. appear without manual base64-decoding).

With `--probe <url>`, the command additionally fires a same-origin fetch from the page context and reports the status code + body preview. Useful for confirming "am I logged in?" in one call.

| Flag | Description |
|------|-------------|
| `--verbose` | Include httpOnly cookies in the listing |
| `--probe` | Fire a request to this URL after listing tokens. Includes `credentials: 'include'`. |
| `--probe-method` | HTTP method for `--probe` (default GET) |
| `--probe-body` | Request body for `--probe` (sent as `application/json`) |

Output:

```json
{
  "ok": true,
  "count": 12,
  "summary": {
    "total": 12,
    "nonEmpty": 11,
    "hasJwt": true,
    "hasCapturedAuth": true,
    "hasSessionCookie": true,
    "likelyLoggedIn": true
  },
  "probe": {
    "url": "https://app.example.com/api/me",
    "method": "GET",
    "status": 200,
    "ok": true,
    "durationMs": 88,
    "bodyPreview": "{\"id\":42,\"email\":...}"
  },
  "tokens": [
    {"source": "cookie", "key": "session", "value": "abc...", "scheme": "csrf-session-id"},
    {"source": "localStorage", "key": "auth", "value": "eyJ...", "scheme": "jwt",
     "jwtClaims": {"sub": "...", "exp": 1234567890, "custom:user_id": "42"}}
  ]
}
```

The `likelyLoggedIn` heuristic uses cookie/JWT/captured-Authorization presence by default; with `--probe` it's refined by the status code. **403 does not downgrade** `likelyLoggedIn` — 403 commonly means "you're authenticated but missing a CSRF header", not "logged out". Only 401 reliably indicates no session.

---

## Script Run & Generate

### `brw script run`

```bash
brw script run [path.js | -] [--inline CODE] [--param key=value]... [--frame TARGET] [--timeout N] [--output PATH] [--tab ID]
```

Runs a `.js` script inside the active tab's runtime — the script has access to the page's cookies, session, CSRF tokens, etc. via `fetch(url, { credentials: 'include' })`. The script body is wrapped in an `async` IIFE, so it may use top-level `await` and `return` a value.

Three input modes:
- **File path**: `brw script run /tmp/x.js`
- **Stdin**: `brw script run - <<'JS' ... JS`
- **Inline**: `brw script run --inline "return document.title"`

Injected globals available inside the script body:

| Name | Description |
|------|-------------|
| `args` | Object built from `--param key=value` pairs |
| `log(...)` | Appends a line to the returned `logs` array |
| `sleep(ms)` | Returns a promise resolving after `ms` |
| `cookie(name)` | Reads a non-httpOnly cookie by name (URL-decoded, quote-stripped) |
| `xssiUnwrap(text)` | Strips the `)]}'` XSSI prefix used by some Google APIs |
| `gjson(responseOrText)` | `xssiUnwrap` + `JSON.parse` in one call (accepts a Response or a string) |

| Flag | Description |
|------|-------------|
| `--param key=value` | Add to `args` (repeatable) |
| `--inline <code>` | Run the given source instead of reading a file |
| `--frame` | Run in an iframe context (by index, name, or URL) |
| `--timeout` | Max script duration in seconds (default 60, max 600) |
| `--output <path>` | Write the JSON result envelope to this path. Stdout returns only a slim summary (`{ok, output, bytesWritten, durationMs, logsCount, hint}`) so large results don't flood the terminal. |

Output (no `--output`):

```json
{"ok": true, "result": <whatever-the-script-returned>, "logs": ["..."], "durationMs": 1234}
```

On script throw: `{"ok": false, "code": "SCRIPT_ERROR", "error": "...", "stack": "...", "logs": [...], "durationMs": 12}`.

Example:

```js
// /tmp/pull.js
const csrf = cookie('JSESSIONID');     // helper auto-injected
const res = await fetch('/voyager/api/feed/updates', {
  credentials: 'include',
  headers: { 'csrf-token': csrf },
});
log(`status: ${res.status}`);
return await res.json();
```

```bash
/tmp/brw script run /tmp/pull.js --timeout 30 --output /tmp/pull.json
```

### `brw script gen`

```bash
brw script gen [--url-pattern P]... [--method M]... [--status-min CODE] [--limit N] [--output PATH] [--tab ID]
```

Generates a runnable `.js` script from captured network requests. Each matched request becomes an `await fetch(url, {method, headers, credentials:'include', body})` block.

| Flag | Description |
|------|-------------|
| `--url-pattern` | Substring URL filter. Repeatable (OR-matched) or comma-separated. |
| `--method` | Filter by HTTP method, repeatable (e.g. `--method POST --method PUT`) |
| `--status-min` | Skip responses below this status |
| `--limit` | Take the last N matching requests |
| `--output` | Write to file. Without it, the script source is returned in the JSON response |

The generator **strips** `Cookie`, `Authorization`, `Host`, `Connection`, `Content-Length`, `sec-*` headers, and HTTP/2 pseudo-headers. Cookies are auto-attached by the browser via `credentials: 'include'`.

The generated file includes:
1. An **auth-handling banner** explaining when `credentials: 'include'` is sufficient and when you need to read tokens at runtime (SPA bearer-token apps like Whoop or X/Twitter).
2. A `STRIPPED_HEADERS` reference comment block listing every header that was removed, per-request — so you can see what was stripped and re-add anything the server actually needs at script runtime.
3. One `await fetch(...)` per captured request.

A `HEADS-UP` block appears at the top if any captured request included an `Authorization` header (the browser will *not* auto-send `Authorization`; you have to read it from a cookie/storage and re-add it).

Output: `{"ok": true, "count": 7, "source": "...", "output": "/tmp/foo.js"}`

Typical workflow:

```bash
# 1. Open + survey
/tmp/brw new-tab https://app.example.com --alias tab-x --wait dom
/tmp/brw auth-tokens --probe https://app.example.com/api/me --tab tab-x

# 2. Trigger and discover
/tmp/brw navigate https://app.example.com/feed --tab tab-x
/tmp/brw network --url-pattern api --with-body-preview 300 --tab tab-x
/tmp/brw network-request <id> --tab tab-x

# 3. Generate starter and edit
/tmp/brw script gen --url-pattern api/feed --output /tmp/feed-pull.js --tab tab-x

# 4. Run
/tmp/brw script run /tmp/feed-pull.js --output /tmp/feed.json --tab tab-x
```

See `references/SCRIPT-WORKFLOW.md` for the full runbook (auth patterns, pagination types, response shapes, gotchas).

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
brw server start [--port PORT] [--chrome-data-dir PATH] [--headless] [--clean]
brw server stop [--port PORT]
brw server restart [--port PORT]
brw server status [--port PORT]
brw server clean [--port PORT]
```

- `server start --clean` kills all debug-mode browsers and cleans up state before starting
- `server stop` kills both the proxy and Chrome (all tabs lost)
- `server restart` restarts only the proxy, keeping Chrome alive (tabs preserved)
- `server status` returns runtime info plus all resolved security config (blockedProtocols, blockedUrls, allowedUrls, disabledCommands, cookieScope, auditLog, etc.)
- `server clean` kills all browsers running with `--remote-debugging-port`, stops the proxy, and removes stale state (PID file, SingletonLock). Use for a clean slate when debug browsers from previous sessions block the CDP port

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
