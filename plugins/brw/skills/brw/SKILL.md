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

```bash
brw() { node "${SKILL_DIR}/scripts/brw.js" "$@"; }
```

**Prerequisites**: Node.js 18+, a Chromium-based browser (Chrome, Chromium, Edge, or Brave).

The proxy server auto-starts on first command. Chrome launches headed by default (set `BRW_HEADLESS=true` for headless).

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
brw navigate <url>                    # Go to URL (auto-prepends https://)
brw navigate back                     # Go back
brw navigate forward                  # Go forward
brw navigate <url> --wait network     # Wait for network idle (default: dom)
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
brw click <x> <y> --right            # Right click
brw click <x> <y> --double           # Double click
```

### Type & Key

```bash
brw type "hello world"               # Type into focused element
brw type "new text" --clear           # Clear field first, then type
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
brw form-input --selector "#email" --value "test@example.com"
```

### JavaScript

```bash
brw js "document.title"                           # Evaluate expression
brw js "await fetch('/api').then(r => r.json())"  # Async expression
brw js "document.title" --frame 0                 # Execute in iframe
```

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
brw switch-tab <id>                   # Switch to tab
brw close-tab <id>                    # Close tab
```

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
brw network                           # Read captured network requests
brw network --url-pattern "api"       # Filter by URL
brw network-body <request_id>         # Get response body
```

### File Upload

```bash
brw file-upload --ref ref_3 --files /path/to/file.txt
brw file-upload --ref ref_3 --files /tmp/a.txt /tmp/b.txt  # Multiple files
```

### Cookies & Storage

```bash
brw cookies                           # List cookies for current page
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
brw resize 800 600                    # Resize viewport
brw pdf --output report.pdf           # Save page as PDF
brw emulate --device "iPhone 15"      # Device emulation
brw perf                              # Performance metrics
brw gif start                         # Start GIF recording
brw gif stop                          # Stop recording
brw gif export --output demo.gif      # Export animated GIF
brw server status                     # Check proxy status
brw server stop                       # Stop proxy and Chrome
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

Returns a screenshot after the final command. See `references/QUICK-MODE.md` for the full command table.

## Tips

- **Refs over coordinates**: When `read-page` gives you ref IDs, prefer `--ref ref_X` over coordinate clicks. Refs are more reliable.
- **Skip auto-screenshot**: Use `--no-screenshot` when chaining multiple actions before a manual screenshot. Saves time.
- **Check login state**: Before re-authenticating, use `brw cookies` or `brw js "document.cookie"` to check if already logged in. Sessions persist across proxy restarts.
- **Iframes**: Use `--frame 0` (by index) or `--frame "name"` to target iframe content in `read-page`, `js`, and `form-input`. Click/type/key work across frames since they dispatch at viewport coordinates.
- **Multi-agent**: Each agent should use its own tab via `--tab <id>`. Create tabs with `brw new-tab`.
- **Dynamic content**: Use `brw wait-for` instead of polling with `read-page` when waiting for async content.
- **Global flags**: `--tab <id>` targets a specific tab, `--text` for human-readable output, `--timeout <s>` for request timeout.

## Configuration

Set via environment variables (`BRW_*`), `.claude/brw.json` (per-repo), or `~/.config/brw/config.json` (user). Run `brw config` to see resolved values.

Key variables: `BRW_HEADLESS`, `BRW_CHROME_PATH`, `BRW_PORT`, `BRW_SCREENSHOT_DIR`, `BRW_ALLOWED_URLS`.

## References

- **Full command reference**: `references/COMMANDS.md` — all flags, output fields, and edge cases
- **Quick mode reference**: `references/QUICK-MODE.md` — command table and multi-step examples
