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

Run any command once to auto-create the `/tmp/brw` shortcut:

```bash
node "${SKILL_DIR}/scripts/brw.js" --help
```

Then use `/tmp/brw` for all subsequent commands. **Prerequisites**: Node.js 18+, a Chromium-based browser (Chrome, Chromium, Edge, or Brave).

The proxy server auto-starts on first command. Chrome launches headed by default (set `BRW_HEADLESS=true` for headless).

## Proxy Lifecycle

The proxy is a **persistent daemon** — it starts automatically on first command and stays running for **4 hours** of idle time (configurable via `BRW_IDLE_TIMEOUT`). You do not need to restart it between commands. Intercept rules, console captures, and network captures all persist within a session.

```bash
/tmp/brw server status                     # Check if proxy is running
/tmp/brw server start                      # Manually start (usually not needed)
/tmp/brw server stop                       # Stop proxy and Chrome
```

If Chrome crashes, the proxy auto-relaunches on the next command. Sessions, cookies, and tabs survive proxy restarts because the proxy reconnects to an existing Chrome if one is already running on the CDP port.

## Workflow

1. **Screenshot** to see current state: `/tmp/brw screenshot`
2. **Read page** to understand structure: `/tmp/brw read-page` or `/tmp/brw read-page --filter interactive`
3. **Interact** via click/type/key/navigate — each returns an auto-screenshot
4. **Read the screenshot** to verify the result, then repeat

This screenshot-act-verify loop is the core pattern. Every mutation command returns a screenshot path — read it to see what happened.

## Output Format

All commands return JSON:

```jsonc
// Mutation commands (click, type, navigate, etc.)
{"ok": true, "screenshot": "/tmp/brw-screenshots/123.png", "page": {"url": "...", "title": "...", "contentLength": 48230}}

// Read-only commands (read-page, get-text, tabs, etc.)
{"ok": true, "tree": "...", "refCount": 42}

// Errors
{"ok": false, "error": "Tab not found", "code": "TAB_NOT_FOUND", "hint": "Available tabs: 1, 2, 3"}
```

Check `page.url` between commands to detect unexpected navigations. On error, read `code` and `hint` for recovery guidance.

## Core Commands

### Navigation

```bash
/tmp/brw navigate <url>                    # Go to URL (auto-prepends https://)
/tmp/brw navigate back                     # Go back
/tmp/brw navigate forward                  # Go forward
/tmp/brw navigate <url> --wait network     # Wait for network idle (default: dom)
/tmp/brw navigate <url> --wait render      # Full SPA render wait (network + layout stable + paint)
```

### Screenshot

```bash
/tmp/brw screenshot                        # Current viewport
/tmp/brw screenshot --full-page            # Entire scrollable page
/tmp/brw screenshot --ref ref_3            # Single element
/tmp/brw screenshot --region 0,0,500,300   # Crop to region
```

### Click

```bash
/tmp/brw click <x> <y>                    # Left click at coordinates
/tmp/brw click --ref ref_5                 # Click element by ref ID
/tmp/brw click --selector "button.submit"  # Click by CSS selector
/tmp/brw click <x> <y> --right            # Right click
/tmp/brw click <x> <y> --double           # Double click
```

### Type & Key

```bash
/tmp/brw type "hello world"               # Type into focused element
/tmp/brw type "new text" --clear           # Clear field first, then type
/tmp/brw key Enter                         # Press Enter
/tmp/brw key "cmd+a"                       # Keyboard shortcut
/tmp/brw key Tab --repeat 3                # Press Tab 3 times
```

### Read Page (Accessibility Tree)

```bash
/tmp/brw read-page                         # Full a11y tree with ref IDs
/tmp/brw read-page --filter interactive    # Only interactive elements (inputs, buttons, links)
/tmp/brw read-page --search "Submit"       # Search for elements by text
/tmp/brw read-page --ref ref_5             # Subtree rooted at ref
/tmp/brw read-page --depth 2              # Limit tree depth
/tmp/brw read-page --frame 0              # Read iframe content
/tmp/brw read-page --limit 50             # Cap at 50 ref elements (use --search to narrow)
```

The tree includes ref IDs (like `ref_1`, `ref_2`) that can be used with `--ref` in other commands. Refs persist until navigation.

### Get Text

```bash
/tmp/brw get-text                          # Extract main content text
/tmp/brw get-text --max-chars 500          # Limit output length
```

### Form Input

Set form values programmatically (triggers change/input events):

```bash
/tmp/brw form-input --ref ref_3 --value "test@example.com"  # Text input
/tmp/brw form-input --ref ref_7 --value true                 # Checkbox
/tmp/brw form-input --ref ref_9 --value "option2"            # Select dropdown
/tmp/brw form-input --selector "#email" --value "test@example.com"
```

### JavaScript

```bash
/tmp/brw js "document.title"                           # Evaluate expression
/tmp/brw js --file /tmp/script.js                      # Read JS from file
/tmp/brw js "await fetch('/api').then(r => r.json())"  # Async expression
/tmp/brw js "document.title" --frame 0                 # Execute in iframe
/tmp/brw js - <<'JS'                                   # Heredoc (recommended for multi-line)
document.querySelectorAll('a').forEach(a => console.log(a.href))
JS
```

For complex or multi-line JS, use heredoc (`brw js - <<'JS'`) or `--file` to avoid shell quoting issues.

### Scroll

```bash
/tmp/brw scroll down                       # Scroll down (default amount)
/tmp/brw scroll down --amount 5            # Scroll down 5 ticks
/tmp/brw scroll up                         # Scroll up
/tmp/brw scroll down --at 200,400          # Scroll element at coordinates
/tmp/brw scroll-to --ref ref_12            # Scroll element into view
```

### Hover & Drag

```bash
/tmp/brw hover <x> <y>                    # Hover at coordinates
/tmp/brw hover --ref ref_3                 # Hover over element
/tmp/brw drag 100 100 300 300              # Drag from (100,100) to (300,300)
/tmp/brw drag --from-ref ref_1 --to-ref ref_5  # Drag between elements
```

### Wait

```bash
/tmp/brw wait --duration 2                 # Wait 2 seconds
/tmp/brw wait-for --selector ".modal"      # Wait for element to appear
/tmp/brw wait-for --text "Success"         # Wait for text on page
/tmp/brw wait-for --url "*/dashboard*"     # Wait for URL change
/tmp/brw wait-for --js "window.loaded"     # Wait for JS condition
/tmp/brw wait-for --network-idle           # Wait for network to settle
```

`wait-for` returns `matched: true/false` — it does not error on timeout.

### Tabs

```bash
/tmp/brw tabs                              # List all tabs
/tmp/brw new-tab "https://example.com"     # Open URL in new tab
/tmp/brw new-tab "https://example.com" --wait dom  # Open and wait for page load
/tmp/brw switch-tab <id>                   # Switch to tab (accepts ID or alias)
/tmp/brw close-tab <id>                    # Close tab
/tmp/brw name-tab inbox                    # Name active tab "inbox"
/tmp/brw name-tab docs 2                   # Name tab 2 "docs"
```

Named tabs can be used anywhere `--tab` is accepted (e.g., `--tab inbox`).

### Dialog Handling

```bash
/tmp/brw dialog                            # Check for pending dialog
/tmp/brw dialog accept                     # Accept/OK
/tmp/brw dialog dismiss                    # Cancel/dismiss
/tmp/brw dialog accept --text "response"   # Respond to prompt dialog
```

Dialogs auto-dismiss after 5 seconds if not handled explicitly.

## Advanced Commands

### Console & Network

```bash
/tmp/brw console                           # Read captured console messages
/tmp/brw console --errors-only             # Only errors
/tmp/brw network                           # Read captured network requests
/tmp/brw network --url-pattern "api"       # Filter by URL
/tmp/brw network-body <request_id>         # Get response body
```

### File Upload

```bash
/tmp/brw file-upload --ref ref_3 --files /path/to/file.txt
/tmp/brw file-upload --ref ref_3 --files /tmp/a.txt /tmp/b.txt  # Multiple files
```

### Cookies & Storage

```bash
/tmp/brw cookies                           # List cookies for current page
/tmp/brw cookies get "session_id"          # Get specific cookie
/tmp/brw cookies set "name" "value"        # Set cookie
/tmp/brw storage get "key"                 # Get localStorage value
/tmp/brw storage set "key" "value"         # Set localStorage value
```

### Network Interception

```bash
/tmp/brw intercept add "*/api/data" --status 200 --body '{"mock": true}'
/tmp/brw intercept add "*analytics*" --block
/tmp/brw intercept list
/tmp/brw intercept remove <rule_id>
/tmp/brw intercept clear
```

### Other

```bash
/tmp/brw resize 800 600                    # Resize viewport
/tmp/brw pdf --output report.pdf           # Save page as PDF
/tmp/brw emulate --device "iPhone 15"      # Device emulation
/tmp/brw perf                              # Performance metrics
/tmp/brw gif start                         # Start GIF recording
/tmp/brw gif stop                          # Stop recording
/tmp/brw gif export --output demo.gif      # Export animated GIF
/tmp/brw server status                     # Check proxy status
/tmp/brw server stop                       # Stop proxy and Chrome
/tmp/brw log                               # Show recent proxy log entries
/tmp/brw log --lines 100                   # Show last 100 log lines
```

## Quick Mode

Chain multiple simple actions in one call to reduce round-trips:

```bash
/tmp/brw quick "N https://example.com
W
C 500 300
T hello world
K Enter"
```

Ref-based commands are also available: `CR ref_5` (click ref), `FR ref_3 value` (form-input ref), `R` (read-page), `WF --text "Done"` (wait-for).

Returns a screenshot after the final command. See `references/QUICK-MODE.md` for the full command table.

## Tips

- **Refs over coordinates**: When `read-page` gives you ref IDs, prefer `--ref ref_X` over coordinate clicks. Refs are more reliable.
- **Skip auto-screenshot**: Use `--no-screenshot` when chaining multiple actions before a manual screenshot. Saves time.
- **Check login state**: Before re-authenticating, use `/tmp/brw cookies` or `/tmp/brw js "document.cookie"` to check if already logged in. Sessions persist across proxy restarts.
- **Iframes**: Use `--frame 0` (by index) or `--frame "name"` to target iframe content in `read-page`, `js`, and `form-input`. Click/type/key work across frames since they dispatch at viewport coordinates.
- **Multi-agent**: Each agent should use its own tab via `--tab <id>`. Create tabs with `/tmp/brw new-tab`.
- **Dynamic content**: Use `/tmp/brw wait-for` instead of polling with `read-page` when waiting for async content.
- **SPAs**: Use `--wait render` with navigate for single-page apps that load content dynamically after initial page load. For heavy apps like Gmail, prefer `--wait dom` to avoid long render waits.
- **Global flags**: `--tab <id>` targets a specific tab, `--text` for human-readable output, `--timeout <s>` for request timeout.
- **Session persistence**: The proxy reconnects to an existing Chrome if one is already running on the CDP port. Sessions, cookies, and tabs survive proxy restarts.
- **Hidden overlays (Gmail compose, etc.)**: Content inside `aria-hidden` ancestors is excluded from the a11y tree. Use `--scope "[role='dialog']"` with `read-page` to target the overlay directly.
- **Complex pages (GitHub, Gmail)**: `--search` on large pages can be slow. Narrow first with `--scope`: `/tmp/brw read-page --scope "main" --search "Submit"`
- **Canvas-rendered apps (GDocs/Sheets)**: `type` may drop characters. Use `brw js` with clipboard API + `brw key "cmd+v"` for reliable text insertion.
- **SPAs with noisy `get-text`**: Use `brw js` with targeted DOM queries for clean content extraction.

## Configuration

Set via environment variables (`BRW_*`), `.claude/brw.json` (per-repo), or `~/.config/brw/config.json` (user). Run `/tmp/brw config` to see resolved values.

Key variables: `BRW_HEADLESS`, `BRW_CHROME_PATH`, `BRW_PORT`, `BRW_SCREENSHOT_DIR`, `BRW_ALLOWED_URLS`, `BRW_AUTO_SCREENSHOT` (set to `false` to disable auto-screenshots on mutation commands — useful for automation loops).

## App Profiles

Profiles package app-specific automation (selectors, JS scripts, multi-step actions) into reusable config directories. Instead of repeating workarounds in every prompt, call profile actions directly:

```bash
/tmp/brw profile list                                          # List available profiles
/tmp/brw profile show google-docs                              # Show profile actions/selectors
/tmp/brw run google-docs:read-content                          # Run a profile action
/tmp/brw run google-docs:type-text --param text="Hello"        # Run with parameters
```

Profiles live in `.claude/brw/profiles/<name>/` (repo) or `~/.config/brw/profiles/<name>/` (user). See `references/PROFILES.md` for authoring details.

## References

- **Full command reference**: `references/COMMANDS.md` — all flags, output fields, and edge cases
- **Quick mode reference**: `references/QUICK-MODE.md` — command table and multi-step examples
- **App profiles reference**: `references/PROFILES.md` — profile format, discovery, authoring guide
