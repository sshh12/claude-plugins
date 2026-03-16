import http from "http";
import { ErrorCode, type ApiResponse } from "../shared/types.js";

const DEFAULT_PORT = 9226;

/**
 * Send a request to the proxy server.
 */
export async function proxyRequest(options: {
  port?: number;
  path: string;
  method?: string;
  body?: Record<string, unknown>;
  timeout?: number;
  debug?: boolean;
}): Promise<ApiResponse> {
  const {
    port = DEFAULT_PORT,
    path,
    method = "GET",
    body = {},
    timeout = 30,
    debug = false,
  } = options;

  const bodyStr = method !== "GET" ? JSON.stringify(body) : "";
  const url = `http://localhost:${port}${path}`;

  if (debug) {
    process.stderr.write(`[whatsup] ${method} ${url}\n`);
    if (bodyStr) {
      process.stderr.write(`[whatsup] body: ${bodyStr}\n`);
    }
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers:
          method !== "GET" ? { "Content-Type": "application/json" } : {},
        timeout: timeout * 1000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (debug) {
            process.stderr.write(
              `[whatsup] response ${res.statusCode}: ${data.slice(0, 200)}\n`
            );
          }
          try {
            const parsed = JSON.parse(data);
            resolve(parsed as ApiResponse);
          } catch {
            resolve({
              ok: false,
              error: `Invalid JSON response: ${data.slice(0, 200)}`,
              code: ErrorCode.PROXY_NOT_RUNNING,
            });
          }
        });
      }
    );

    req.on("error", (err) => {
      if (
        (err as NodeJS.ErrnoException).code === "ECONNREFUSED" ||
        err.message.includes("ECONNREFUSED")
      ) {
        resolve({
          ok: false,
          error: "Proxy not running",
          code: ErrorCode.PROXY_NOT_RUNNING,
          hint: "Run 'whatsup server start'",
        });
        return;
      }
      reject(new Error(`Proxy connection failed: ${err.message}`));
    });

    req.on("timeout", () => {
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
export async function checkProxyHealth(
  port: number = DEFAULT_PORT,
  timeout: number = 2
): Promise<boolean> {
  try {
    const result = await proxyRequest({
      port,
      path: "/health",
      method: "GET",
      timeout,
      debug: false,
    });
    return (
      result.ok === true ||
      (typeof result === "object" && result !== null && "pid" in result)
    );
  } catch {
    return false;
  }
}

/**
 * Ensure the proxy is running. If not, auto-start it.
 * startProxy() polls /health internally, so no separate wait loop is needed.
 */
export async function ensureProxy(options: {
  port?: number;
  debug?: boolean;
}): Promise<boolean> {
  const { port = DEFAULT_PORT, debug = false } = options;

  // Quick health check
  const isRunning = await checkProxyHealth(port, 2);
  if (isRunning) return true;

  if (debug) {
    process.stderr.write("[whatsup] Proxy not running, auto-starting...\n");
  }

  // Auto-start proxy (blocks until healthy or throws with error details)
  const { startProxy } = await import("./proxy-launcher.js");
  const result = await startProxy({ port, debug });

  if (!result.ok) {
    if (debug) {
      process.stderr.write(
        `[whatsup] Failed to start proxy: ${result.error}\n`
      );
    }
    return false;
  }

  if (debug) {
    process.stderr.write("[whatsup] Proxy is ready.\n");
  }
  return true;
}

/**
 * Format an ApiResponse for CLI output.
 *
 * - plain mode: human-readable text
 * - default: JSON with 2-space indent
 */
export function formatOutput(response: ApiResponse, plain: boolean): string {
  if (!plain) {
    return JSON.stringify(response, null, 2);
  }

  // Error formatting
  if (!response.ok) {
    let msg = `Error: ${response.error}`;
    if (response.code) msg += ` [${response.code}]`;
    if (response.hint) msg += `\nHint: ${response.hint}`;
    return msg;
  }

  const parts: string[] = [];

  // Format messages array specially for WhatsApp context
  if (Array.isArray(response.messages)) {
    for (const message of response.messages) {
      const m = message as Record<string, unknown>;
      const timestamp = m.timestamp
        ? `[${m.timestamp}]`
        : "";
      const sender = m.sender || m.from || "unknown";
      const text = m.text || m.body || "";
      parts.push(`${timestamp} ${sender}: ${text}`.trim());
    }
    if (parts.length > 0) return parts.join("\n");
  }

  // Format contacts array
  if (Array.isArray(response.contacts)) {
    for (const contact of response.contacts) {
      const c = contact as Record<string, unknown>;
      const name = c.name || c.pushname || "unknown";
      const id = c.id || "";
      parts.push(`${name}${id ? ` (${id})` : ""}`);
    }
    if (parts.length > 0) return parts.join("\n");
  }

  // Include other fields generically
  for (const [key, value] of Object.entries(response)) {
    if (["ok", "messages", "contacts"].includes(key)) continue;
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      parts.push(`${key}: ${value}`);
    } else if (typeof value === "object") {
      parts.push(`${key}: ${JSON.stringify(value, null, 2)}`);
    } else {
      parts.push(`${key}: ${value}`);
    }
  }

  return parts.join("\n") || "OK";
}
