import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readlinkSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import { createConnection } from 'net';
import type { BrwConfig } from '../shared/types.js';

const PID_DIR = join(homedir(), '.config', 'brw');
const PID_FILE = join(PID_DIR, 'proxy.pid');

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
  ],
};

export function detectChromePath(): string | null {
  const paths = CHROME_PATHS[platform()] || CHROME_PATHS.linux;
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function getChromeVersion(chromePath: string): string | null {
  try {
    const output = execSync(`"${chromePath}" --version`, {
      timeout: 5000,
      encoding: 'utf-8',
    });
    const match = output.match(/(\d+\.\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Check if a TCP port is currently in use by attempting a connection.
 * Returns the PID of the process using it (via lsof) or true if in use but PID unknown.
 */
export function checkPortInUse(port: number): Promise<{ inUse: boolean; pid?: number }> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' }, () => {
      socket.destroy();
      // Port is in use, try to find the PID
      const pid = getPortOwnerPid(port);
      resolve({ inUse: true, pid: pid ?? undefined });
    });
    socket.on('error', () => {
      resolve({ inUse: false });
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve({ inUse: false });
    });
  });
}

/**
 * Try to find the PID of the process listening on a given port using lsof (macOS/Linux).
 */
function getPortOwnerPid(port: number): number | null {
  try {
    const cmd = platform() === 'win32'
      ? `netstat -ano | findstr :${port} | findstr LISTENING`
      : `lsof -i :${port} -t 2>/dev/null | head -1`;
    const output = execSync(cmd, { timeout: 3000, encoding: 'utf-8' }).trim();
    if (platform() === 'win32') {
      // Last column is PID in netstat output
      const parts = output.split(/\s+/);
      const pid = parseInt(parts[parts.length - 1], 10);
      return isNaN(pid) ? null : pid;
    }
    const pid = parseInt(output, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/**
 * Check for a stale SingletonLock in the Chrome data directory.
 * Chrome creates this as a symlink with target "hostname-PID".
 * If the PID is dead, delete the stale lock. If alive, throw with PID info.
 */
function checkSingletonLock(chromeDataDir: string): void {
  const lockPath = join(chromeDataDir, 'SingletonLock');
  if (!existsSync(lockPath)) return;

  try {
    const target = readlinkSync(lockPath);
    // Format: "hostname-PID"
    const dashIdx = target.lastIndexOf('-');
    if (dashIdx === -1) return;
    const pid = parseInt(target.slice(dashIdx + 1), 10);
    if (isNaN(pid)) return;

    if (isProcessRunning(pid)) {
      throw new Error(
        `Chrome data directory is locked by a running process (PID ${pid}). ` +
        `Kill it with "kill ${pid}" or use a different data dir with BRW_DATA_DIR.`
      );
    }

    // PID is dead — stale lock, remove it
    console.error(`[brw-proxy] Removing stale SingletonLock (dead PID ${pid})`);
    unlinkSync(lockPath);
  } catch (err: any) {
    // Re-throw our own errors, ignore fs errors (e.g. not a symlink)
    if (err.message?.includes('Chrome data directory is locked')) throw err;
  }
}

/**
 * Clean up an orphaned Chrome process from a previous proxy run.
 * If the CDP port is occupied and our proxy PID is dead but our Chrome PID is alive, kill Chrome.
 */
export async function cleanupOrphanedChrome(config: BrwConfig): Promise<void> {
  const pidData = readPidFile();
  if (!pidData || !pidData.chromePid) return;

  // If proxy is still alive, no orphan
  if (isProcessRunning(pidData.pid)) return;

  // Proxy is dead — check if Chrome is still alive
  if (isProcessRunning(pidData.chromePid)) {
    const portCheck = await checkPortInUse(config.cdpPort);
    if (portCheck.inUse) {
      console.error(`[brw-proxy] Killing orphaned Chrome (PID ${pidData.chromePid}) from dead proxy (PID ${pidData.pid})`);
      try {
        process.kill(pidData.chromePid, 'SIGTERM');
        // Give it a moment, then force kill
        await new Promise((r) => setTimeout(r, 1000));
        if (isProcessRunning(pidData.chromePid)) {
          process.kill(pidData.chromePid, 'SIGKILL');
        }
      } catch {
        // ignore — process may have already exited
      }
    }
  }

  // Clean up stale PID file
  removePidFile();
}

export async function launchChrome(config: BrwConfig): Promise<ChildProcess> {
  const chromePath = config.chromePath || detectChromePath();
  if (!chromePath) {
    throw new Error(
      'Chrome/Chromium not found. Set BRW_CHROME_PATH or install Chrome.'
    );
  }

  if (!existsSync(chromePath)) {
    throw new Error(`Chrome binary not found at: ${chromePath}`);
  }

  // Clean up orphaned Chrome from a previous proxy crash
  await cleanupOrphanedChrome(config);

  // Check if CDP port is already in use
  const portCheck = await checkPortInUse(config.cdpPort);
  if (portCheck.inUse) {
    // Check if it's a Chrome process we previously launched
    if (isOurChrome(config.cdpPort)) {
      // Our Chrome is already running, that's fine
      console.error(`[brw-proxy] CDP port ${config.cdpPort} is in use by our previous Chrome instance`);
    } else {
      const pidInfo = portCheck.pid ? ` (PID ${portCheck.pid})` : '';
      throw new Error(
        `Port ${config.cdpPort} is in use by another process${pidInfo}. Use BRW_CDP_PORT to specify a different port.`
      );
    }
  }

  mkdirSync(config.chromeDataDir, { recursive: true });

  // Check for stale SingletonLock
  checkSingletonLock(config.chromeDataDir);

  const args = [
    `--remote-debugging-port=${config.cdpPort}`,
    `--user-data-dir=${config.chromeDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    `--window-size=${config.windowWidth},${config.windowHeight}`,
  ];

  if (config.headless) {
    args.push('--headless=new');
  }

  const child = spawn(chromePath, args, {
    stdio: 'ignore',
    detached: false,
  });

  return child;
}

export function writePidFile(pid: number, port: number, chromePid?: number): void {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify({ pid, port, chromePid, startedAt: Date.now() }));
}

export function readPidFile(): { pid: number; port: number; chromePid?: number; startedAt: number } | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const data = JSON.parse(readFileSync(PID_FILE, 'utf-8'));
    return data;
  } catch {
    return null;
  }
}

export function removePidFile(): void {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a port is being used by a Chrome instance we launched
 * (vs the user's personal browser). We verify by checking our PID file.
 */
export function isOurChrome(port: number): boolean {
  const pidData = readPidFile();
  if (!pidData) return false;
  if (pidData.port !== port) return false;
  return isProcessRunning(pidData.pid);
}
