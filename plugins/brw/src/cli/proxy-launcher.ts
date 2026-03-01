import { spawn } from 'child_process';
import { openSync, closeSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { homedir, platform } from 'os';
import http from 'http';
import { readPidFile, isProcessRunning } from '../proxy/chrome.js';
import type { ApiResponse } from '../shared/types.js';

/**
 * Poll the proxy health endpoint until it responds or timeout.
 */
function pollHealth(port: number, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      const req = http.get(`http://127.0.0.1:${port}/health`, { timeout: 1000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) { resolve(true); return; }
          } catch { /* not ready */ }
          setTimeout(check, intervalMs);
        });
      });
      req.on('error', () => setTimeout(check, intervalMs));
      req.on('timeout', () => { req.destroy(); setTimeout(check, intervalMs); });
    };
    check();
  });
}

/**
 * Start the proxy server as a detached background process.
 * Polls /health to confirm the server is ready before returning.
 */
export async function startProxy(
  port: number,
  chromeDataDir?: string,
  headless?: boolean,
  debug?: boolean
): Promise<ApiResponse> {
  // Check if already running
  const pidData = readPidFile();
  if (pidData && isProcessRunning(pidData.pid)) {
    return { ok: true, pid: pidData.pid, port: pidData.port } as ApiResponse;
  }

  // Resolve path to proxy.js script
  // When bundled by esbuild (CJS), __filename points to brw.js, and proxy.js is in the same dir.
  const scriptDir = dirname(__filename);
  const proxyScript = join(scriptDir, 'proxy.js');

  // Build env vars for child process
  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  env.BRW_PORT = String(port);
  if (chromeDataDir) env.BRW_DATA_DIR = chromeDataDir;
  if (headless) env.BRW_HEADLESS = 'true';

  if (debug) {
    process.stderr.write(`[brw] Starting proxy: node ${proxyScript}\n`);
    process.stderr.write(`[brw] Port: ${port}\n`);
  }

  // Redirect stderr to a file instead of piping — piping causes SIGPIPE
  // death when the parent exits and the child writes to the broken pipe.
  // Use the proxy log file so error output isn't lost.
  const isLinux = platform() === 'linux';
  const stderrLog = isLinux
    ? join(homedir(), '.config', 'brw', 'brw-proxy-stderr.log')
    : '/tmp/brw-proxy-stderr.log';
  const stderrFd = openSync(stderrLog, 'w');

  const child = spawn('node', [proxyScript], {
    env,
    stdio: ['ignore', 'ignore', debug ? 'inherit' : stderrFd],
    detached: true,
  });

  const pid = child.pid;
  if (!pid) {
    closeSync(stderrFd);
    throw new Error('Failed to spawn proxy process');
  }

  if (debug) {
    process.stderr.write(`[brw] Proxy spawned with PID ${pid}\n`);
  }

  // Watch for early exit
  let exited = false;
  let exitCode: number | null = null;
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  // Poll /health every 200ms for up to 10s
  const healthy = await pollHealth(port, 10000, 200);

  // Close the fd in the parent (child has its own copy)
  try { closeSync(stderrFd); } catch { /* ignore */ }

  if (healthy) {
    child.unref();
    return { ok: true, pid, port } as ApiResponse;
  }

  // Server failed to start
  if (exited) {
    let detail = '';
    try { detail = readFileSync(stderrLog, 'utf-8').trim(); } catch { /* ignore */ }
    throw new Error(
      `Proxy exited with code ${exitCode} during startup` +
      (detail ? `:\n${detail}` : '')
    );
  }

  // Still running but not healthy — kill it
  try { process.kill(pid, 'SIGTERM'); } catch { /* ignore */ }
  let detail = '';
  try { detail = readFileSync(stderrLog, 'utf-8').trim(); } catch { /* ignore */ }
  throw new Error(
    `Proxy failed to become healthy within 10s` +
    (detail ? `:\n${detail}` : '')
  );
}
