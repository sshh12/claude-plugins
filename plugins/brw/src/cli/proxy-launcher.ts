import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { readPidFile, isProcessRunning } from '../proxy/chrome.js';
import type { ApiResponse } from '../shared/types.js';

/**
 * Start the proxy server as a detached background process.
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

  // Spawn proxy as a detached process
  const child = spawn('node', [proxyScript], {
    env,
    stdio: 'ignore',
    detached: true,
  });

  child.unref();

  const pid = child.pid;
  if (!pid) {
    throw new Error('Failed to spawn proxy process');
  }

  if (debug) {
    process.stderr.write(`[brw] Proxy spawned with PID ${pid}\n`);
  }

  return { ok: true, pid, port } as ApiResponse;
}
