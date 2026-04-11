# Pattern: SPA Token Auth

Load this reference when Stage 2 classifies the app as **bearer-token auth** — i.e., the app uses an OIDC SDK (Auth0, Okta, Firebase Auth, AWS Cognito) that stores access tokens in localStorage/sessionStorage and injects them as `Authorization` headers.

## How to confirm this classification

Check these signals during Stage 2 analysis:

1. **Authorization header in requests.** Look at HAR entries or CDP `Network.requestWillBeSent` events. If API calls carry `Authorization: Bearer <token>` or `Authorization: <token>`, this is token auth — not cookie auth.
2. **Cookies are irrelevant.** Cookies may exist on the domain (analytics, tracking), but none carry auth. You can verify: strip all cookies from a request and add only the Authorization header — if it still returns 200, cookies don't matter.
3. **Known localStorage keys.** Check localStorage via CDP `Runtime.evaluate` for SDK-specific keys:

| SDK | localStorage key pattern |
|-----|-------------------------|
| Auth0 | `@@auth0spajs@@::<clientId>::<audience>::<scope>` |
| Okta | `okta-token-storage` |
| Firebase Auth | `firebase:authUser:<apiKey>:<appName>` |
| AWS Cognito | `CognitoIdentityServiceProvider.<clientId>.<username>.accessToken` |

## Impact on build

When this pattern applies, **replace `auth.js` cookie-based auth with a `token.js` token-based approach.** The cookie persistence model (capture cookies → save to disk → inject into fetch) does not work — injecting cookies returns 401 because the server expects an Authorization header.

### token.js template responsibilities

1. **Extract token from browser.** Use CDP `Runtime.evaluate` to read the token from localStorage:
   ```js
   const result = await cdp.Runtime.evaluate({
     expression: `localStorage.getItem('@@auth0spajs@@::...')`,
     returnByValue: true
   });
   const tokenData = JSON.parse(result.result.value);
   const accessToken = tokenData.body.access_token;
   ```

2. **Cache with TTL.** Write the token to `~/.diy-mcp/<app>/token.json` with an expiry timestamp. On subsequent calls, read from cache if not expired.

3. **Inject into fetch.** Replace `auth.authFetch` with a version that adds the Authorization header:
   ```js
   const resp = await fetch(url, {
     ...options,
     headers: {
       ...options.headers,
       'Authorization': `${tokenPrefix}${accessToken}`
     }
   });
   ```

4. **Refresh flow.** When a request returns 401, clear the cached token, launch Chrome to the app (triggering the SDK's silent refresh), re-extract, and retry once.

## The raw JWT vs Bearer trap

Some APIs expect `Authorization: Bearer <token>`, others expect `Authorization: <token>` without the prefix. **Capture the exact Authorization header value from a real browser request and match the format exactly.** Store the prefix (or lack of it) as a constant:

```js
const META = {
  // ...
  tokenPrefix: '',  // or 'Bearer ' — match what the real browser sends
};
```

## OIDC SDKs do not intercept fetch

A common misconception: the Auth0/Okta SDK will automatically add the Authorization header to `fetch()` calls. **It does not.** The SDK provides methods like `getAccessTokenSilently()` that the app's HTTP client layer (Apollo link, axios interceptor, etc.) calls before each request. A raw `fetch()` call in the browser context gets no auth headers.

This means a "browser-proxy" approach (evaluating `fetch()` in the page context via CDP `Runtime.evaluate`) must manually extract and attach the token:

```js
// Evaluated in browser context — must manually add the token
const token = JSON.parse(localStorage.getItem('@@auth0spajs@@::...'))?.body?.access_token;
const resp = await fetch('/api/data', {
  headers: { 'Authorization': token }
});
return await resp.json();
```

## Browser-proxy alternative

For SPA-token apps, an alternative to extracting tokens is running all API calls inside the browser's page context. This avoids token extraction entirely — the fetch runs in the same origin as the SPA, and you manually read the token from localStorage before each call.

**Tradeoffs:**
- Pro: no token file management, no refresh logic — the SDK handles token lifecycle
- Pro: requests come from the same origin as the SPA, avoiding CORS issues
- Con: requires a running Chrome instance for every API call
- Con: slower than direct HTTP calls
- Con: Chrome instance management complexity (see "Chrome instance conflicts" in `6-auth-verification.md`)

Use browser-proxy when token extraction is unreliable (e.g., the SDK uses opaque storage or rotates keys unpredictably). Use direct token extraction when possible — it's faster and doesn't require Chrome after the initial extraction.

## Auth verification changes

When testing auth (Stage 6), the standard cookie tests don't apply. Instead:

- [ ] **Fresh token test:** Clear cached token, run a tool — should launch Chrome, extract token, succeed
- [ ] **Token reuse test:** Run again — should use cached token, no Chrome launch
- [ ] **Token expiry test:** Set token expiry to past, run a tool — should detect expiry, re-extract, succeed
- [ ] **Wrong prefix test:** If applicable, verify the Authorization header format matches exactly
