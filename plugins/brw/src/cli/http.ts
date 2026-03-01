import http from 'http';
import type { ApiResponse } from '../shared/types.js';

/**
 * Send a request to the proxy server.
 */
export async function proxyRequest(
  method: string,
  path: string,
  body: Record<string, unknown>,
  port: number,
  timeout: number,
  debug: boolean
): Promise<ApiResponse> {
  const bodyStr = method !== 'GET' ? JSON.stringify(body) : '';
  const url = `http://localhost:${port}${path}`;

  if (debug) {
    process.stderr.write(`[brw] ${method} ${url}\n`);
    if (bodyStr) {
      process.stderr.write(`[brw] body: ${bodyStr}\n`);
    }
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
        timeout: timeout * 1000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (debug) {
            process.stderr.write(`[brw] response ${res.statusCode}: ${data.slice(0, 200)}\n`);
          }
          try {
            const parsed = JSON.parse(data);
            resolve(parsed as ApiResponse);
          } catch {
            resolve({
              ok: false,
              error: `Invalid JSON response: ${data.slice(0, 200)}`,
              code: 'PROXY_ERROR',
            });
          }
        });
      }
    );

    req.on('error', (err) => {
      reject(new Error(`Proxy connection failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${timeout}s`));
    });

    if (bodyStr) {
      req.write(bodyStr);
    }
    req.end();
  });
}

/**
 * Check if the proxy server is running by hitting the health endpoint.
 */
export async function checkProxyHealth(port: number, timeout: number = 3): Promise<boolean> {
  try {
    const result = await proxyRequest('GET', '/health', {}, port, timeout, false);
    return result.ok === true;
  } catch {
    return false;
  }
}

/**
 * Ensure the proxy is running. If not, auto-start it.
 * startProxy() now polls /health internally, so no separate wait loop needed.
 */
export async function ensureProxy(port: number, timeout: number, debug: boolean): Promise<void> {
  // Quick health check
  const isRunning = await checkProxyHealth(port, 3);
  if (isRunning) return;

  if (debug) {
    process.stderr.write('[brw] Proxy not running, auto-starting...\n');
  }

  // Auto-start proxy (blocks until healthy or throws with error details)
  const { startProxy } = await import('./proxy-launcher.js');
  await startProxy(port, undefined, undefined, debug);

  if (debug) {
    process.stderr.write('[brw] Proxy is ready.\n');
  }
}

/**
 * Format output for display.
 */
export function formatOutput(result: ApiResponse, text: boolean): string {
  if (!text) {
    return JSON.stringify(result);
  }

  // Simple text formatting
  if (!result.ok) {
    let msg = `Error: ${result.error}`;
    if (result.code) msg += ` [${result.code}]`;
    if (result.hint) msg += `\nHint: ${result.hint}`;
    return msg;
  }

  const parts: string[] = [];

  if (result.screenshot) {
    parts.push(`Screenshot: ${result.screenshot}`);
  }
  if (result.page) {
    const page = result.page as { url: string; title: string };
    parts.push(`Page: ${page.title} (${page.url})`);
  }

  // Include other fields
  for (const [key, value] of Object.entries(result)) {
    if (['ok', 'screenshot', 'page'].includes(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      parts.push(`${key}: ${value}`);
    } else if (typeof value === 'object') {
      parts.push(`${key}: ${JSON.stringify(value, null, 2)}`);
    } else {
      parts.push(`${key}: ${value}`);
    }
  }

  return parts.join('\n') || 'OK';
}
