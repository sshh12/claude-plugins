import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

interface TokenEntry {
  source: string;
  key: string;
  value: string;
  scheme?: string;
  jwtClaims?: Record<string, unknown> | null;
  note?: string;
}

function decodeJwt(token: string): Record<string, unknown> | null {
  // Format: header.payload.signature (base64url-encoded)
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function truncate(s: string, max = 80): string {
  if (s.length <= max) return s;
  return s.substring(0, max) + `... [${s.length - max} more]`;
}

function classifyValue(value: string): { scheme?: string; jwtClaims?: Record<string, unknown> | null } {
  // JWT detection: three base64url-ish segments separated by dots
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    const claims = decodeJwt(value);
    if (claims) return { scheme: 'jwt', jwtClaims: claims };
  }
  // CSRF-ish prefixes
  if (/^ajax:[0-9]+/.test(value)) return { scheme: 'csrf-session-id' };
  return {};
}

export async function handleAuthTokens(
  cdp: CDPManager,
  params: { tab?: string; verbose?: boolean; probe?: string; probeMethod?: string; probeBody?: string }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const entries: TokenEntry[] = [];

  // 1. Cookies visible to JS (non-httpOnly) for the current page.
  try {
    const { cookies } = await client.Network.getCookies();
    // Filter to current origin if possible
    const pageInfo = await cdp.getPageInfo(tabId);
    let host: string | null = null;
    try { host = new URL(pageInfo.url).hostname; } catch { /* ignore */ }

    for (const c of cookies) {
      if (host && c.domain && !host.endsWith(c.domain.replace(/^\./, ''))) continue;
      if (c.httpOnly && !params.verbose) continue; // httpOnly cookies aren't reachable from JS, so skip by default
      const cls = classifyValue(c.value || '');
      entries.push({
        source: c.httpOnly ? 'cookie:httpOnly' : 'cookie',
        key: c.name,
        value: truncate(c.value || ''),
        scheme: cls.scheme,
        jwtClaims: cls.jwtClaims,
        note: c.httpOnly ? 'httpOnly — not readable from JS, but auto-sent with credentials: \'include\'' : undefined,
      });
    }
  } catch (err: any) {
    entries.push({ source: 'cookies', key: '', value: '', note: `error: ${err?.message}` });
  }

  // 2. localStorage and sessionStorage — pull via JS in the page context
  try {
    const probe = `
(() => {
  function dump(store) {
    const out = {};
    try {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        out[k] = store.getItem(k);
      }
    } catch (e) {}
    return out;
  }
  return { local: dump(localStorage), session: dump(sessionStorage) };
})()
`;
    const res = await client.Runtime.evaluate({ expression: probe, returnByValue: true });
    if (res.result?.value) {
      const { local, session } = res.result.value;
      for (const [k, v] of Object.entries(local || {})) {
        const sv = String(v);
        const cls = classifyValue(sv);
        entries.push({
          source: 'localStorage',
          key: k,
          value: truncate(sv),
          scheme: cls.scheme,
          jwtClaims: cls.jwtClaims,
        });
      }
      for (const [k, v] of Object.entries(session || {})) {
        const sv = String(v);
        const cls = classifyValue(sv);
        entries.push({
          source: 'sessionStorage',
          key: k,
          value: truncate(sv),
          scheme: cls.scheme,
          jwtClaims: cls.jwtClaims,
        });
      }
    }
  } catch (err: any) {
    entries.push({ source: 'storage', key: '', value: '', note: `error: ${err?.message}` });
  }

  // 3. Scan recent captured requests for Authorization / csrf-token / x-csrf-token headers.
  const buffer = cdp.getNetworkBuffer(tabId);
  const seenHeaderValues = new Set<string>();
  for (let i = buffer.length - 1; i >= 0 && entries.length < 200; i--) {
    const r = buffer[i];
    if (!r.requestHeaders) continue;
    for (const [k, v] of Object.entries(r.requestHeaders)) {
      const lower = k.toLowerCase();
      const isAuthHeader =
        lower === 'authorization' ||
        lower === 'csrf-token' ||
        lower === 'x-csrf-token' ||
        lower === 'x-xsrf-token' ||
        lower === 'x-framework-xsrf-token';
      if (!isAuthHeader) continue;
      const seenKey = `${lower}:${v}`;
      if (seenHeaderValues.has(seenKey)) continue;
      seenHeaderValues.add(seenKey);

      // Try to extract just the token from a "Bearer X" / "bearer X" value
      const m = /^(bearer|basic|jwt|token)\s+(.+)$/i.exec(v);
      const token = m ? m[2] : v;
      const cls = classifyValue(token);
      entries.push({
        source: `captured-request:${r.method} ${r.url.substring(0, 60)}${r.url.length > 60 ? '…' : ''}`,
        key: k,
        value: truncate(v),
        scheme: m ? m[1].toLowerCase() : cls.scheme,
        jwtClaims: cls.jwtClaims,
      });
    }
  }

  // Heuristic summary — gives the caller a quick "likely logged in?" signal
  const nonEmpty = entries.filter((e) => e.value && e.value.length > 0);
  const hasJwt = nonEmpty.some((e) => e.scheme === 'jwt');
  const hasCapturedAuth = nonEmpty.some((e) => e.source.startsWith('captured-request') && e.value.length > 4);
  const hasSessionCookie = nonEmpty.some((e) =>
    e.source === 'cookie' && /session|auth|token|sid|jsess/i.test(e.key));
  const summary = {
    total: entries.length,
    nonEmpty: nonEmpty.length,
    hasJwt,
    hasCapturedAuth,
    hasSessionCookie,
    likelyLoggedIn: hasJwt || hasCapturedAuth || hasSessionCookie,
  };

  // Optional probe — fire a request from the page context to confirm login state.
  let probe: { url: string; method: string; status: number; ok: boolean; durationMs: number; bodyPreview?: string; error?: string } | undefined;
  if (params.probe) {
    const t0 = Date.now();
    const probeMethod = (params.probeMethod || 'GET').toUpperCase();
    const probeUrl = params.probe;
    const probeBody = params.probeBody;
    const expression = `
(async () => {
  try {
    const opts = { method: ${JSON.stringify(probeMethod)}, credentials: 'include' };
    ${probeBody ? `opts.headers = { 'content-type': 'application/json' }; opts.body = ${JSON.stringify(probeBody)};` : ''}
    const res = await fetch(${JSON.stringify(probeUrl)}, opts);
    const text = await res.text();
    return JSON.stringify({ status: res.status, ok: res.ok, body: text.substring(0, 400), totalLen: text.length });
  } catch (e) {
    return JSON.stringify({ status: 0, ok: false, error: e.message || String(e) });
  }
})()
`;
    try {
      const r = await client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true, timeout: 15000 });
      if (r.exceptionDetails) {
        probe = { url: probeUrl, method: probeMethod, status: 0, ok: false, durationMs: Date.now() - t0, error: r.exceptionDetails.exception?.description };
      } else {
        const parsed = JSON.parse(r.result?.value || '{}');
        probe = {
          url: probeUrl,
          method: probeMethod,
          status: parsed.status,
          ok: !!parsed.ok,
          durationMs: Date.now() - t0,
          bodyPreview: parsed.body,
          error: parsed.error,
        };
      }
    } catch (err: any) {
      probe = { url: probeUrl, method: probeMethod, status: 0, ok: false, durationMs: Date.now() - t0, error: err?.message };
    }

    // Refine the likely-logged-in heuristic with probe result.
    // Note: 403 is intentionally NOT treated as logged-out — it commonly means
    // "you're authenticated but missing a CSRF header" (LinkedIn voyager,
    // GitHub write endpoints, etc.). Only 401 reliably indicates no session.
    if (probe.ok && probe.status >= 200 && probe.status < 300) {
      summary.likelyLoggedIn = true;
    } else if (probe.status === 401) {
      summary.likelyLoggedIn = false;
    }
  }

  return {
    ok: true,
    count: entries.length,
    summary,
    probe,
    tokens: entries,
    hint: 'Inside scripts, read non-httpOnly cookies with document.cookie or the cookie(name) helper; ' +
          'localStorage/sessionStorage with localStorage.getItem(...); add captured Authorization headers ' +
          'back to fetch headers explicitly — the browser does NOT auto-send Authorization.',
  };
}
