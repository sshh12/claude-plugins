// auth.ts — Cookie persistence and Chrome CDP auto-login for diy-mcp servers.
// Template file: gets copied into generated MCP servers as server/auth.js.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";

import type {
  AuthFetchResult,
  AuthFetchExtraOptions,
  CDPCookie,
  CDPPage,
  CDPVersionInfo,
  CDPMessage,
  CookieData,
  ChildProcess,
} from "./types.js";

/** Fetch options with headers narrowed to Record<string, string> for easy spreading. */
interface FetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
}

// Polyfill WebSocket for Node.js < 21 (global WebSocket added in v21)
if (!globalThis.WebSocket) {
  const ws = await import("ws");
  globalThis.WebSocket = ws.WebSocket as unknown as typeof WebSocket;
}

// -- Module State -------------------------------------------------------------

let APP_NAME: string | null = null;
let COOKIE_DIR: string | null = null;
let CHROME_DATA_DIR: string | null = null;
let allowedDomain: string | null = null;
let chromeProc: ChildProcess | null = null;
let cdpPort: number | null = null;

const LOGIN_TIMEOUT_MS = 120_000;
const COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_RETRIES = 2;

// Chrome theme color for the MCP connector profile.
// Dark teal (#0F766E) — visually distinct from the user's regular Chrome.
const THEME_COLOR = "#0F766E";

// Default browser-like headers to avoid Cloudflare bot detection (error 1010).
// Caller-provided headers always override these via spread order in rawFetch().
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function loginDoneUrl(appName: string): string {
  const displayName = appName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `data:text/html,${encodeURIComponent(
    `<!DOCTYPE html><html><head><title>&#10003; ${displayName} &mdash; Connected</title></head>` +
    `<body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0fdfa;color:#134e4a">` +
    `<div style="text-align:center">` +
    `<div style="width:64px;height:64px;border-radius:50%;background:#0f766e;color:white;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 16px">&#10003;</div>` +
    `<h2 style="margin:0 0 8px">${displayName} connected</h2>` +
    `<p style="margin:0;color:#115e59;font-size:14px">MCP connector authenticated &mdash; you can close this tab.</p>` +
    `</div></body></html>`,
  )}`;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Initialize the auth module for a specific app. Must be called before any
 * other exported function.
 */
export function init(appName: string): void {
  if (!appName || typeof appName !== "string") {
    throw new Error("auth.init() requires a non-empty appName string");
  }
  APP_NAME = appName;
  COOKIE_DIR = path.join(os.homedir(), ".diy-mcp", appName, "cookies");
  CHROME_DATA_DIR = path.join(os.homedir(), ".diy-mcp", appName, "chrome-data");
  allowedDomain = null; // reset; will be derived from first authFetch url
  fs.mkdirSync(COOKIE_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(CHROME_DATA_DIR, { recursive: true, mode: 0o700 });
  ensureChromeTheme();
}

/**
 * Load saved cookie header for a domain. Returns null if expired or missing.
 */
export function loadCookies(domain: string): string | null {
  _ensureInitialized();
  try {
    const data: CookieData = JSON.parse(fs.readFileSync(cookieFile(domain), "utf-8"));
    // Enforce 7-day TTL
    if (data.captured_at) {
      const age = Date.now() - new Date(data.captured_at).getTime();
      if (age > COOKIE_TTL_MS) {
        console.error(`[auth] cookies for ${domain} expired (${Math.round(age / 86400000)}d old), deleting`);
        clearCookies(domain);
        return null;
      }
    }
    return data.cookieHeader || null;
  } catch {
    return null;
  }
}

/**
 * Persist cookies for a domain.
 */
export function saveCookies(domain: string, cookieHeader: string, rawCookies: CDPCookie[]): void {
  _ensureInitialized();
  fs.writeFileSync(
    cookieFile(domain),
    JSON.stringify(
      { domain, cookieHeader, raw: rawCookies, captured_at: new Date().toISOString() },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.error(`[auth] saved cookies for ${domain}`);
}

/**
 * Delete saved cookies for a domain.
 */
export function clearCookies(domain: string): void {
  _ensureInitialized();
  try {
    fs.unlinkSync(cookieFile(domain));
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Launch Chrome with CDP enabled and open a URL. If Chrome is already running
 * with CDP, opens a new tab instead.
 */
export async function launchChrome(url: string): Promise<void> {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome not found. Install Google Chrome to enable auto-login.");
  }

  // Kill stale Chrome processes using the same data directory.
  // Chrome enforces single-instance-per-data-dir: a second spawn with the same
  // dir silently delegates to the existing process and exits code 0, which breaks
  // our CDP port discovery. Killing stale processes first avoids this.
  if (CHROME_DATA_DIR && !cdpPort) {
    try {
      execSync(`pkill -f "user-data-dir=${CHROME_DATA_DIR.replace(/"/g, '\\"')}"`, {
        stdio: "ignore",
        timeout: 3000,
      });
      // Brief pause for process cleanup
      await new Promise((r) => setTimeout(r, 500));
    } catch {
      // No matching process — expected on first run
    }
  }

  // If CDP is already running on our tracked port, open a new tab
  if (cdpPort && (await isCDPUp())) {
    try {
      await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Ignore tab creation errors
    }
    return;
  }

  // Launch Chrome with --remote-debugging-port=0 (OS picks a free port).
  // We discover the actual port from Chrome's stderr output.
  const proc = spawn(
    chromePath,
    [
      "--remote-debugging-port=0",
      "--disable-blink-features=AutomationControlled",
      `--user-data-dir=${CHROME_DATA_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      url,
    ],
    { detached: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  chromeProc = proc;

  // Parse the actual debugging port from stderr
  const discoveredPort = await new Promise<number>((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      proc.stderr!.removeAllListeners();
      reject(new Error("Timed out waiting for Chrome CDP port"));
    }, 15_000);

    proc.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      // Chrome prints: DevTools listening on ws://127.0.0.1:<port>/devtools/browser/...
      const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        proc.stderr!.removeAllListeners();
        // Detach stderr so it doesn't keep the process alive
        proc.stderr!.destroy();
        resolve(parseInt(match[1], 10));
      }
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on("exit", (code: number | null) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited with code ${code} before CDP was ready`));
    });
  });

  cdpPort = discoveredPort;
  proc.unref();
  console.error(`[auth] Chrome CDP listening on port ${cdpPort}`);

  // Verify CDP is actually responding
  for (let i = 0; i < 30; i++) {
    if (await isCDPUp()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Chrome launched but CDP not responding.");
}

/**
 * Extract cookies from Chrome via CDP for a given domain.
 */
export async function getCookiesViaCDP(domain: string): Promise<CDPCookie[] | null> {
  if (!cdpPort) return null;
  try {
    const pages: CDPPage[] = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
      signal: AbortSignal.timeout(3000),
    }).then((r) => r.json() as Promise<CDPPage[]>);
    let page: CDPPage | undefined = pages.find((p) => p.url.includes(domain)) || pages[0];

    // Fallback: SSO redirects can cause the original tab to vanish from /json.
    // Use the browser-level WebSocket to create a new tab for the domain.
    if (!page?.webSocketDebuggerUrl) {
      page = (await ensureCDPPage(domain)) ?? undefined;
      if (!page?.webSocketDebuggerUrl) return null;
    }

    return await getCookiesFromPage(page.webSocketDebuggerUrl!, domain);
  } catch {
    return null;
  }
}

/**
 * Navigate the domain's tab to a "Login complete" confirmation page.
 */
export async function showLoginComplete(domain: string): Promise<void> {
  await navigateCDPPage(domain, loginDoneUrl(APP_NAME || "app"));
}

/**
 * Auth-aware fetch. Injects saved cookies, handles auth failures by launching
 * browser login, and retries.
 */
export async function authFetch(
  url: string,
  options: FetchOptions = {},
  loginUrl?: string,
  { forceLogin = false, validateFn }: AuthFetchExtraOptions = {},
): Promise<AuthFetchResult> {
  _ensureInitialized();
  const urlObj = new URL(url);
  const domain = urlObj.hostname;

  // Security: validate that the request domain matches the configured domain
  _assertDomainAllowed(domain);

  // Force browser login if requested (e.g. GraphQL returned null data)
  if (forceLogin) {
    console.error(`[auth] forced login for ${domain}`);
    const target = loginUrl || url;
    const cookieHeader = await captureLoginCookies(target, domain, validateFn);
    options.headers = { ...options.headers, Cookie: cookieHeader };
    return await rawFetch(url, options);
  }

  // Inject saved cookies if none explicitly set
  if (!options.headers?.Cookie) {
    const saved = loadCookies(domain);
    if (saved) {
      options.headers = { ...options.headers, Cookie: saved };
      console.error(`[auth] using saved cookies for ${domain}`);
    }
  }

  let result = await rawFetch(url, options);

  if (isAuthFailure(result)) {
    console.error(`[auth] got ${result.status} from ${domain}, launching browser login...`);
    clearCookies(domain);
    const target = loginUrl || (result.redirected ? result.url : url);
    const cookieHeader = await captureLoginCookies(target, domain, validateFn);
    options.headers = { ...options.headers, Cookie: cookieHeader };
    result = await rawFetch(url, options);
  }

  return result;
}

/**
 * Terminate the CDP Chrome process launched by this module.
 */
export function closeChrome(): void {
  if (chromeProc) {
    try {
      chromeProc.kill();
    } catch {
      // Ignore kill errors
    }
    chromeProc = null;
  }
  cdpPort = null;
}

// =============================================================================
// Internal helpers
// =============================================================================

function _ensureInitialized(): void {
  if (!COOKIE_DIR) {
    throw new Error("auth.init(appName) must be called before using any auth function");
  }
}

/** Derive the "allowed domain" from the first authFetch call and validate subsequent calls. */
function _assertDomainAllowed(hostname: string): void {
  if (!allowedDomain) {
    // First call sets the allowed domain
    allowedDomain = hostname;
    return;
  }
  // Allow exact match or subdomains (e.g. api.example.com matches example.com)
  if (hostname !== allowedDomain && !hostname.endsWith(`.${allowedDomain}`)) {
    throw new Error(
      `[auth] cross-domain request blocked: ${hostname} is not under ${allowedDomain}`,
    );
  }
}

/**
 * Write Chrome Preferences with the MCP connector theme color so the browser
 * window is visually distinct from the user's regular Chrome. Merges into
 * existing Preferences if present. Only writes when the color differs.
 */
function ensureChromeTheme(): void {
  const prefsDir = path.join(CHROME_DATA_DIR!, "Default");
  const prefsFile = path.join(prefsDir, "Preferences");
  fs.mkdirSync(prefsDir, { recursive: true });

  // Parse hex → signed 32-bit ARGB int (Chrome's Preferences format)
  const r = parseInt(THEME_COLOR.slice(1, 3), 16);
  const g = parseInt(THEME_COLOR.slice(3, 5), 16);
  const b = parseInt(THEME_COLOR.slice(5, 7), 16);
  const argb = ((0xFF << 24) | (r << 16) | (g << 8) | b) | 0;

  let prefs: Record<string, unknown> = {};
  try {
    prefs = JSON.parse(fs.readFileSync(prefsFile, "utf-8"));
  } catch {
    // No existing prefs or invalid JSON — start fresh
  }

  const browser = (prefs.browser as Record<string, unknown>) ?? {};
  const theme = (browser.theme as Record<string, unknown>) ?? {};

  if (theme.user_color2 === argb) return; // already set

  theme.user_color2 = argb;
  theme.color_variant2 = 1; // "tonal spot" — Chrome applies harmonious tints
  browser.theme = theme;
  prefs.browser = browser;

  fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
  console.error(`[auth] set Chrome theme to ${THEME_COLOR}`);
}

function cookieFile(domain: string): string {
  return path.join(COOKIE_DIR!, `${domain.replace(/[^a-zA-Z0-9.-]/g, "_")}.json`);
}

function isAuthFailure(result: AuthFetchResult): boolean {
  if (result.status === 401 || result.status === 403) return true;
  if (result.redirected && result.url && /login|signin|auth|sso/i.test(result.url)) return true;
  return false;
}

// -- rawFetch with safe redirect handling & retry on 429/503 ------------------

async function rawFetch(
  url: string,
  options: FetchOptions = {},
  _attempt = 0,
): Promise<AuthFetchResult> {
  const start = Date.now();
  const mergedHeaders = { ...BROWSER_HEADERS, ...options.headers };
  const resp = await fetch(url, {
    ...options,
    headers: mergedHeaders,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const elapsed = Date.now() - start;

  // Safe redirect following: only follow redirects to the same domain
  if ([301, 302, 303, 307, 308].includes(resp.status)) {
    const location = resp.headers.get("location");
    if (location) {
      const redirectUrl = new URL(location, url);
      const originalHost = new URL(url).hostname;
      if (
        redirectUrl.hostname === originalHost ||
        redirectUrl.hostname.endsWith(`.${originalHost}`)
      ) {
        // Same-domain redirect — follow it
        const method = [301, 302, 303].includes(resp.status) ? "GET" : options.method;
        const redirectOpts: FetchOptions = {
          ...options,
          method,
          headers: mergedHeaders,
        };
        // Drop body on GET redirects
        if (method === "GET") {
          delete redirectOpts.body;
        }
        return rawFetch(redirectUrl.href, redirectOpts, _attempt);
      }
      // Cross-domain redirect — return as-is so the caller can see the redirect
      console.error(`[auth] blocked cross-domain redirect to ${redirectUrl.hostname}`);
    }
  }

  // Retry on 429 (rate limit) and 503 (service unavailable)
  if ((resp.status === 429 || resp.status === 503) && _attempt < MAX_RETRIES) {
    const retryAfter = resp.headers.get("retry-after");
    let delayMs = 1000 * Math.pow(2, _attempt); // 1s, 2s
    if (retryAfter) {
      const parsed = Number(retryAfter);
      if (!Number.isNaN(parsed)) {
        delayMs = parsed * 1000;
      } else {
        const retryDate = new Date(retryAfter).getTime();
        if (!Number.isNaN(retryDate)) {
          delayMs = Math.max(0, retryDate - Date.now());
        }
      }
    }
    console.error(`[auth] ${resp.status} — retrying in ${Math.round(delayMs)}ms (attempt ${_attempt + 1}/${MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, delayMs));
    return rawFetch(url, options, _attempt + 1);
  }

  // Parse response
  const headers: Record<string, string> = {};
  resp.headers.forEach((v, k) => {
    headers[k] = v;
  });

  const ct = resp.headers.get("content-type") || "";
  let body: unknown;
  // Always read as text first — response body is a stream that can only be
  // consumed once. Reading via resp.json() then falling back to resp.text()
  // fails because the stream is already consumed.
  const maxResponseLen = parseInt(process.env.MCP_MAX_RESPONSE_LEN || "10000000", 10);
  let text = await resp.text();
  if (text.length > maxResponseLen) text = text.slice(0, maxResponseLen) + "\n... [truncated]";
  if (ct.includes("application/json")) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  } else {
    body = text;
  }

  return {
    status: resp.status,
    statusText: resp.statusText,
    headers,
    body,
    url: resp.url,
    redirected: resp.url !== url,
    elapsed_ms: elapsed,
  };
}

// -- Chrome CDP internals -----------------------------------------------------

function findChrome(): string | null {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function isCDPUp(): Promise<boolean> {
  if (!cdpPort) return false;
  try {
    await fetch(`http://127.0.0.1:${cdpPort}/json`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

async function ensureCDPPage(domain: string): Promise<CDPPage | null> {
  if (!cdpPort) return null;
  try {
    const version: CDPVersionInfo = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
      signal: AbortSignal.timeout(2000),
    }).then((r) => r.json() as Promise<CDPVersionInfo>);
    if (!version?.webSocketDebuggerUrl) return null;

    const targetId = await new Promise<string | null>((resolve) => {
      const ws = new WebSocket(version.webSocketDebuggerUrl!);
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        resolve(null);
      }, 5000);
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            id: 1,
            method: "Target.createTarget",
            params: { url: `https://${domain}` },
          }),
        );
      ws.onmessage = (event) => {
        const msg: CDPMessage = JSON.parse(String(event.data));
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          resolve((msg.result?.targetId as string) ?? null);
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
    });
    if (!targetId) return null;

    await new Promise((r) => setTimeout(r, 2000));
    const pages: CDPPage[] = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
      signal: AbortSignal.timeout(3000),
    }).then((r) => r.json() as Promise<CDPPage[]>);
    return pages.find((p) => p.id === targetId) || null;
  } catch {
    return null;
  }
}

/**
 * Fetch all cookies from a CDP page, filtered to the target domain and its
 * parent domains. Uses an empty `urls` param so CDP returns every cookie in the
 * browsing context — this handles SSO flows where auth cookies land on a parent
 * domain (e.g. `.spinach.io`) or a different subdomain than the API target.
 */
async function getCookiesFromPage(wsUrl: string, domain: string): Promise<CDPCookie[] | null> {
  // Build list of domain suffixes to match: api.example.com → [api.example.com, .example.com, .com]
  const domainParts = domain.split(".");
  const matchSuffixes: string[] = [domain];
  for (let i = 1; i < domainParts.length; i++) {
    matchSuffixes.push("." + domainParts.slice(i).join("."));
  }

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* ignore */ }
      resolve(null);
    }, 5000);
    ws.onopen = () => {
      // Empty urls → all cookies in the browsing context
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Network.getCookies",
          params: {},
        }),
      );
    };
    ws.onmessage = (event) => {
      const msg: CDPMessage = JSON.parse(String(event.data));
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        const all = (msg.result?.cookies as CDPCookie[]) || [];
        // Keep cookies whose domain matches the target or any parent domain
        const matched = all.filter((c) => {
          const cd = c.domain || "";
          return matchSuffixes.some((s) => cd === s || cd === "." + domain);
        });
        resolve(matched.length > 0 ? matched : all.length > 0 ? all : []);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
  });
}

async function navigateCDPPage(domain: string, url: string): Promise<void> {
  if (!cdpPort) return;
  try {
    const pages: CDPPage[] = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
      signal: AbortSignal.timeout(3000),
    }).then((r) => r.json() as Promise<CDPPage[]>);
    const page = pages.find((p) => p.url.includes(domain));
    if (!page?.webSocketDebuggerUrl) return;

    await new Promise<void>((resolve) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl!);
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* ignore */ }
        resolve();
      }, 5000);
      ws.onopen = () =>
        ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url } }));
      ws.onmessage = (event) => {
        const msg: CDPMessage = JSON.parse(String(event.data));
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  } catch {
    // Ignore navigation errors
  }
}

async function captureLoginCookies(
  loginUrl: string,
  domain: string,
  validateFn?: (cookieHeader: string) => Promise<boolean>,
): Promise<string> {
  console.error(`[auth] opening browser for login: ${loginUrl}`);
  await launchChrome(loginUrl);

  const start = Date.now();
  while (Date.now() - start < LOGIN_TIMEOUT_MS) {
    const cookies = await getCookiesViaCDP(domain);
    if (cookies && cookies.length > 0) {
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

      // When validateFn is provided, keep polling until it confirms the cookies
      // are real auth cookies (not just pre-auth CSRF/analytics cookies).
      if (validateFn) {
        try {
          const valid = await validateFn(cookieHeader);
          if (!valid) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
        } catch (err) {
          console.error(`[auth] validateFn error: ${(err as Error).message}`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
      }

      saveCookies(domain, cookieHeader, cookies);
      // Show branded success page so user knows login captured
      await showLoginComplete(domain).catch(() => {});
      return cookieHeader;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    `Login timed out (${LOGIN_TIMEOUT_MS / 1000}s). No cookies captured for ${domain}.`,
  );
}
