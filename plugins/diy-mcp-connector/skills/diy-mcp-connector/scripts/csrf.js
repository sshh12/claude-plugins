// src/csrf.ts
function extractMetaTags(html) {
  const tags = {};
  const pattern = /<meta\s+([^>]*?)>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1];
    const name = attrs.match(/name\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/name\s*=\s*'([^']*)'/i)?.[1];
    const content = attrs.match(/content\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/content\s*=\s*'([^']*)'/i)?.[1];
    if (name && content !== void 0) {
      tags[name] = content;
    }
  }
  return tags;
}
function extractHiddenFields(html) {
  const fields = {};
  const pattern = /<input\s+([^>]*?)>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1];
    const type = attrs.match(/type\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/type\s*=\s*'([^']*)'/i)?.[1];
    if (type?.toLowerCase() !== "hidden") continue;
    const name = attrs.match(/name\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/name\s*=\s*'([^']*)'/i)?.[1];
    const value = attrs.match(/value\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/value\s*=\s*'([^']*)'/i)?.[1] ?? "";
    if (name) {
      fields[name] = value;
    }
  }
  return fields;
}
function createCsrfManager({
  domain,
  loginUrl,
  authFetch,
  pageUrl,
  headerName = "x-csrf-token",
  metaName = "csrf-token"
}) {
  let cachedToken = null;
  async function ensureCsrf() {
    if (cachedToken) return cachedToken;
    const result = await authFetch(
      pageUrl,
      { headers: { Accept: "text/html" } },
      loginUrl
    );
    if (result.status !== 200) {
      throw new Error(
        `CSRF fetch failed: HTTP ${result.status} ${result.statusText} from ${pageUrl}`
      );
    }
    const html = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
    const tags = extractMetaTags(html);
    const token = tags[metaName];
    if (!token) {
      throw new Error(
        `CSRF token not found: no <meta name="${metaName}"> in ${pageUrl}`
      );
    }
    cachedToken = token;
    return cachedToken;
  }
  async function fetchWithCsrf(url, options = {}) {
    const token = await ensureCsrf();
    const mergedOptions = {
      ...options,
      headers: {
        ...options.headers,
        [headerName]: token
      }
    };
    const result = await authFetch(url, mergedOptions, loginUrl);
    if (result.status === 422) {
      cachedToken = null;
      const freshToken = await ensureCsrf();
      const retryOptions = {
        ...options,
        headers: {
          ...options.headers,
          [headerName]: freshToken
        }
      };
      return await authFetch(url, retryOptions, loginUrl);
    }
    return result;
  }
  function clearToken() {
    cachedToken = null;
  }
  return { ensureCsrf, fetchWithCsrf, clearToken };
}
export {
  createCsrfManager,
  extractHiddenFields,
  extractMetaTags
};
