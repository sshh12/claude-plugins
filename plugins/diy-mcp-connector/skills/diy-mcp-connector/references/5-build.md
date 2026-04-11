# Stage 5: Build

Create the MCP server. Copy template scripts, write `server/index.js`, and verify it starts.

## server/index.js Contract

The `server.js` template handles all boilerplate: built-in tools (`set_output_dir`, `debug_env`), inline param injection, error handling, and MCP stdio wiring. The generated `index.js` only provides app-specific code:

```js
import * as auth from "./auth.js";
import * as output from "./output.js";
import { startServer } from "./server.js";
// Conditional: import { createGraphQLClient } from "./graphql.js";
// Conditional: import { createCsrfManager } from "./csrf.js";

// -- Metadata -----------------------------------------------------------------
const META = {
  app: "<app-name>",                           // kebab-case, used for namespacing
  domain: "<app-domain.com>",                  // Primary API domain
  displayName: "<App Name>",                   // Human-readable
  loginUrl: "https://<app-domain.com>/login",  // SSO/login URL
};

// Initialize auth + output (sets cookie/output dirs based on app name)
auth.init(META.app);
output.init(META.app);

// Conditional: GraphQL client
// const gql = createGraphQLClient({
//   domain: META.domain, loginUrl: META.loginUrl,
//   authFetch: auth.authFetch, clearCookies: auth.clearCookies,
// });

// Conditional: CSRF manager
// const csrf = createCsrfManager({
//   domain: META.domain, loginUrl: META.loginUrl,
//   authFetch: auth.authFetch, pageUrl: "https://<domain>/some-page",
// });

// -- App tools ----------------------------------------------------------------
const APP_TOOLS = [
  {
    name: "<app>_<action>",
    description: "What it does. When to use it. What the output looks like.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'status:open')" },
        limit: { type: "number", description: "Max results (default: 20)" },
      },
      required: ["query"],
    },
  },
  // ... more tools
];

// -- App tool handler ---------------------------------------------------------
async function handleTool(name, args) {
  switch (name) {
    // case "<app>_<action>": { ... }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// -- Start --------------------------------------------------------------------
await startServer({ meta: META, tools: APP_TOOLS, handleTool, output });
```

**Critical: stdout vs stderr.** stdout is the MCP JSON-RPC channel. Any stray `console.log()` corrupts the protocol. **All logging must use `console.error`.**

## Copying Bundled Scripts

Copy template scripts from the skill's `scripts/` directory:

| Script | Destination | When |
|--------|------------|------|
| `server.js` | `server/server.js` | Always |
| `auth.js` | `server/auth.js` | Cookie-auth apps (default) |
| `output.js` | `server/output.js` | Always |
| `graphql.js` | `server/graphql.js` | Only if app uses GraphQL |
| `csrf.js` | `server/csrf.js` | Only if app uses CSRF tokens (Rails/Django/etc.) |
| `test-tool.sh` | `test/test-tool.sh` | Always |

After copying, call `auth.init(META.app)` and `output.init(META.app)` in index.js at startup. This sets cookie dir to `~/.diy-mcp/<app>/cookies/` and output dir to `~/.diy-mcp/<app>/output/`.

### API-key-auth apps

If Stage 2 classified the app as **api-key-auth**, do not copy `auth.js` or add `ws` to dependencies. Use a simple fetch helper that reads the key from an env var. See `patterns/api-key-auth.md` for the full pattern. The server still uses `server.js` and `output.js` as normal.

### SPA-token-auth apps

If Stage 2 classified the app as **spa-token-auth**, do not use the `auth.js` cookie-based template for API authentication. Instead, build a `token.js` module following the guidance in `patterns/spa-token-auth.md`. The key differences:
- Extract tokens from localStorage via CDP instead of capturing cookies
- Cache tokens to disk with TTL instead of cookie files
- Inject as `Authorization` header instead of `Cookie` header
- Match the exact Authorization header format from the browser (Bearer prefix or raw token)

You may still copy `auth.js` for the Chrome CDP launch/management functions, but the auth flow itself changes.

### GraphQL-allowlisted apps

If Stage 2 detected **query allowlisting**, see `patterns/graphql-allowlist.md` before writing tool handlers. You must store captured query strings as constants and send them verbatim — do not compose new queries.

## API Call Patterns

### Browser headers (Cloudflare / bot detection)

Many apps use Cloudflare or similar bot detection that blocks bare Node.js `fetch` requests with a 403 (code 1010). The `auth.js` template handles this via the `BROWSER_HEADERS` constant — `rawFetch` merges these into every outbound request.

However, if you call `fetch()` directly anywhere (e.g., in a `validateFn` callback, or a standalone script), you must add a `User-Agent` header yourself:

```js
const resp = await fetch(url, {
  headers: {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    Cookie: cookies,
  },
});
```

Without it, the request silently fails or returns an HTML challenge page instead of JSON.

### REST via auth.authFetch

```js
async function apiGet(path) {
  const result = await auth.authFetch(`https://${META.domain}${path}`, {
    headers: { "Accept": "application/json" },
  }, META.loginUrl);
  if (result.status !== 200) {
    throw new Error(`${META.displayName} API error: ${result.status} ${result.statusText}`);
  }
  return result.body;
}
```

### GraphQL via createGraphQLClient

Import `createGraphQLClient` from `graphql.js` and initialize at the top of index.js:

```js
import { createGraphQLClient } from "./graphql.js";
const gql = createGraphQLClient({
  domain: META.domain,
  loginUrl: META.loginUrl,
  authFetch: auth.authFetch,
  clearCookies: auth.clearCookies,
});
```

Then in tool handlers: `const data = await gql(QUERY_STRING, { id: args.id });`

The `gql()` function handles the critical GraphQL auth-failure retry:
1. Sends the GraphQL POST via `authFetch`
2. Detects auth failures: `FORBIDDEN` errors in the errors array, or HTTP 200 with all-null `data` fields
3. On auth failure: calls `clearCookies(domain)`, then retries with `authFetch(..., { forceLogin: true })`

This retry is essential — many GraphQL APIs return HTTP 200 with null data instead of 401 when cookies expire.

**GraphQL pitfalls** (when composing queries freely — does not apply to allowlisted servers):

1. **Unused variables cause 500 errors.** If your query declares `$foo: String` but no field references `$foo`, many servers reject it with a generic 500. Only declare variables the query body actually uses.
2. **Nullable arguments do not mean "return all."** `itemsByCategory(categoryId: ID)` accepting `null` may return **empty results**, not all items. Test with `null` early. You may need a different query path (fetch all IDs first, then batch-fetch details).
3. **Truncated HAR fragments.** The HAR analyzer may truncate long query strings. Verify fields against the live API before assuming they exist. Request a minimal set first, then add incrementally.
4. **500 vs 400.** A `400` usually means malformed syntax. A `500` on a valid query usually means query allowlisting — see `patterns/graphql-allowlist.md`.

### CSRF via createCsrfManager

Import `createCsrfManager` from `csrf.js` and initialize:

```js
import { createCsrfManager } from "./csrf.js";
const csrf = createCsrfManager({
  domain: META.domain,
  loginUrl: META.loginUrl,
  authFetch: auth.authFetch,
  pageUrl: "https://<domain>/some-page",  // Page that contains the CSRF meta tag
});
```

Then use `csrf.fetchWithCsrf(url, options)` instead of `auth.authFetch` for CSRF-protected endpoints. It auto-injects the token header and handles 422 retry (clears cached token, re-fetches, retries the original request).

Framework header names vary — configure in the `createCsrfManager` options: Rails uses `x-csrf-token`, Django uses `X-CSRFToken`, Laravel uses `X-CSRF-TOKEN`.

### HTML response parsing

Some apps (Rails, Django, PHP) return HTML instead of JSON for list or search pages. Use regex-based extraction:

```js
const result = await auth.authFetch(`https://${META.domain}/items`, {
  headers: { "Accept": "text/html" },
}, META.loginUrl);
const html = result.body;

const items = [];
const pattern = /href="\/items\/(\d+)"[^>]*>([^<]+)<\/a>/g;
let match;
while ((match = pattern.exec(html)) !== null) {
  items.push({ id: match[1], name: match[2].trim() });
}
```

Use a browser tool's snapshot/read-page feature to understand the DOM structure before writing parsers. Test on multiple pages to account for structural variations. Do not use a full HTML parser — regex on the specific patterns you need is simpler and has no dependencies.

### Normalizing internal API formats

Internal APIs often leak database-level representations that their own frontend silently converts. Common examples: PostgreSQL range literals (`"['2026-04-11T05:20:19Z','2026-04-11T16:10:33Z')"`), durations in raw milliseconds (`"quality_duration": 35863690`), Java/Kotlin enum names (`"SLEEP_STAGE_REM"`), and serialized compound types. Always convert these to human-readable values in tool responses — ISO dates, labeled durations (`hours: 9.96`), readable strings. The MCP tool is the "frontend" for these APIs.

### Date range parameters

`new Date("2026-04-10")` creates UTC midnight, but `setHours(23, 59, 59, 999)` sets hours in **local time** — mixing them silently narrows date ranges. When tool parameters are date-only strings, always construct with explicit UTC: `new Date(args.start_date + "T00:00:00.000Z")` and `new Date(args.end_date + "T23:59:59.999Z")`.

### SSO apps with pre-auth cookies

For apps that set cookies before SSO completes (analytics, CSRF tokens), use `validateFn` to confirm real auth:

```js
const result = await auth.authFetch(url, options, META.loginUrl, {
  validateFn: async (cookies) => {
    // Make a lightweight API call to verify cookies are real auth
    const resp = await fetch(`https://${META.domain}/api/me`, {
      headers: { Cookie: cookies, "User-Agent": "Mozilla/5.0 ..." },
    });
    return resp.status === 200;
  },
});
```

When `validateFn` is provided, `captureLoginCookies` keeps polling Chrome for updated cookies until `validateFn` returns true or timeout. This prevents pre-auth cookie capture.

### CDP capture gotchas

When intercepting requests via CDP (`Network.requestWillBeSent`) to capture auth headers:
- **Cookie header is never in `requestWillBeSent`** — the browser adds it automatically. Capture cookies separately via `Network.getCookies` and merge manually.
- **Origin header context matters** — in-browser requests may be same-origin (no `Origin` sent). Replaying from Node.js with an `Origin` header can cause 400 errors. Strip it unless the original request explicitly included it.
- **SSO redirects reset the page** — if Chrome navigates to a login page and back, CDP listeners set up before the redirect may miss post-login network events. Monitor `Page.frameNavigated` to detect when the user returns from login, then start capturing.

## package.json Generation

```json
{
  "name": "<app>",
  "version": "1.0.0",
  "type": "module",
  "main": "server/index.js",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "ws": "8.18.2"
  }
}
```

- `type: "module"` is required — all templates use ESM imports
- `ws` is pinned to an exact version for the WebSocket polyfill in `auth.js` (Node.js <21 compatibility). The auth template auto-polyfills `WebSocket` via `await import("ws")` for Node versions that lack a built-in global. If you see `WebSocket is not defined`, verify `ws` is installed and your Node supports top-level await (14.8+ with ESM).
- Run `npm install` after generating

## Response Size and Output

The inline threshold defaults to 8 KB (`MCP_INLINE_THRESHOLD=8192`). Responses larger than this are automatically written to files and returned as `resource_link` URIs.

Use `set_output_dir` to control where file output is written. By default, files go to `~/.diy-mcp/<app>/output/`. Call `set_output_dir` at session start with `<working_dir>/<app-name>/` — not the bare working directory, to avoid cluttering the user's project root. If the project has an existing `output/` or `data/` convention, follow that instead.

## Stage 5.5: Auth Smoke Test

Before writing all tool handlers, make a single authenticated API call to verify auth works. **Run this in the foreground with stderr visible** — the first run opens Chrome for SSO login. Tell the user: *"A Chrome window will open — log in there and I'll capture the cookies."*

**Test with a URL that triggers actual API calls**, not a generic homepage. Homepages often load only static assets or use different internal endpoints than the API your tools will call. Use the same endpoint one of your tools will hit.

```bash
# Add a temporary test in index.js or run inline:
node -e "
import * as auth from './server/auth.js';
auth.init('<app>');
const r = await auth.authFetch('https://<domain>/api/me', {
  headers: { Accept: 'application/json' }
}, 'https://<domain>/login');
console.error(r.status, r.body?.substring?.(0, 200));
"
```

**For api-key-auth apps**, the smoke test is simpler — just verify the env var is read and a basic API call succeeds:

```bash
export <APP>_API_KEY="<key>"
node -e "
const r = await fetch('https://<domain>/api/endpoint', {
  headers: { Authorization: 'Bearer ' + process.env.<APP>_API_KEY }
});
console.error(r.status, (await r.text()).substring(0, 200));
"
```

**Shell gotcha:** `VAR=val cmd1 | cmd2` sets the var only for `cmd1`, not `cmd2`. Use `export` before pipelines so the var is available to all subprocesses.

If this fails with 401 or returns an HTML login page:
- **Cookie-auth:** Check that `validateFn` is configured to avoid pre-auth cookie capture
- **SPA-token-auth:** You likely need the token-based approach — return to Stage 2, reclassify, and see `patterns/spa-token-auth.md`

Catching auth mismatches here saves rewriting tool handlers later.

## Gate Condition

**`printf '{"jsonrpc":"2.0","id":1,"method":"initialize",...}\n...' | node server/index.js` starts without errors via stdio.** The server should respond to the initialize request and list tools. Do not proceed to Stage 6 without verifying this.
