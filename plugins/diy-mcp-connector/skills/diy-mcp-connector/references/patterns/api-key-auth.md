# Pattern: API-Key Auth

For services authenticated via API key (env var) rather than browser cookies or SPA tokens. Common with developer APIs: xAI, OpenAI, Stripe, Twilio, GitHub (PAT), etc.

## Detection

Stage 2 classifies as **api-key-auth** when:
- The service has a documented REST API with key-based auth
- Auth is `Authorization: Bearer <key>` or a custom header (`X-API-Key`, etc.)
- There is no browser login flow — the key comes from a dashboard or config file
- The user provides an API key or points to an env var / `.env` file

## Stage Adjustments

### Stage 1: Capture
Skip HAR capture entirely if the API is documented. Instead:
- Read the official API docs (user provides URL or you web-search)
- If the user has an existing script/integration, read it to discover which endpoints they use
- Document endpoints directly from docs + existing usage

### Stage 2: Analyze
Classify as `api-key-auth`. Skip browser header analysis — focus on:
- Endpoint inventory from docs
- Response shapes (make a test call or read doc examples)
- Rate limits and pagination patterns
- Which header format the API expects (`Authorization: Bearer`, `X-API-Key`, etc.)

### Stage 5: Build
Do **not** copy `auth.js` — it is for cookie/browser-based auth. Instead:

```js
// Simple API-key fetch helper — inline in index.js or a small module
function apiFetch(url, options = {}) {
  const key = process.env.<APP>_API_KEY;
  if (!key) throw new Error("<APP>_API_KEY environment variable is not set");
  return fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${key}`,  // or whatever header format the API uses
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}
```

- Skip `ws` in `package.json` dependencies (only needed for Chrome CDP WebSocket)
- The server still uses `server.js` and `output.js` templates as normal
- Document the required env var in the tool descriptions and README

### Stage 6: Auth Verification
Replace the 4-test cookie procedure with a single smoke test:

```bash
<APP>_API_KEY="<key>" ./test/test-tool.sh <app>_<tool> '{}'
```

Verify:
- Valid key → successful response
- Missing key → clear error message (not a crash)
- Invalid key → clear error message with the API's error (usually 401/403)

No cookie lifecycle, no Chrome launch, no re-auth flow needed.

### Stage 9: Connect
Pass the API key via `claude mcp add -e`:

```bash
claude mcp add <app> -e <APP>_API_KEY=<key> -- node /path/to/server/index.js
```

For Claude Desktop / other clients, add to the env block in the MCP config JSON.

## Security Notes

- **Never hardcode API keys** in source files — always read from env vars
- API keys often have broader permissions than cookie sessions (no per-user scoping). The Stage 4 security review should flag this.
- If the API supports scoped keys (read-only, write, admin), recommend the minimum scope needed for the designed tools
