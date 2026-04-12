# Stage 1: Capture API Surface

Capture the target app's API traffic so you know what endpoints exist, what data they return, and how authentication works.

## Choosing a Capture Method

Before starting, determine which exploration tools are available. Check what MCP servers are connected:

```bash
claude mcp list
```

Look for any of these (most common first):

| Tool | How to detect | Best for |
|------|--------------|----------|
| **Claude for Chrome** | MCP server named `chrome` or `claude-for-chrome`; tools like `chrome_navigate`, `chrome_screenshot` | Most users — works with any Chrome tab already open, captures network traffic via DevTools Protocol |
| **brw** | MCP server named `brw`; tools like `navigate_page`, `take_screenshot`, `list_network_requests` | Rich network capture — `list_network_requests` and `get_network_request` give direct access to XHR/fetch traffic with response bodies |
| **Chrome DevTools MCP** | MCP server named `chrome-devtools` or similar; tools like `cdp_navigate`, `cdp_network_enable` | Low-level CDP access — fine-grained control over network interception |
| **Playwright MCP** | MCP server named `playwright`; tools like `browser_navigate`, `browser_click`, `browser_snapshot` | Full browser automation — headless or headed, good for apps requiring complex interaction sequences |
| **None of the above** | No browser MCP servers found | Use manual HAR capture (Option A below) |

If none are detected, ask the user: *"I don't see a browser tool connected. Do you have HAR files already, or would you like to set one up? Claude for Chrome is the easiest option — install it from the Chrome Web Store and it shows up as an MCP server automatically."*

If multiple are available, prefer in this order: **brw** (best network capture) > **Claude for Chrome** (most common) > **Playwright** (most flexible automation) > **Chrome DevTools MCP** (lowest level).

---

## Option A: HAR Files (Manual Capture)

Best when no browser MCP server is available, or when you want a complete recording to analyze offline.

1. Open Chrome, navigate to the target app, and log in
2. Open DevTools: **Cmd+Option+I** (Mac) or **Ctrl+Shift+I** (Windows/Linux)
3. Go to the **Network** tab
4. Check **Preserve log** (prevents clearing on navigation)
5. Navigate through the app performing the workflows you want to automate:
   - Browse list pages (projects, tickets, messages, contacts)
   - Open detail views (click into individual items)
   - Use search and filter features
   - Visit settings/profile pages
   - Check dashboard or summary views
6. Right-click anywhere in the network panel
7. Select **"Save all as HAR with content"**
   - The "with content" part is critical — without it, response bodies are empty and you lose the data shapes
8. Save to `<app>/har/<app>.har`

### GraphQL apps

If the app uses GraphQL, you will see a single `/graphql` endpoint handling all requests. The URL is always the same — what matters is the operation name in each POST body. The HAR analyzer extracts these automatically with `--graphql`.

### Warning: narrow captures

Do not stop after one feature area. If you only browse the settings page, you only capture settings endpoints. Visit every major section of the app in a single recording session:
- Main list/feed views
- Detail/item views
- Search results
- Dashboards or analytics
- Any import/export features
- **Pagination** — scroll or click "next page" on at least one list to capture how the app paginates (query params, cursor tokens, offset, etc.)

A thin HAR leads to thin tools and requires a second capture round later.

---

## Option B: Live Exploration via Browser MCP

If a browser-control MCP server is available, explore the API surface live. The general workflow is the same regardless of which tool you use — navigate, interact, capture network traffic — but the specific tool names differ.

### brw

brw has the richest network capture support. Use it when available.

1. `navigate_page` to the app's login page
2. Complete SSO/login — verify with `take_screenshot`
3. After each page load, call `list_network_requests` with `resourceTypes: ["xhr", "fetch"]` to see API calls
4. Save response bodies via `get_network_request` with `responseFilePath` for data shape analysis
5. Use `fill`, `press_key`, `click` to interact with the page and discover search/filter API calls
6. Use `take_snapshot` to understand page structure and find interactive elements

### Claude for Chrome

Claude for Chrome connects to an existing Chrome tab. The user must have the extension installed and a Chrome window open.

1. Ask the user to open the target app in Chrome and log in
2. Use `chrome_navigate` (or equivalent navigation tool) to ensure you're on the right page
3. Use `chrome_screenshot` to verify the page state
4. Use `chrome_network_requests` or equivalent to inspect XHR/fetch traffic
5. Interact with the page using click/type tools to trigger API calls across different sections
6. Capture endpoint URLs, request headers, and response shapes from the network log

### Playwright MCP

Playwright launches a new browser instance. Good for apps that don't require an existing logged-in session, or when you need headless automation.

1. `browser_navigate` to the app's login page
2. Complete login using `browser_click`, `browser_type`, etc.
3. Use `browser_snapshot` to understand page structure
4. Navigate through app sections and capture network traffic
5. Use `browser_network_requests` (if available) or fall back to HAR export from the Playwright session

**Note:** Playwright's network capture varies by MCP server implementation. Some expose network request tools directly; others require enabling network interception first. Check the available tools after connecting.

### Chrome DevTools MCP

Provides raw CDP (Chrome DevTools Protocol) access. More verbose than brw but gives fine-grained control.

1. Enable network domain: `cdp_network_enable`
2. Navigate to the app
3. Inspect captured requests via CDP network events
4. Extract response bodies using CDP's `Network.getResponseBody`

### Capturing request headers and bodies

Live exploration tools may not expose full request details (headers, POST bodies) in their network capture output. For apps where auth headers or request body format matters (GraphQL, CSRF tokens, custom headers), you may need to:

1. **Use CDP `Network.requestWillBeSent` directly.** This event includes `request.headers` and `request.postData` — the full request as the browser sends it. Particularly useful for capturing exact Authorization header format and GraphQL query strings.

2. **Fall back to HAR capture.** Chrome's "Save all as HAR with content" captures request bodies in `entries[].request.postData.text` and headers in `entries[].request.headers`. HAR gives strictly more data for auth/body analysis than most live exploration tools.

**Prefer HAR for auth and body analysis.** Live exploration is better for interactive discovery (triggering search, pagination, filters). HAR is better for seeing the exact shape of what the browser sends.

### When to prefer live exploration over HAR

- The HAR was captured without response bodies
- The initial HAR capture was too narrow
- You need to interact with the page (search, filter, paginate) to trigger API calls
- You want to verify specific endpoints in real-time

---

## Combining Both Approaches

Start with a HAR file for the broad endpoint map. Then use live exploration to fill gaps:
- Explore pages the HAR did not cover
- Capture response bodies that were missing
- Test search/filter behavior interactively
- Verify pagination patterns

The combination gives the richest coverage and avoids blind spots.

## Gate Condition

**At least one HAR file saved in `<app>/har/` OR a comprehensive endpoint list documented from live exploration.** The endpoint list must cover the app's primary workflows, not just a single page. Do not proceed to Stage 2 without this.
