// csrf.ts — CSRF token management for generated MCP servers.
//
// Copied into `server/csrf.js` when the target app uses CSRF protection
// (Rails, Django, Phoenix, Laravel, and similar frameworks).
//
// Provides automatic token extraction from HTML meta tags and hidden form
// fields, cached token injection into requests, and transparent retry on
// 422 Unprocessable Entity responses (stale token).

import type {
  AuthFetchFn,
  AuthFetchResult,
  CsrfManagerConfig,
  CsrfManager,
} from "./types.js";

// -- HTML extraction helpers --------------------------------------------------

/**
 * Extract all `<meta>` tags from an HTML string into a name/content map.
 *
 * Handles both attribute orderings:
 *   `<meta name="csrf-token" content="abc123">`
 *   `<meta content="abc123" name="csrf-token">`
 */
export function extractMetaTags(html: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const pattern = /<meta\s+([^>]*?)>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1];
    const name =
      attrs.match(/name\s*=\s*"([^"]*)"/i)?.[1] ??
      attrs.match(/name\s*=\s*'([^']*)'/i)?.[1];
    const content =
      attrs.match(/content\s*=\s*"([^"]*)"/i)?.[1] ??
      attrs.match(/content\s*=\s*'([^']*)'/i)?.[1];

    if (name && content !== undefined) {
      tags[name] = content;
    }
  }

  return tags;
}

/**
 * Extract all `<input type="hidden">` fields from an HTML string.
 *
 * Returns a map of field names to their values. Handles attribute orderings
 * and both quote styles.
 */
export function extractHiddenFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const pattern = /<input\s+([^>]*?)>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1];

    // Only process hidden inputs
    const type =
      attrs.match(/type\s*=\s*"([^"]*)"/i)?.[1] ??
      attrs.match(/type\s*=\s*'([^']*)'/i)?.[1];
    if (type?.toLowerCase() !== "hidden") continue;

    const name =
      attrs.match(/name\s*=\s*"([^"]*)"/i)?.[1] ??
      attrs.match(/name\s*=\s*'([^']*)'/i)?.[1];
    const value =
      attrs.match(/value\s*=\s*"([^"]*)"/i)?.[1] ??
      attrs.match(/value\s*=\s*'([^']*)'/i)?.[1] ??
      "";

    if (name) {
      fields[name] = value;
    }
  }

  return fields;
}

// -- CSRF manager -------------------------------------------------------------

/**
 * Create a CSRF token manager bound to a specific domain and auth context.
 *
 * The manager fetches CSRF tokens from an HTML page's `<meta>` tags, caches
 * them, and injects them into subsequent requests. On 422 responses (stale
 * token), the token is automatically refreshed and the request retried once.
 */
export function createCsrfManager({
  domain,
  loginUrl,
  authFetch,
  pageUrl,
  headerName = "x-csrf-token",
  metaName = "csrf-token",
}: CsrfManagerConfig): CsrfManager {
  let cachedToken: string | null = null;

  /**
   * Ensure a valid CSRF token is available. Fetches the configured HTML page
   * and extracts the token from a `<meta>` tag if not already cached.
   */
  async function ensureCsrf(): Promise<string> {
    if (cachedToken) return cachedToken;

    const result: AuthFetchResult = await authFetch(
      pageUrl,
      { headers: { Accept: "text/html" } },
      loginUrl,
    );

    if (result.status !== 200) {
      throw new Error(
        `CSRF fetch failed: HTTP ${result.status} ${result.statusText} from ${pageUrl}`,
      );
    }

    const html =
      typeof result.body === "string"
        ? result.body
        : JSON.stringify(result.body);

    const tags = extractMetaTags(html);
    const token = tags[metaName];

    if (!token) {
      throw new Error(
        `CSRF token not found: no <meta name="${metaName}"> in ${pageUrl}`,
      );
    }

    cachedToken = token;
    return cachedToken;
  }

  /**
   * Perform an authenticated fetch with the CSRF token injected as a header.
   *
   * On a 422 response (typically "Invalid Authenticity Token" from Rails or
   * similar), the cached token is cleared, a fresh one is fetched via
   * `ensureCsrf()`, and the request is retried exactly once.
   */
  async function fetchWithCsrf(
    url: string,
    options: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
  ): Promise<AuthFetchResult> {
    const token = await ensureCsrf();

    const mergedOptions = {
      ...options,
      headers: {
        ...options.headers,
        [headerName]: token,
      },
    };

    const result = await authFetch(url, mergedOptions, loginUrl);

    // 422 typically means stale CSRF token — refresh and retry once
    if (result.status === 422) {
      cachedToken = null;
      const freshToken = await ensureCsrf();

      const retryOptions = {
        ...options,
        headers: {
          ...options.headers,
          [headerName]: freshToken,
        },
      };

      return await authFetch(url, retryOptions, loginUrl);
    }

    return result;
  }

  /**
   * Manually invalidate the cached CSRF token. Useful when you know the
   * session has been reset (e.g., after clearing cookies).
   */
  function clearToken(): void {
    cachedToken = null;
  }

  return { ensureCsrf, fetchWithCsrf, clearToken };
}
