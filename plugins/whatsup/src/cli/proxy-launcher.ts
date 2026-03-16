import { spawn } from "child_process";
import { openSync, closeSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { platform, homedir } from "os";
import http from "http";
import { checkProxyHealth } from "./http.js";

const DEFAULT_PORT = 9226;
const STDERR_LOG = "/tmp/whatsup-proxy-stderr.log";
const HEALTH_POLL_INTERVAL_MS = 200;
const HEALTH_POLL_TIMEOUT_MS = 15_000;

interface StartResult {
  ok: boolean;
  pid?: number;
  port?: number;
  error?: string;
  hint?: string;
}

/**
 * Poll the proxy health endpoint until it responds or timeout.
 */
function pollHealth(
  port: number,
  timeoutMs: number,
  intervalMs: number
): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      const req = http.get(
        `http://127.0.0.1:${port}/health`,
        { timeout: 1000 },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.ok) {
                resolve(true);
                return;
              }
            } catch {
              /* not ready */
            }
            setTimeout(check, intervalMs);
          });
        }
      );
      req.on("error", () => setTimeout(check, intervalMs));
      req.on("timeout", () => {
        req.destroy();
        setTimeout(check, intervalMs);
      });
    };
    check();
  });
}

/**
 * Resolve the path to the stderr log file.
 * On Linux, use ~/.config/whatsup/; elsewhere use /tmp/.
 */
function getStderrLogPath(): string {
  const isLinux = platform() === "linux";
  if (isLinux) {
    return join(homedir(), ".config", "whatsup", "whatsup-proxy-stderr.log");
  }
  return STDERR_LOG;
}

/**
 * Start the proxy server as a detached background process.
 * Polls /health to confirm the server is ready before returning.
 */
export async function startProxy(options: {
  port?: number;
  debug?: boolean;
}): Promise<StartResult> {
  const { port = DEFAULT_PORT, debug = false } = options;

  // Check if already running
  const alreadyRunning = await checkProxyHealth(port, 2);
  if (alreadyRunning) {
    return { ok: true, port };
  }

  // Resolve path to proxy.js script.
  // When bundled by esbuild (CJS), __filename points to whatsup.js, and proxy.js
  // is in the same directory. During dev, resolve from source paths.
  const scriptDir = dirname(__filename);
  const proxyScript = join(scriptDir, "proxy.js");

  // Build env vars for child process
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
  };
  env.WHATSUP_PORT = String(port);
  if (debug) env.NODE_ENV = "development";

  if (debug) {
    process.stderr.write(`[whatsup] Starting proxy: node ${proxyScript}\n`);
    process.stderr.write(`[whatsup] Port: ${port}\n`);
  }

  // Redirect stderr to a file instead of piping — piping causes SIGPIPE
  // death when the parent exits and the child writes to the broken pipe.
  const stderrLog = getStderrLogPath();
  const stderrFd = openSync(stderrLog, "w");

  const child = spawn("node", [proxyScript], {
    env,
    stdio: ["ignore", "ignore", debug ? "inherit" : stderrFd],
    detached: true,
  });

  const pid = child.pid;
  if (!pid) {
    closeSync(stderrFd);
    return {
      ok: false,
      error: "Failed to spawn proxy process",
      hint: "Check that Node.js is available on PATH",
    };
  }

  if (debug) {
    process.stderr.write(`[whatsup] Proxy spawned with PID ${pid}\n`);
  }

  // Watch for early exit — if the process dies during startup, capture diagnostics.
  let exited = false;
  let exitCode: number | null = null;
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  // Poll /health every 200ms for up to 15s
  const healthy = await pollHealth(port, HEALTH_POLL_TIMEOUT_MS, HEALTH_POLL_INTERVAL_MS);

  // Close the fd in the parent (child has its own copy)
  try {
    closeSync(stderrFd);
  } catch {
    /* ignore */
  }

  if (healthy) {
    // Detach fully so the parent can exit without killing the child
    child.unref();
    if (debug) {
      process.stderr.write(`[whatsup] Proxy healthy, PID ${pid}\n`);
    }
    return { ok: true, pid, port };
  }

  // Server failed to start
  if (exited) {
    let detail = "";
    try {
      detail = readFileSync(stderrLog, "utf-8").trim();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error:
        `Proxy exited with code ${exitCode} during startup` +
        (detail ? `:\n${detail}` : ""),
      hint: "Check proxy logs for details. Try running 'whatsup server start --debug' for more info.",
    };
  }

  // Still running but not healthy — kill it
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* ignore */
  }
  let detail = "";
  try {
    detail = readFileSync(stderrLog, "utf-8").trim();
  } catch {
    /* ignore */
  }
  return {
    ok: false,
    error:
      `Proxy failed to become healthy within ${HEALTH_POLL_TIMEOUT_MS / 1000}s` +
      (detail ? `:\n${detail}` : ""),
    hint: "The proxy process started but did not respond. Check logs at " + stderrLog,
  };
}

/**
 * Stop the proxy gracefully by posting to /shutdown.
 * Falls back to killing the process if the endpoint is unavailable.
 */
export async function stopProxy(
  port: number = DEFAULT_PORT
): Promise<{ ok: boolean; error?: string }> {
  // Try graceful shutdown via the endpoint
  try {
    const result = await new Promise<{ ok: boolean; error?: string }>(
      (resolve) => {
        const body = JSON.stringify({});
        const req = http.request(
          `http://127.0.0.1:${port}/shutdown`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            timeout: 5000,
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              try {
                const parsed = JSON.parse(data);
                resolve({ ok: parsed.ok === true });
              } catch {
                resolve({ ok: true }); // Assume shutdown if endpoint responded
              }
            });
          }
        );
        req.on("error", () => {
          resolve({ ok: false, error: "Could not reach proxy" });
        });
        req.on("timeout", () => {
          req.destroy();
          resolve({ ok: false, error: "Shutdown request timed out" });
        });
        req.write(body);
        req.end();
      }
    );

    if (result.ok) {
      // Wait for process to fully exit (poll health until it fails)
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const stillRunning = await checkProxyHealth(port, 1);
        if (!stillRunning) return { ok: true };
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: true }; // Assume it will exit
    }

    return result;
  } catch {
    return { ok: false, error: "Failed to stop proxy" };
  }
}

/**
 * Get the current status of the proxy.
 */
export async function getProxyStatus(
  port: number = DEFAULT_PORT
): Promise<{
  running: boolean;
  port: number;
  details?: Record<string, unknown>;
}> {
  try {
    const result = await new Promise<Record<string, unknown> | null>(
      (resolve) => {
        const req = http.get(
          `http://127.0.0.1:${port}/health`,
          { timeout: 2000 },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              try {
                resolve(JSON.parse(data));
              } catch {
                resolve(null);
              }
            });
          }
        );
        req.on("error", () => resolve(null));
        req.on("timeout", () => {
          req.destroy();
          resolve(null);
        });
      }
    );

    if (result && (result.ok === true || "pid" in result)) {
      return { running: true, port, details: result };
    }
    return { running: false, port };
  } catch {
    return { running: false, port };
  }
}
