# Stage 2: Analyze API Surface

Turn raw captures into a structured endpoint inventory with auth patterns and response shapes.

## Running analyze-har.py

The bundled HAR analyzer produces grouped endpoint summaries. Run it from the project root:

```bash
# All REST endpoints filtered to the app's domain
python3 scripts/analyze-har.py har/<app>.har --domain <app-domain.com>

# GraphQL operations (operation names + status codes)
python3 scripts/analyze-har.py har/<app>.har --graphql

# GraphQL with full query text + response field shapes
python3 scripts/analyze-har.py har/<app>.har --graphql --extract

# Quick summary: endpoint count, domains, status codes, content types
python3 scripts/analyze-har.py har/<app>.har --summary
```

### Reading the output

- **REST mode** (`--domain`): Groups requests by URL path pattern. Shows method, path, status codes, response sizes, and content types. Look for patterns — `/api/v1/issues`, `/api/v1/issues/:id`, `/api/v1/search`.
- **GraphQL mode** (`--graphql`): Groups by operation name. Shows which operations are called most frequently.
- **GraphQL extract** (`--graphql --extract`): Dumps the query text and top-level response field names for each operation. Essential for understanding data shapes.
- **Summary** (`--summary`): Quick stats for orientation before the deep dive.

## From Chrome DevTools Captures

If you used live exploration via Chrome DevTools MCP, review the saved response bodies:
- Open each saved file and note the data structure
- Look at request headers for auth patterns (visible in network request details)
- Compare responses across different pages to understand pagination

## What to Identify

From either source, build an inventory covering:

### Frequently called endpoints
These are the core workflows. Endpoints called many times across the HAR (or that you used repeatedly during live exploration) map directly to the most useful tools.

### Response sizes
- Small responses (<8KB): good candidates for inline tool responses
- Medium (8-50KB): may need `limit` parameters or field filtering
- Large (>50KB): must use `resource_link` (file-based) responses

### Pagination pattern
Identify how list endpoints paginate — compare the first page request to subsequent ones. Common patterns: `?page=2`, `?offset=20`, `?cursor=<token>`, `?after=<id>`, or GraphQL `pageInfo { endCursor hasNextPage }`. Note which pattern each list endpoint uses — the tool handler needs to match it.

### Related endpoint groups
Endpoints that serve a single user workflow should be consolidated into one tool. Example: if viewing a project requires `/projects/:id` + `/projects/:id/members` + `/projects/:id/activity`, that is one `get_project` tool, not three.

### Auth pattern — fingerprinting

Classify the app's auth mechanism before building anything. Check these signals in HAR entries or CDP `Network.requestWillBeSent` events:

| Signal | Classification | Build path |
|--------|---------------|------------|
| Documented REST API with key from dashboard/env var, no browser login | **api-key-auth** | No `auth.js`. See `patterns/api-key-auth.md` |
| API calls carry `Authorization: Bearer <token>` or `Authorization: <token>` header | **spa-token-auth** | Use `token.js` template. See `patterns/spa-token-auth.md` |
| Known OIDC SDK keys in localStorage (`@@auth0spajs@@`, `okta-token-storage`, `firebase:authUser:`, `CognitoIdentityServiceProvider`) | **spa-token-auth** | Use `token.js` template. See `patterns/spa-token-auth.md` |
| httpOnly cookies on the app's domain carry auth (removing cookies → 401) | **cookie-auth** (default) | Use `auth.js` template |
| Cookies + `x-csrf-token` / `X-CSRFToken` / `X-CSRF-TOKEN` headers | **cookie-auth + CSRF** | Use `auth.js` + `csrf.js` |
| Both `Cookie` and `Authorization` headers present on API requests | **test in isolation** | See "Cookie-stored tokens" below |
| Mix of cookies and Authorization headers across different endpoints | **hybrid** | Determine which endpoints need what — may need both templates |

**How to confirm:** Strip all cookies from a request and add only the Authorization header. If it returns 200, the app is token-auth and cookies are irrelevant (likely analytics/tracking). If it returns 401, cookies carry auth.

### Split API detection (public vs internal)

Some apps have a documented public API on a different domain from what the browser actually uses. Example: Google Workspace — the browser hits `clients6.google.com` (internal, cookie-auth), but the public Docs/Sheets API is at `*.googleapis.com` (OAuth2 only). Notion, Figma, and similar apps may have the same split.

**Detection:** Compare the domains in HAR/live traffic against the documented API docs. If the browser hits different endpoints than the public API, you have a split.

**STOP and present the tradeoff before Stage 3.** Ask the user:

*"This app has a documented public API (requires OAuth2/API key) and separate internal APIs (cookie-based, no setup). Which approach do you want?"*

| Approach | Setup | Pros | Cons |
|----------|-------|------|------|
| Public API (OAuth2/API key) | Credentials required | Full structured access, documented, stable | User must set up credentials; enterprise orgs may block OAuth2 consent for third-party apps |
| Internal APIs (cookie auth) | None — browser login | No setup, works immediately | Undocumented, may lack write/edit endpoints, can break without notice; not all services have internal API endpoints |
| Browser automation (CDP) | None — browser login | Works when both API paths are blocked; uses the same auth the user already has | Slower, fragile to UI changes, limited to what the web UI exposes |

**Note:** Not all services within the same platform have the same internal API availability. For example, Google Drive has internal endpoints (`clients6.google.com`) that accept cookies, but Gmail does not — its API requires OAuth2 exclusively. Test each service independently.

If OAuth2 is the only API path and credentials may be blocked by enterprise policy, offer browser automation as a fallback upfront — don't wait until OAuth2 fails.

If the user picks cookie-based internal APIs, classify as **cookie-auth** and build against the internal endpoints. If they pick OAuth2, classify as **api-key-auth** (or a custom OAuth2 flow) and build against the public API. If browser automation, the build approach differs fundamentally (CDP page interaction instead of API calls).

Do not build for one approach and then switch — the tool design, auth layer, and endpoints all differ.

### Cookie-stored tokens

Some SPAs store JWT tokens in cookies for persistence (survives tab close) but read them out with JavaScript and send them as `Authorization: Bearer` headers. The cookie is a storage mechanism, not the auth mechanism. This looks like cookie-auth during capture — cookies are present on every request and the API returns 200 — but replaying cookies via the `Cookie` header alone returns 401.

**Detection:** Both `Cookie` and `Authorization` headers appear on API requests in the HAR. **Always test each in isolation** before choosing an approach:

```
Cookie-only request  → 401  →  cookies are storage, not auth
Bearer-only request  → 200  →  spa-token-auth (extract token from cookie, send as Bearer)
```

If this pattern is detected, classify as **spa-token-auth** and extract the token value from the cookie via CDP, then inject it as an `Authorization` header. See `patterns/spa-token-auth.md`.

To check localStorage for SDK keys, use CDP:
```bash
# Via any browser MCP tool that supports JS evaluation, or raw CDP
Runtime.evaluate({ expression: "Object.keys(localStorage).filter(k => k.match(/auth0|okta|firebase|cognito/i))" })
```

Look for: `Cookie`, `Authorization`, `x-csrf-token`, `X-CSRFToken`, `X-CSRF-TOKEN` headers.

### Response format
- **JSON APIs**: Standard. Most modern apps return JSON for API endpoints.
- **HTML responses**: Some apps (Rails, Django, PHP) return HTML for list/search pages. Requires regex-based parsing.
- **Mixed**: JSON for AJAX/detail endpoints, HTML for list/search. Common in server-rendered apps.

### Search/filter API
How does the app handle search? Test in the UI and watch what fires:
- JSON endpoint with query parameters (`/api/search?q=...`)
- HTML partial rendered server-side
- GraphQL query with filter variables
- POST-based search (form submission)
- **Client-side search** — the "search" endpoint takes a list of IDs (no query parameter) and returns all data; the SPA filters locally. If the request body has no query string, search is client-side and the MCP tool must implement its own filtering.

### GraphQL: check for query allowlisting

If the app uses GraphQL, test whether the server allows arbitrary queries:

1. Send a minimal introspection query: `{ __typename }`
2. Take a captured query from the app and remove one field, then send the modified version

If both return 500 while the app's original queries return 200, the server uses **query allowlisting**. See `patterns/graphql-allowlist.md` — the build strategy changes fundamentally (exact query replay instead of composing new queries).

### SDUI detection

If API responses contain nested component trees with `type`/`component`/`__typename` fields describing UI layout (not flat data), the app uses **Server-Driven UI**. See `patterns/sdui.md` for extraction strategies.

## Gate Condition

**Endpoint inventory documented with: (1) list of endpoints grouped by workflow, (2) auth pattern classified (api-key-auth, cookie-auth, spa-token-auth, or hybrid), (3) response shapes noted for key endpoints, (4) GraphQL allowlisting status checked if applicable.** Do not proceed to Stage 3 without this.
