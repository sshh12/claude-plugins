---
name: brw
description: >-
  Automates browser interactions via Chrome DevTools Protocol.
  Screenshots, clicks, types, navigates, reads page accessibility trees,
  extracts text, and executes JavaScript in web pages. Use when the user
  asks to interact with a website, test a web app, fill web forms, scrape
  web content, or automate browser tasks.
---

# brw — Browser Automation

## Setup

**Step 1 — one-time bootstrap** (the only command that uses a node path):

```bash
node "${SKILL_DIR}/scripts/brw.js" install
```

This symlinks `brw` into `~/.local/bin`. If `~/.local/bin` is not yet on your `PATH`, the command prints a `nextSteps` block containing an `exportLine` — append that `exportLine` to your shell profile (the printed profile path), then restart the session so `brw` resolves.

**Step 2 — HARD ASSERT before any brw use** (checks both that `brw` is on PATH *and* that it is this exact build — an older/shadowing `brw` earlier on PATH would silently run stale code):

```bash
[ "$(brw --version 2>/dev/null)" = "$(node "${SKILL_DIR}/scripts/brw.js" --version 2>/dev/null)" ] && echo BRW_OK || echo BRW_STALE
```

If this prints `BRW_STALE` (bare `brw` is missing, or an older/different `brw` is winning on PATH), run `node "${SKILL_DIR}/scripts/brw.js" install` and apply its `nextSteps` (it reports `shadowedBy` / `onPathVersion` and how to fix), restart the session, then re-run this check. DO NOT proceed using `node` or absolute paths for real work — once `BRW_OK`, every command MUST be the bare `brw ...`.

**Prerequisites**: Node.js 18+, a Chromium-based browser (Chrome, Chromium, Edge, or Brave).

## Proxy Lifecycle

The proxy is a **per-user daemon** listening on a private Unix domain socket (mode `0600`) at `~/.config/brw/proxy.sock` — there is no TCP port. It starts automatically on first command and stays running for **4 hours** of idle time (configurable via `BRW_IDLE_TIMEOUT`). You do not need to restart it between commands. Intercept rules, console captures, and network captures all persist within a session. Chrome is driven over `--remote-debugging-pipe` (no debug port is opened).

```bash
brw server status                     # Check if proxy is running
brw server start                      # Manually start (usually not needed)
brw server start --clean              # Kill all debug-mode browsers, then start fresh
brw server stop                       # Stop proxy and Chrome
brw server restart                    # Relaunch the proxy and Chrome
brw server clean                      # Kill all debug-mode browsers and clean up state
```

`server restart` relaunches Chrome, so any open tabs are lost. Login state and cookies persist because they live in the on-disk Chrome profile directory, not in the running process.

## Workflow

1. **Screenshot** to see current state: `brw screenshot`
2. **Read page** to understand structure: `brw read-page` or `brw read-page --filter interactive`
3. **Interact** via click/type/key/navigate — each returns an auto-screenshot
4. **Read the screenshot** to verify the result, then repeat

This screenshot-act-verify loop is the core pattern. Every mutation command returns a screenshot path — read it to see what happened.

## Output Format

All commands return JSON:

```jsonc
// Mutation commands (click, type, navigate, etc.)
{"ok": true, "screenshot": "~/.config/brw/screenshots/123.png", "page": {"url": "...", "title": "...", "contentLength": 48230}}

// Read-only commands (read-page, get-text, tabs, etc.)
{"ok": true, "tree": "...", "refCount": 42}

// Errors
{"ok": false, "error": "Tab not found", "code": "TAB_NOT_FOUND", "hint": "Available tabs: 1, 2, 3"}
```

Check `page.url` between commands to detect unexpected navigations. On error, read `code` and `hint` for recovery guidance.

## Core Commands

### Navigation

```bash
brw navigate <url>                    # Go to URL (auto-prepends https://)
brw navigate back                     # Go back
brw navigate forward                  # Go forward
brw navigate <url> --wait network     # Wait for network idle (default: dom)
brw navigate <url> --wait render      # Full SPA render wait (network + layout stable + paint)
```

### Screenshot

```bash
brw screenshot                        # Current viewport
brw screenshot --full-page            # Entire scrollable page
brw screenshot --ref ref_3            # Single element
brw screenshot --region 0,0,500,300   # Crop to region
```

### Click

```bash
brw click <x> <y>                    # Left click at coordinates
brw click --ref ref_5                 # Click element by ref ID
brw click --selector "button.submit"  # Click by CSS selector
brw click --text "Save and Continue"   # Click by visible text (no read-page needed)
brw click --label "Email"              # Click form input by label
brw click --text "Submit" --wait       # Wait up to 10s for element, then click
brw click <x> <y> --right            # Right click
brw click <x> <y> --double           # Double click
```

### Type & Key

```bash
brw type "hello world"               # Type into focused element
brw type "new text" --clear           # Clear field first, then type
brw type "hello" --text "Search"       # Focus element by text, then type
brw type "test@email.com" --label "Email" --clear  # Focus by label, clear, type
brw key Enter                         # Press Enter
brw key "cmd+a"                       # Keyboard shortcut
brw key Tab --repeat 3                # Press Tab 3 times
```

### Read Page (Accessibility Tree)

```bash
brw read-page                         # Full a11y tree with ref IDs
brw read-page --filter interactive    # Only interactive elements (inputs, buttons, links)
brw read-page --search "Submit"       # Search for elements by text
brw read-page --ref ref_5             # Subtree rooted at ref
brw read-page --depth 2              # Limit tree depth
brw read-page --frame 0              # Read iframe content
brw read-page --limit 50             # Cap at 50 ref elements (use --search to narrow)
brw read-page --include-hidden       # Include aria-hidden="true" elements (overlays, compose UIs)
```

The tree includes ref IDs (like `ref_1`, `ref_2`) that can be used with `--ref` in other commands. Refs persist until navigation.

### Get Text

```bash
brw get-text                          # Extract main content text
brw get-text --max-chars 500          # Limit output length
```

### Form Input

Set form values programmatically (triggers change/input events):

```bash
brw form-input --ref ref_3 --value "test@example.com"  # Text input
brw form-input --ref ref_7 --value true                 # Checkbox
brw form-input --ref ref_9 --value "option2"            # Select dropdown
brw form-input --label "Password" --value "secret"   # Find by label text
brw form-input --text "Username" --value "john"       # Find by accessible name
brw form-input --selector "#email" --value "test@example.com"
```

### JavaScript

```bash
brw js "document.title"                           # Evaluate expression
brw js --file /tmp/script.js                      # Read JS from file
brw js "await fetch('/api').then(r => r.json())"  # Async expression
brw js "document.title" --frame 0                 # Execute in iframe
brw js - <<'JS'                                   # Heredoc (recommended for multi-line)
document.querySelectorAll('a').forEach(a => console.log(a.href))
JS
```

For complex or multi-line JS, use heredoc (`brw js - <<'JS'`) or `--file` to avoid shell quoting issues. `await` in heredoc/file input is auto-wrapped in an async IIFE — no manual wrapping needed. **Note**: multi-line heredoc input requires explicit `return` for the last value (single-line expressions auto-return).

### Scroll

```bash
brw scroll down                       # Scroll down (default amount)
brw scroll down --amount 5            # Scroll down 5 ticks
brw scroll up                         # Scroll up
brw scroll down --at 200,400          # Scroll element at coordinates
brw scroll-to --ref ref_12            # Scroll element into view
```

### Hover & Drag

```bash
brw hover <x> <y>                    # Hover at coordinates
brw hover --ref ref_3                 # Hover over element
brw drag 100 100 300 300              # Drag from (100,100) to (300,300)
brw drag --from-ref ref_1 --to-ref ref_5  # Drag between elements
```

### Wait

```bash
brw wait --duration 2                 # Wait 2 seconds
brw wait-for --selector ".modal"      # Wait for element to appear
brw wait-for --text "Success"         # Wait for text on page
brw wait-for --url "*/dashboard*"     # Wait for URL change
brw wait-for --js "window.loaded"     # Wait for JS condition
brw wait-for --network-idle           # Wait for network to settle
```

`wait-for` returns `matched: true/false` — it does not error on timeout.

### Tabs

```bash
brw tabs                              # List all tabs
brw new-tab "https://example.com"     # Open URL in new tab
brw new-tab "https://example.com" --wait dom  # Open and wait for page load
brw switch-tab <id>                   # Switch to tab (accepts ID or alias)
brw close-tab <id>                    # Close tab
brw name-tab inbox                    # Name active tab "inbox"
brw name-tab docs 2                   # Name tab 2 "docs"
```

Named tabs can be used anywhere `--tab` is accepted (e.g., `--tab inbox`).

### Dialog Handling

```bash
brw dialog                            # Check for pending dialog
brw dialog accept                     # Accept/OK
brw dialog dismiss                    # Cancel/dismiss
brw dialog accept --text "response"   # Respond to prompt dialog
```

Dialogs auto-dismiss after 5 seconds if not handled explicitly.

## Advanced Commands

### Console & Network

```bash
brw console                           # Read captured console messages
brw console --errors-only             # Only errors
brw network                           # Read captured network requests (slim)
brw network --url-pattern "api"       # Filter by URL
brw network --full                    # Include request headers/body in each entry
brw network-request <request_id>      # Show full captured request (method, headers, body)
brw network-body <request_id>         # Get response body
```

### Script Run & Generate

For data extraction or batch workflows, drive the app's APIs from the page context rather than clicking through the DOM. The script runs in the active tab's runtime, so `fetch(..., { credentials: 'include' })` reuses the page's cookies, CSRF tokens, and session.

```bash
brw script run /tmp/x.js [--param k=v] [--timeout 120] [--output /tmp/x.json]
brw script run --inline "return document.title"      # one-off
brw script run - <<'JS' ... JS                       # stdin
brw script gen --url-pattern <subs> --output /tmp/x.js   # starter from captured requests
```

Discovery companions:

```bash
brw auth-tokens --tab <alias> [--probe <url>]         # list creds, decode JWTs, canary fetch
brw network --url-pattern A --url-pattern B --status 4xx --with-body-preview 300 --tab <alias>
brw network-request <id> --tab <alias>                # full single request, auto-parses JSON bodies
```

Globals injected inside `script run`: `args`, `log(...)`, `sleep(ms)`, `cookie(name)`, `xssiUnwrap(text)`, `gjson(responseOrText)`. Top-level `await` and `return <value>` work.

**Full guide**: see `references/SCRIPT-WORKFLOW.md` for the 5-step discovery loop, auth/pagination/response-shape taxonomy, gotchas, and DOM fallback recipe.

### File Upload

```bash
brw file-upload --ref ref_3 --files /path/to/file.txt
brw file-upload --ref ref_3 --files /tmp/a.txt /tmp/b.txt  # Multiple files
```

### Cookies & Storage

```bash
brw cookies                           # List cookies for current tab domain
brw cookies --all-domains             # List all cookies across domains
brw cookies get "session_id"          # Get specific cookie
brw cookies set "name" "value"        # Set cookie
brw storage get "key"                 # Get localStorage value
brw storage set "key" "value"         # Set localStorage value
```

### Network Interception

```bash
brw intercept add "*/api/data" --status 200 --body '{"mock": true}'
brw intercept add "*analytics*" --block
brw intercept list
brw intercept remove <rule_id>
brw intercept clear
```

### Other

```bash
brw new-tab <url> --window             # Open in separate Chrome window
brw arrange                           # Tile all windows in a grid
brw window-bounds                     # Get/set window position and size
brw resize 800 600                    # Resize viewport
brw pdf --output report.pdf           # Save page as PDF
brw emulate --device "iPhone 15"      # Device emulation
brw perf                              # Performance metrics
brw gif start                         # Start GIF recording
brw gif stop                          # Stop recording
brw gif export --output demo.gif      # Export animated GIF
brw server status                     # Check proxy status
brw server stop                       # Stop proxy and Chrome
brw log                               # Show recent proxy log entries
brw log --lines 100                   # Show last 100 log lines
```

## Quick Mode

Chain multiple simple actions in one call to reduce round-trips:

```bash
brw quick "N https://example.com
W
C 500 300
T hello world
K Enter"
```

Ref-based commands are also available: `CR ref_5` (click ref), `FR ref_3 value` (form-input ref), `R` (read-page), `WF --text "Done"` (wait-for).

Text-based commands: `CT Submit` (click by text), `FT Email test@example.com` (form-input by label).

Returns a screenshot after the final command. See `references/QUICK-MODE.md` for the full command table.

## Tips

- **Semantic targeting**: Use `--text`/`--label` instead of `--ref` when element text is stable — skips the read-page step. Add `--wait` for dynamic content.
- **Multi-page wizards**: Chain `CT` + `WF` across pages in one quick call: `CT Next\nWF --text "Step 2"`. For JS-heavy forms, `J document.querySelector('form').submit()` + `WF --url */next*` skips coordinate resolution. Use `W 3` for fixed pauses between pages.
- **Refs over coordinates**: Prefer `--ref ref_X` over coordinate clicks — refs are more reliable and survive scrolling.
- **Skip auto-screenshot**: Use `--no-screenshot` when chaining actions before a manual screenshot. Saves time.
- **SPAs**: Use `--wait render` for SPAs. For heavy apps (Gmail), prefer `--wait dom` + `wait-for --selector`.
- **Iframes**: Use `--frame 0` (by index) or `--frame "name"` for iframe content. `read-page` returns `iframes: N` when iframes exist.
- **Multi-agent**: Each agent uses its own tab. Use `new-tab <url> --wait dom --alias <name>` for atomic tab creation + naming.
- **Complex pages**: If `--search` errors, narrow with `--scope "main"` first or use `--filter interactive --limit 50`.
- **Canvas apps**: `read-page` returns a hint when canvas is detected. Use `screenshot` + `js` instead.
- **Hidden overlays (Gmail compose)**: Use `--include-hidden` or `--scope "[role='dialog']"`.
- **Global flags**: `--tab <alias>` targets a specific tab, `--no-screenshot` skips screenshots.

Most tips are also returned as contextual `hint` fields in CLI responses when relevant (e.g., REF_NOT_FOUND, canvas pages, search failures).

## Configuration

Set via environment variables (`BRW_*`), `.claude/brw.json` (per-repo), or `~/.config/brw/config.json` (user). Run `brw config` to see resolved values.

Key variables: `BRW_HEADLESS`, `BRW_CHROME_PATH`, `BRW_SOCKET`, `BRW_SCREENSHOT_DIR`, `BRW_ALLOWED_URLS`, `BRW_AUTO_SCREENSHOT` (set to `false` to disable auto-screenshots on mutation commands — useful for automation loops).

## Security

brw blocks dangerous protocols (`file://`, `javascript:`, `data:`, etc.) and cloud metadata endpoints by default. Cookies are scoped to the current tab's domain. Run `brw server status` to see the active security posture. See `references/SECURITY.md` for the full threat model, recommended configs, and per-command security notes.

## App Profiles

Profiles package app-specific automation (selectors, JS scripts, multi-step actions) into reusable config directories. Instead of repeating workarounds in every prompt, call profile actions directly:

```bash
brw profile list                                          # List available profiles
brw profile show google-docs                              # Show profile actions/selectors
brw run google-docs:read-content                          # Run a profile action
brw run google-docs:type-text --param text="Hello"        # Run with parameters
```

Profiles live in `.claude/brw/profiles/<name>/` (repo) or `~/.config/brw/profiles/<name>/` (user). See `references/PROFILES.md` for authoring details.

## References

- **Script workflow**: `references/SCRIPT-WORKFLOW.md` — DOM → API conversion playbook; auth/pagination/response-shape patterns; per-app cheat sheet
- **Full command reference**: `references/COMMANDS.md` — all flags, output fields, and edge cases
- **Security reference**: `references/SECURITY.md` — threat model, default protections, recommended configs
- **Quick mode reference**: `references/QUICK-MODE.md` — command table and multi-step examples
- **App profiles reference**: `references/PROFILES.md` — profile format, discovery, authoring guide
