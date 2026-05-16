# DOM → Script: A Runbook for API-Based Extraction

When you need to pull more than a screenful of data from a web app — paginated
lists, full inboxes, a backfill — clicking through the UI is slow, brittle, and
hard to repeat. The pattern in this runbook converts a manual workflow into a
self-contained `.js` script that hits the same endpoints the app uses, with
the user's existing session.

This is intentionally **app-agnostic**. Specific app names rot quickly — query
IDs change, schemas migrate, cookie names get renamed. What stays stable is the
*shape* of the problem. Recognize the shape, apply the matching technique.

## When to choose script over click/type

Use **script run** when:
- The data needs **pagination** (more than one screen).
- You need data in **structured form** (JSON), not screenshots.
- The workflow will be **repeated** (cron, batch, retry).
- The UI uses a **virtualized list** — clicks only see what's currently mounted.

Use **click / type / read-page** when:
- The data is in **one screen** and you need it once.
- The page genuinely has no underlying API (rare).
- The data is **render-only**, derived from in-memory JS state that never crosses the wire.

## The five-step discovery loop

1. **Open a tab with the right viewport.**
   `brw new-tab <url> --alias tab-x --wait dom [--viewport 1600x4000]`

   A bigger viewport mounts more rows in virtualized lists. The result includes
   `redirect.loginPageHeuristic: true` if the app sent you to /login.

2. **Survey credentials + login state.**
   `brw auth-tokens --tab tab-x [--probe <canary-url>]`

   Enumerates non-httpOnly cookies, localStorage, sessionStorage, and the most
   recent captured Authorization / csrf-token headers. Decodes JWT claims
   inline. `summary.likelyLoggedIn` is a heuristic — confirm with a probe
   that actually returns data.

3. **Trigger the request you want and find it.**
   Do the minimum interaction that surfaces the endpoint: navigate, scroll,
   click into a view. Then narrow:

   ```bash
   brw network --url-pattern <subs> --with-body-preview 300 --tab tab-x
   brw network --status 4xx --tab tab-x                # find errors
   brw network --url-pattern A --url-pattern B --tab tab-x   # OR-match
   ```

4. **Inspect the chosen request fully.**
   `brw network-request <id> --tab tab-x`

   `requestBodyJson` auto-parses JSON; `requestBodyForm` handles `f.req=<URL-encoded JSON>`.
   `requestHeaders` shows exactly what was sent. Gzipped request bodies are
   transparently decoded.

5. **Generate a starter, then rewrite.**
   `brw script gen --url-pattern <subs> --output /tmp/x.js --tab tab-x`

   The generated file replays the captured request verbatim. **You will
   rewrite it** — into a paginating loop, with auth read at runtime, returning
   clean structured data. The starter's value is the `STRIPPED_HEADERS` block
   (so you know what was removed) and the auth-handling banner.

## App-type taxonomy

Apps differ along a few axes. Identify which bucket the target falls into,
then apply the matching technique. Most apps are a combination of two or three.

### By auth mechanism

| Type | How auth flows | Reading at runtime |
|---|---|---|
| **Cookie-only session** | Server reads session cookie, no extra header needed | `credentials: 'include'` and nothing else |
| **Cookie + CSRF (from cookie)** | A cookie value doubles as the CSRF token; must be echoed in a header | `cookie(name)` and add as `csrf-token` / `x-csrf-token` |
| **Cookie + CSRF (from `<meta>`)** | Classic Rails/Django pattern; token is in a `<meta name="csrf-token">` tag | `document.querySelector('meta[name="csrf-token"]')?.content` |
| **Bearer in JS-readable cookie** | SPA reads a non-httpOnly cookie at fetch time and sets `Authorization: bearer <token>` itself | `cookie(name)`, prepend to fetch headers |
| **Bearer from `/auth/session` mint** | Page fetches a same-origin token endpoint to get a short-lived JWT, then attaches it | Re-fetch the same endpoint inside your script |
| **Raw token (no scheme)** | App uses `Authorization: <raw>` directly — token usually in localStorage or sniffable from captured requests | `localStorage.getItem(name)` or grab via `auth-tokens` |
| **Signed-request auth** | Header is a SHA1/HMAC of `cookie + timestamp + origin` recomputed per request (Google `SAPISIDHASH`, AWS sigv4) | Reproduce signature in script using `crypto.subtle.digest` and cookies |
| **httpOnly session only** | Cookie is httpOnly and there's no other token; rely entirely on `credentials: 'include'` | Nothing to read; trust the cookie jar |

If `auth-tokens` shows a JWT, look at the decoded claims — they often reveal a
user id you'll need as a query param later.

### By initial-data delivery

How the *first* page's worth of data reaches the client:

- **Embedded in the HTML.** The first paint's data is in a `<script>` tag (e.g.
  `window.__INITIAL_STATE__`, `window.ytInitialData`, framework hydration
  blobs). The first wire-level fetch is for *page 2* onward. Read page 1 from
  `window` inside the script; replay subsequent pages via API.
- **First-XHR-on-load.** A request fires shortly after DOMContentLoaded that
  fetches page 1 over the wire. Easy to capture and replay.
- **Lazy / on-interaction.** Nothing fetches until you click or scroll. Trigger
  the smallest interaction that surfaces the endpoint, then capture.

The "embedded in HTML" pattern is common in heavy SPAs and easy to miss — if
you can't find a network request for the data you can clearly see on the page,
look for a `window.<NAME>` global with the right shape.

### By response shape

- **Plain JSON.** `await res.json()` or `await gjson(res)`.
- **XSSI-prefixed JSON** (`)]}'\n` prepended). Common on some Google internal
  endpoints — not all of them. `gjson(response)` strips it transparently.
- **Positional arrays.** Every field accessed by numeric index, no field names
  (`[[1, null, [...], ...]]`). Discovery: capture two requests with different
  expected outputs, diff which array slots change. Build a small index → name
  legend once and reuse.
- **Normalized graph.** Top-level `data` plus an `included` / `recordMap` /
  side-table map keyed by URN or id. Field values are references; you have to
  walk the side table to resolve names.
- **GraphQL-shaped.** Either named query IDs in the URL (POST with persisted
  query, body holds `variables` + `features`/`extensions`) or a full GraphQL
  POST with the query inline. The `features` block often pins client-side
  feature flags that the server validates — copy verbatim from a fresh capture.

### By pagination

- **Cursor.** Response carries `nextCursor` / `next` / `cursor` / `after`. Pass
  back on next call. Watch for top vs bottom cursors: when an endpoint
  returns *both*, you must pick the right one — otherwise you'll re-fetch the
  same window. Confirm by comparing ids across pages.
- **Offset / limit.** Bump `offset` or `page`. Last page is shorter than
  `limit`.
- **Time window.** `startTime` / `endTime` params. **Watch the encoding** —
  ISO string, Unix seconds, Unix millis, or "days since 1970-01-01" all show
  up in the wild. Some endpoints hard-cap how many items they return per
  window regardless of range; use overlapping windows and dedupe by id.
- **Continuation token.** Black-box opaque blob you pass back verbatim. The
  *first* call may not include it (you pass a `browseId` / category instead);
  subsequent calls swap `browseId` for `continuation`.
- **No pagination.** Endpoint returns everything. Rare but exists for "list
  workspaces" / "list guilds" style endpoints.

### By API host

- **Same-origin API** (e.g. `/api/v3/*` on the page's own domain). Cookies
  attach automatically; CORS isn't a concern.
- **Cross-origin API** (e.g. `api.<host>` separate from `www.<host>`). CORS
  may block calls *from the page context* even though the public API works
  from curl. If `fetch` to the API host fails with `TypeError: Failed to
  fetch`, the page origin can't reach it; you'll need to scrape the HTML
  rendering instead, or open the API host as the active tab.

## Gotchas worth recognizing

- **200 ≠ logged in.** Many apps return 200 with an "empty state" or
  `loggedOut: true` body when your session is missing. Check the response
  *body shape*, not just the status. `auth-tokens --probe` returns a body
  preview specifically for this.
- **403 ≠ logged out.** A missing CSRF header on a write endpoint returns
  403 even when fully authenticated. The body usually says so explicitly
  ("CSRF check failed").
- **Captured tokens go stale.** Bearer tokens rotate, CSRF tokens rotate,
  session ids rotate. Always read auth values at *script* runtime from
  cookies/storage — never paste captured values into the fetch headers.
  `script gen`'s `STRIPPED_HEADERS` block exists for diagnosis, not copy.
- **Schemas drift.** Specific field names (`videoRenderer`, `tweetResult`,
  `recordMap.block`) change across releases. Walk the response recursively
  to find the leaf shape you want; don't hard-path through 5 levels of
  named keys.
- **Cursors go in unexpected places.** Twitter / X return both top and
  bottom cursors; older entries' cursors live inside `instructions[]`. Diff
  ids across two pages to confirm you're advancing.
- **Pseudo-cursors masquerade as cursors.** Some endpoints return a "refresh
  from top" hint that looks like a cursor but resets pagination if you pass
  it. If pages 2/3 keep overlapping with page 1, suspect this.
- **Request bodies can be compressed.** `Content-Encoding: gzip` on the
  *request* is rare but real (some modern Google APIs). brw transparently
  decompresses captured request bodies; if a script's generated body looks
  like mojibake, that's the symptom.
- **Cross-origin fetch may CORS-fail.** The page's domain isn't the API's
  domain ⇒ CORS may block. Test with `--inline` first.
- **localStorage may be hidden.** Some apps actively wipe `window.localStorage`
  to hide tokens. `auth-tokens` sniffs captured request headers instead, which
  is more reliable.
- **Virtualized lists.** Only rendered rows exist in the DOM. Use
  `new-tab --viewport WxH` to enlarge from the start; post-hoc `resize`
  doesn't always retrigger mount.

## When to fall back to DOM

Three realistic situations:

1. **Opaque positional protocol** where indexing the array would take longer
   than scraping the rendered row HTML.
2. **API is gated by a request signature you can't easily reproduce** and the
   captured headers go stale (rare with `auth-tokens` helper, but possible).
3. **Cross-origin API blocked by CORS** from the page you're on and you can't
   relocate to the API origin.

The fallback is still done via `script run`, not click/type. Open with a tall
viewport, then in the script: select all rows, dedupe by id, scroll the
virtualized container, repeat until stagnation.

```js
const seen = new Set();
const out = [];
const scroller = document.querySelector('<scroll-container>');
for (let i = 0; i < 30; i++) {
  for (const row of document.querySelectorAll('<row-selector>')) {
    const id = row.getAttribute('<id-attr>') || row.dataset.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(extract(row));
  }
  const before = out.length;
  scroller.scrollTop = scroller.scrollHeight;
  await sleep(400);
  if (out.length === before) break; // stagnation
}
return out;
```

## Quick command reference

```bash
# Tab setup
brw new-tab <url> --alias tab-x --wait dom [--viewport 1600x4000]

# Survey
brw auth-tokens --tab tab-x [--probe <url> [--probe-method POST] [--probe-body '{}']]
brw network --tab tab-x --url-pattern api --with-body-preview 300
brw network --tab tab-x --status 4xx                       # find errors
brw network --url-pattern A --url-pattern B --tab tab-x    # OR-match
brw network-request <id> --tab tab-x                       # full single request

# Iterate
brw script gen --url-pattern <p> --output /tmp/x.js --tab tab-x
brw script run --inline "return location.href" --tab tab-x         # one-off
brw script run - --tab tab-x <<'JS' ... JS                         # stdin
brw script run /tmp/x.js --timeout 120 --output /tmp/x.json --tab tab-x
# (with --output, stdout is a slim summary; full envelope in the file)
```

## Helpers injected inside `script run`

- `args` — parsed `--param key=value` pairs
- `log(...)` — appends to the `logs` array in the returned envelope
- `sleep(ms)` — promise-based delay
- `cookie(name)` — read a non-httpOnly cookie (decoded)
- `xssiUnwrap(text)` — strip `)]}'` XSSI prefix
- `gjson(responseOrText)` — strip XSSI + `JSON.parse` in one call

The script body is wrapped in an async IIFE — top-level `await` works, and
`return <value>` sends a value back in `result.result`.
