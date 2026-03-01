import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type { BrwConfig, ConfigSource, ResolvedConfig, ResolvedConfigEntry } from './types.js';

const DEFAULTS: BrwConfig = {
  proxyPort: 9225,
  cdpPort: 9222,
  chromeDataDir: join(homedir(), '.config', 'brw', 'chrome-data'),
  chromePath: null,
  headless: false,
  screenshotDir: '/tmp/brw-screenshots',
  idleTimeout: 14400,
  windowWidth: 1280,
  windowHeight: 800,
  allowedUrls: ['*'],
  autoScreenshot: true,
  logFile: '/tmp/brw-proxy.log',
};

interface ConfigFile {
  proxyPort?: number;
  cdpPort?: number;
  chromeDataDir?: string;
  chromePath?: string;
  headless?: boolean;
  screenshotDir?: string;
  idleTimeout?: number;
  windowWidth?: number;
  windowHeight?: number;
  allowedUrls?: string[];
  autoScreenshot?: boolean;
  logFile?: string;
}

function loadJsonFile(path: string): ConfigFile | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as ConfigFile;
  } catch {
    return null;
  }
}

/**
 * Walk up the directory tree from startDir looking for .claude/brw.json.
 * Stops at filesystem root or home directory.
 */
function findRepoConfigFile(startDir: string): ConfigFile | null {
  const home = homedir();
  let dir = startDir;

  while (true) {
    const config = loadJsonFile(join(dir, '.claude', 'brw.json'));
    if (config) return config;

    const parent = dirname(dir);
    if (parent === dir || dir === home) break;
    dir = parent;
  }

  return null;
}

function entry<T>(value: T, source: ConfigSource): ResolvedConfigEntry<T> {
  return { value, source };
}

function resolveString(
  envVar: string | undefined,
  repoVal: string | undefined,
  userVal: string | undefined,
  defaultVal: string
): ResolvedConfigEntry<string> {
  if (envVar !== undefined && envVar !== '') return entry(envVar, 'env');
  if (repoVal !== undefined) return entry(repoVal, 'repo');
  if (userVal !== undefined) return entry(userVal, 'user');
  return entry(defaultVal, 'default');
}

function resolveStringOrNull(
  envVar: string | undefined,
  repoVal: string | undefined,
  userVal: string | undefined,
  defaultVal: string | null
): ResolvedConfigEntry<string | null> {
  if (envVar !== undefined && envVar !== '') return entry(envVar, 'env');
  if (repoVal !== undefined) return entry(repoVal, 'repo');
  if (userVal !== undefined) return entry(userVal, 'user');
  return entry(defaultVal, 'default');
}

function resolveNumber(
  envVar: string | undefined,
  repoVal: number | undefined,
  userVal: number | undefined,
  defaultVal: number
): ResolvedConfigEntry<number> {
  if (envVar !== undefined && envVar !== '') {
    const num = parseInt(envVar, 10);
    if (!isNaN(num)) return entry(num, 'env');
  }
  if (repoVal !== undefined) return entry(repoVal, 'repo');
  if (userVal !== undefined) return entry(userVal, 'user');
  return entry(defaultVal, 'default');
}

function resolveBoolean(
  envVar: string | undefined,
  repoVal: boolean | undefined,
  userVal: boolean | undefined,
  defaultVal: boolean
): ResolvedConfigEntry<boolean> {
  if (envVar !== undefined && envVar !== '') {
    return entry(envVar === 'true' || envVar === '1', 'env');
  }
  if (repoVal !== undefined) return entry(repoVal, 'repo');
  if (userVal !== undefined) return entry(userVal, 'user');
  return entry(defaultVal, 'default');
}

function resolveStringArray(
  envVar: string | undefined,
  repoVal: string[] | undefined,
  userVal: string[] | undefined,
  defaultVal: string[]
): ResolvedConfigEntry<string[]> {
  if (envVar !== undefined && envVar !== '') {
    return entry(envVar.split(',').map((s) => s.trim()), 'env');
  }
  if (repoVal !== undefined) return entry(repoVal, 'repo');
  if (userVal !== undefined) return entry(userVal, 'user');
  return entry(defaultVal, 'default');
}

export function resolveConfig(cwd?: string): ResolvedConfig {
  const workDir = cwd || process.cwd();

  // Load config files (lower priority first)
  const userConfig = loadJsonFile(join(homedir(), '.config', 'brw', 'config.json'));
  const repoConfig = findRepoConfigFile(workDir);

  const env = process.env;

  return {
    proxyPort: resolveNumber(env.BRW_PORT, repoConfig?.proxyPort, userConfig?.proxyPort, DEFAULTS.proxyPort),
    cdpPort: resolveNumber(env.BRW_CDP_PORT, repoConfig?.cdpPort, userConfig?.cdpPort, DEFAULTS.cdpPort),
    chromeDataDir: resolveString(env.BRW_DATA_DIR, repoConfig?.chromeDataDir, userConfig?.chromeDataDir, DEFAULTS.chromeDataDir),
    chromePath: resolveStringOrNull(env.BRW_CHROME_PATH, repoConfig?.chromePath, userConfig?.chromePath, DEFAULTS.chromePath),
    headless: resolveBoolean(env.BRW_HEADLESS, repoConfig?.headless, userConfig?.headless, DEFAULTS.headless),
    screenshotDir: resolveString(env.BRW_SCREENSHOT_DIR, repoConfig?.screenshotDir, userConfig?.screenshotDir, DEFAULTS.screenshotDir),
    idleTimeout: resolveNumber(env.BRW_IDLE_TIMEOUT, repoConfig?.idleTimeout, userConfig?.idleTimeout, DEFAULTS.idleTimeout),
    windowWidth: resolveNumber(env.BRW_WIDTH, repoConfig?.windowWidth, userConfig?.windowWidth, DEFAULTS.windowWidth),
    windowHeight: resolveNumber(env.BRW_HEIGHT, repoConfig?.windowHeight, userConfig?.windowHeight, DEFAULTS.windowHeight),
    allowedUrls: resolveStringArray(env.BRW_ALLOWED_URLS, repoConfig?.allowedUrls, userConfig?.allowedUrls, DEFAULTS.allowedUrls),
    autoScreenshot: resolveBoolean(env.BRW_AUTO_SCREENSHOT, repoConfig?.autoScreenshot, userConfig?.autoScreenshot, DEFAULTS.autoScreenshot),
    logFile: resolveString(env.BRW_LOG_FILE, repoConfig?.logFile, userConfig?.logFile, DEFAULTS.logFile),
  };
}

export function getConfig(cwd?: string): BrwConfig {
  const resolved = resolveConfig(cwd);
  return Object.fromEntries(
    Object.entries(resolved).map(([key, entry]) => [key, (entry as ResolvedConfigEntry<unknown>).value])
  ) as unknown as BrwConfig;
}

/**
 * Check if a URL is allowed by the allowlist.
 * Supports glob patterns: * matches everything, *.example.com matches subdomains, etc.
 */
export function checkAllowedUrl(url: string, allowedUrls: string[]): boolean {
  // Wildcard allows everything
  if (allowedUrls.length === 1 && allowedUrls[0] === '*') return true;

  // Empty allowlist blocks everything
  if (allowedUrls.length === 0) return false;

  for (const pattern of allowedUrls) {
    if (pattern === '*') return true;
    if (globMatch(url, pattern)) return true;
  }

  return false;
}

/**
 * Simple glob matching for URL patterns.
 * Supports * as wildcard (matches any sequence of characters).
 */
function globMatch(str: string, pattern: string): boolean {
  // Escape regex special chars except *, then convert * to .*
  const regexStr =
    '^' +
    pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*') +
    '$';
  try {
    return new RegExp(regexStr).test(str);
  } catch {
    return false;
  }
}
