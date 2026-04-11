// src/auth.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
if (!globalThis.WebSocket) {
  const ws = await import("ws");
  globalThis.WebSocket = ws.WebSocket;
}
var APP_NAME = null;
var COOKIE_DIR = null;
var CHROME_DATA_DIR = null;
var allowedDomain = null;
var chromeProc = null;
var cdpPort = null;
var LOGIN_TIMEOUT_MS = 12e4;
var COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var MAX_RETRIES = 2;
var THEME_COLOR = "#0F766E";
var BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};
function loginDoneUrl(appName) {
  const displayName = appName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `data:text/html,${encodeURIComponent(
    `<!DOCTYPE html><html><head><title>&#10003; ${displayName} &mdash; Connected</title></head><body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f0fdfa;color:#134e4a"><div style="text-align:center"><div style="width:64px;height:64px;border-radius:50%;background:#0f766e;color:white;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 16px">&#10003;</div><h2 style="margin:0 0 8px">${displayName} connected</h2><p style="margin:0;color:#115e59;font-size:14px">MCP connector authenticated &mdash; you can close this tab.</p></div></body></html>`
  )}`;
}
function init(appName) {
  if (!appName || typeof appName !== "string") {
    throw new Error("auth.init() requires a non-empty appName string");
  }
  APP_NAME = appName;
  COOKIE_DIR = path.join(os.homedir(), ".diy-mcp", appName, "cookies");
  CHROME_DATA_DIR = path.join(os.homedir(), ".diy-mcp", appName, "chrome-data");
  allowedDomain = null;
  fs.mkdirSync(COOKIE_DIR, { recursive: true, mode: 448 });
  fs.mkdirSync(CHROME_DATA_DIR, { recursive: true, mode: 448 });
  ensureChromeTheme();
}
function loadCookies(domain) {
  _ensureInitialized();
  try {
    const data = JSON.parse(fs.readFileSync(cookieFile(domain), "utf-8"));
    if (data.captured_at) {
      const age = Date.now() - new Date(data.captured_at).getTime();
      if (age > COOKIE_TTL_MS) {
        console.error(`[auth] cookies for ${domain} expired (${Math.round(age / 864e5)}d old), deleting`);
        clearCookies(domain);
        return null;
      }
    }
    return data.cookieHeader || null;
  } catch {
    return null;
  }
}
function saveCookies(domain, cookieHeader, rawCookies) {
  _ensureInitialized();
  fs.writeFileSync(
    cookieFile(domain),
    JSON.stringify(
      { domain, cookieHeader, raw: rawCookies, captured_at: (/* @__PURE__ */ new Date()).toISOString() },
      null,
      2
    ),
    { mode: 384 }
  );
  console.error(`[auth] saved cookies for ${domain}`);
}
function clearCookies(domain) {
  _ensureInitialized();
  try {
    fs.unlinkSync(cookieFile(domain));
  } catch {
  }
}
async function launchChrome(url) {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error("Chrome not found. Install Google Chrome to enable auto-login.");
  }
  if (CHROME_DATA_DIR && !cdpPort) {
    try {
      execSync(`pkill -f "user-data-dir=${CHROME_DATA_DIR.replace(/"/g, '\\"')}"`, {
        stdio: "ignore",
        timeout: 3e3
      });
      await new Promise((r) => setTimeout(r, 500));
    } catch {
    }
  }
  if (cdpPort && await isCDPUp()) {
    try {
      await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(5e3)
      });
    } catch {
    }
    return;
  }
  const proc = spawn(
    chromePath,
    [
      "--remote-debugging-port=0",
      "--disable-blink-features=AutomationControlled",
      `--user-data-dir=${CHROME_DATA_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      url
    ],
    { detached: true, stdio: ["ignore", "ignore", "pipe"] }
  );
  chromeProc = proc;
  const discoveredPort = await new Promise((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => {
      proc.stderr.removeAllListeners();
      reject(new Error("Timed out waiting for Chrome CDP port"));
    }, 15e3);
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        proc.stderr.removeAllListeners();
        proc.stderr.destroy();
        resolve(parseInt(match[1], 10));
      }
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited with code ${code} before CDP was ready`));
    });
  });
  cdpPort = discoveredPort;
  proc.unref();
  console.error(`[auth] Chrome CDP listening on port ${cdpPort}`);
  for (let i = 0; i < 30; i++) {
    if (await isCDPUp()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Chrome launched but CDP not responding.");
}
async function getCookiesViaCDP(domain) {
  if (!cdpPort) return null;
  try {
    const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
      signal: AbortSignal.timeout(3e3)
    }).then((r) => r.json());
    let page = pages.find((p) => p.url.includes(domain)) || pages[0];
    if (!page?.webSocketDebuggerUrl) {
      page = await ensureCDPPage(domain) ?? void 0;
      if (!page?.webSocketDebuggerUrl) return null;
    }
    return await getCookiesFromPage(page.webSocketDebuggerUrl, domain);
  } catch {
    return null;
  }
}
async function showLoginComplete(domain) {
  await navigateCDPPage(domain, loginDoneUrl(APP_NAME || "app"));
}
async function authFetch(url, options = {}, loginUrl, { forceLogin = false, validateFn } = {}) {
  _ensureInitialized();
  const urlObj = new URL(url);
  const domain = urlObj.hostname;
  _assertDomainAllowed(domain);
  if (forceLogin) {
    console.error(`[auth] forced login for ${domain}`);
    const target = loginUrl || url;
    const cookieHeader = await captureLoginCookies(target, domain, validateFn);
    options.headers = { ...options.headers, Cookie: cookieHeader };
    return await rawFetch(url, options);
  }
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
function closeChrome() {
  if (chromeProc) {
    try {
      chromeProc.kill();
    } catch {
    }
    chromeProc = null;
  }
  cdpPort = null;
}
function _ensureInitialized() {
  if (!COOKIE_DIR) {
    throw new Error("auth.init(appName) must be called before using any auth function");
  }
}
function _assertDomainAllowed(hostname) {
  if (!allowedDomain) {
    allowedDomain = hostname;
    return;
  }
  if (hostname !== allowedDomain && !hostname.endsWith(`.${allowedDomain}`)) {
    throw new Error(
      `[auth] cross-domain request blocked: ${hostname} is not under ${allowedDomain}`
    );
  }
}
function ensureChromeTheme() {
  const prefsDir = path.join(CHROME_DATA_DIR, "Default");
  const prefsFile = path.join(prefsDir, "Preferences");
  fs.mkdirSync(prefsDir, { recursive: true });
  const r = parseInt(THEME_COLOR.slice(1, 3), 16);
  const g = parseInt(THEME_COLOR.slice(3, 5), 16);
  const b = parseInt(THEME_COLOR.slice(5, 7), 16);
  const argb = 255 << 24 | r << 16 | g << 8 | b | 0;
  let prefs = {};
  try {
    prefs = JSON.parse(fs.readFileSync(prefsFile, "utf-8"));
  } catch {
  }
  const browser = prefs.browser ?? {};
  const theme = browser.theme ?? {};
  if (theme.user_color2 === argb) return;
  theme.user_color2 = argb;
  theme.color_variant2 = 1;
  browser.theme = theme;
  prefs.browser = browser;
  fs.writeFileSync(prefsFile, JSON.stringify(prefs, null, 2));
  console.error(`[auth] set Chrome theme to ${THEME_COLOR}`);
}
function cookieFile(domain) {
  return path.join(COOKIE_DIR, `${domain.replace(/[^a-zA-Z0-9.-]/g, "_")}.json`);
}
function isAuthFailure(result) {
  if (result.status === 401 || result.status === 403) return true;
  if (result.redirected && result.url && /login|signin|auth|sso/i.test(result.url)) return true;
  return false;
}
async function rawFetch(url, options = {}, _attempt = 0) {
  const start = Date.now();
  const mergedHeaders = { ...BROWSER_HEADERS, ...options.headers };
  const resp = await fetch(url, {
    ...options,
    headers: mergedHeaders,
    redirect: "manual",
    signal: AbortSignal.timeout(3e4)
  });
  const elapsed = Date.now() - start;
  if ([301, 302, 303, 307, 308].includes(resp.status)) {
    const location = resp.headers.get("location");
    if (location) {
      const redirectUrl = new URL(location, url);
      const originalHost = new URL(url).hostname;
      if (redirectUrl.hostname === originalHost || redirectUrl.hostname.endsWith(`.${originalHost}`)) {
        const method = [301, 302, 303].includes(resp.status) ? "GET" : options.method;
        const redirectOpts = {
          ...options,
          method,
          headers: mergedHeaders
        };
        if (method === "GET") {
          delete redirectOpts.body;
        }
        return rawFetch(redirectUrl.href, redirectOpts, _attempt);
      }
      console.error(`[auth] blocked cross-domain redirect to ${redirectUrl.hostname}`);
    }
  }
  if ((resp.status === 429 || resp.status === 503) && _attempt < MAX_RETRIES) {
    const retryAfter = resp.headers.get("retry-after");
    let delayMs = 1e3 * Math.pow(2, _attempt);
    if (retryAfter) {
      const parsed = Number(retryAfter);
      if (!Number.isNaN(parsed)) {
        delayMs = parsed * 1e3;
      } else {
        const retryDate = new Date(retryAfter).getTime();
        if (!Number.isNaN(retryDate)) {
          delayMs = Math.max(0, retryDate - Date.now());
        }
      }
    }
    console.error(`[auth] ${resp.status} \u2014 retrying in ${Math.round(delayMs)}ms (attempt ${_attempt + 1}/${MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, delayMs));
    return rawFetch(url, options, _attempt + 1);
  }
  const headers = {};
  resp.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const ct = resp.headers.get("content-type") || "";
  let body;
  let text = await resp.text();
  if (text.length > 1e5) text = text.slice(0, 1e5) + "\n... [truncated]";
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
    elapsed_ms: elapsed
  };
}
function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser"
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
async function isCDPUp() {
  if (!cdpPort) return false;
  try {
    await fetch(`http://127.0.0.1:${cdpPort}/json`, { signal: AbortSignal.timeout(2e3) });
    return true;
  } catch {
    return false;
  }
}
async function ensureCDPPage(domain) {
  if (!cdpPort) return null;
  try {
    const version = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
      signal: AbortSignal.timeout(2e3)
    }).then((r) => r.json());
    if (!version?.webSocketDebuggerUrl) return null;
    const targetId = await new Promise((resolve) => {
      const ws = new WebSocket(version.webSocketDebuggerUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
        }
        resolve(null);
      }, 5e3);
      ws.onopen = () => ws.send(
        JSON.stringify({
          id: 1,
          method: "Target.createTarget",
          params: { url: `https://${domain}` }
        })
      );
      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.id === 1) {
          clearTimeout(timer);
          ws.close();
          resolve(msg.result?.targetId ?? null);
        }
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
    });
    if (!targetId) return null;
    await new Promise((r) => setTimeout(r, 2e3));
    const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
      signal: AbortSignal.timeout(3e3)
    }).then((r) => r.json());
    return pages.find((p) => p.id === targetId) || null;
  } catch {
    return null;
  }
}
async function getCookiesFromPage(wsUrl, domain) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
      }
      resolve(null);
    }, 5e3);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Network.getCookies",
          params: { urls: [`https://${domain}`, `http://${domain}`] }
        })
      );
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        resolve(msg.result?.cookies || []);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
  });
}
async function navigateCDPPage(domain, url) {
  if (!cdpPort) return;
  try {
    const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`, {
      signal: AbortSignal.timeout(3e3)
    }).then((r) => r.json());
    const page = pages.find((p) => p.url.includes(domain));
    if (!page?.webSocketDebuggerUrl) return;
    await new Promise((resolve) => {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
        }
        resolve();
      }, 5e3);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url } }));
      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
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
  }
}
async function captureLoginCookies(loginUrl, domain, validateFn) {
  console.error(`[auth] opening browser for login: ${loginUrl}`);
  await launchChrome(loginUrl);
  const start = Date.now();
  while (Date.now() - start < LOGIN_TIMEOUT_MS) {
    const cookies = await getCookiesViaCDP(domain);
    if (cookies && cookies.length > 0) {
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      if (validateFn) {
        try {
          const valid = await validateFn(cookieHeader);
          if (!valid) {
            await new Promise((r) => setTimeout(r, 2e3));
            continue;
          }
        } catch (err) {
          console.error(`[auth] validateFn error: ${err.message}`);
          await new Promise((r) => setTimeout(r, 2e3));
          continue;
        }
      }
      saveCookies(domain, cookieHeader, cookies);
      await showLoginComplete(domain).catch(() => {
      });
      return cookieHeader;
    }
    await new Promise((r) => setTimeout(r, 2e3));
  }
  throw new Error(
    `Login timed out (${LOGIN_TIMEOUT_MS / 1e3}s). No cookies captured for ${domain}.`
  );
}
export {
  authFetch,
  clearCookies,
  closeChrome,
  getCookiesViaCDP,
  init,
  launchChrome,
  loadCookies,
  saveCookies,
  showLoginComplete
};
