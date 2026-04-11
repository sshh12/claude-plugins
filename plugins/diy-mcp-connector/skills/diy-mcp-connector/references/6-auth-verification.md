# Stage 6: Auth Verification

Run the auth verification procedure matching your app's classification from Stage 2. **API-key-auth apps** use the simplified procedure below (no browser tests needed). Cookie-auth apps use Tests 1-4 below. **SPA-token-auth apps** use the alternative test procedure in `patterns/spa-token-auth.md` (fresh token, token reuse, token expiry, header format tests). Each test must pass before proceeding.

## API-Key Auth Verification

For apps classified as `api-key-auth`, run three checks:

```bash
# 1. Valid key — should return a successful response
<APP>_API_KEY="<key>" ./test/test-tool.sh <app>_<tool> '{}'

# 2. Missing key — should error with a clear message, not crash
./test/test-tool.sh <app>_<tool> '{}'

# 3. Invalid key — should return the API's error (401/403), not crash
<APP>_API_KEY="invalid" ./test/test-tool.sh <app>_<tool> '{}'
```

Use `export` if piping — inline `VAR=val cmd1 | cmd2` only sets the var for `cmd1`. See Stage 5 smoke test note.

If all three behave correctly, proceed to Stage 7. The remaining tests below are for cookie/token-auth apps only.

---

## Test 1: Fresh Login

Clear any saved cookies and trigger a tool call via stdio:

```bash
# Clear saved cookies for this app
rm -f ~/.diy-mcp/<app>/cookies/*.json

# Run a tool call via stdio — should trigger Chrome login
./test/test-tool.sh <app>_<tool> '{}' 2>/tmp/mcp-auth.log
```

Expected behavior:
- Chrome opens to the configured `loginUrl`
- Complete SSO/login in the browser
- Check stderr: `cat /tmp/mcp-auth.log` — look for `[auth] saved cookies for <domain>`
- The tool call returns a valid response after login completes

## Test 2: Cookie Reuse

Run the exact same command again without clearing cookies:

```bash
./test/test-tool.sh <app>_<tool> '{}' 2>/tmp/mcp-auth.log
```

Expected behavior:
- Chrome should **NOT** open
- stderr shows `[auth] using saved cookies for <domain>`
- Valid response returned without any browser interaction
- Response data matches what you would see in the app

## Test 3: Auth Failure Recovery

Corrupt the saved cookie file and verify the server detects the failure and re-triggers login:

```bash
# Corrupt the cookie file
echo '{"cookieHeader":"invalid_garbage","captured_at":"2020-01-01T00:00:00Z"}' \
  > ~/.diy-mcp/<app>/cookies/<domain>.json

# Run again — should detect auth failure and re-open Chrome
./test/test-tool.sh <app>_<tool> '{}' 2>/tmp/mcp-auth.log
```

Expected behavior:
- Server sends the corrupted cookies, gets a 401/403 or login redirect
- stderr shows auth failure detection and browser login trigger
- Chrome opens for re-authentication
- After login, the tool call succeeds

## Test 4: App-Specific Auth Edge Cases

### GraphQL apps
Verify null-data detection triggers re-login. GraphQL APIs often return HTTP 200 with all-null `data` fields when the session is invalid instead of returning a 401. Confirm:
- The `gql()` helper detects `Object.values(data.data).every(v => v === null)`
- It calls `clearCookies(domain)` and retries with `forceLogin: true`
- stderr logs the null-data detection

### CSRF-protected apps (Rails, Django, Laravel)
Invalidate the cached CSRF token and verify 422 retry:
- Make a successful request (caches the token)
- Manually clear the token: the next request should use a stale/missing token
- The server should receive a 422, automatically re-fetch the CSRF token from the HTML page, and retry the original request
- The retry should succeed

## Known CDP Issues

### Pre-auth cookie capture

`captureLoginCookies` grabs cookies as soon as **any** cookies exist on the domain. Many SSO apps set non-auth cookies (analytics, CSRF, tracking) on initial page load before SSO completes. These get captured but do not actually authenticate API calls.

**Fix:** Use the `validateFn` callback in `authFetch`:

```js
const result = await auth.authFetch(url, options, META.loginUrl, {
  validateFn: async (cookies) => {
    // Make a lightweight API call to check if cookies are real auth
    const resp = await fetch(`https://${META.domain}/api/me`, {
      headers: { Cookie: cookies, "User-Agent": "Mozilla/5.0 ..." },
    });
    return resp.status === 200;
  },
});
```

When `validateFn` is provided, `captureLoginCookies` keeps polling until `validateFn` returns `true` or the login timeout is reached.

### Post-login UX

After valid cookies are captured, call `showLoginComplete(domain)` from auth.js. This navigates the Chrome tab to a "Logged in -- you can close this tab" page, preventing the user from seeing a stale app page after the MCP server has already captured their session.

### Chrome instance conflicts

The `auth.js` template uses per-app Chrome data directories (`~/.diy-mcp/<app>/chrome-data`) and automatically kills stale Chrome processes using the same data dir before launching. This should prevent most conflicts. If `captureLoginCookies` still times out:

```bash
ps aux | grep -- '--user-data-dir'
pkill -f 'chrome.*diy-mcp'
```

## Gate Condition

**All 4 auth tests pass.** Fresh login triggers Chrome and captures cookies. Cookie reuse skips Chrome entirely. Corrupted cookies trigger re-authentication. App-specific edge cases (null-data GraphQL, CSRF 422 retry) are handled. Do not proceed to Stage 7 without this.
