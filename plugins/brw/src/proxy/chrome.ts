import { spawn, execSync, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
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

export function writePidFile(pid: number, port: number): void {
  mkdirSync(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify({ pid, port, startedAt: Date.now() }));
}

export function readPidFile(): { pid: number; port: number; startedAt: number } | null {
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
