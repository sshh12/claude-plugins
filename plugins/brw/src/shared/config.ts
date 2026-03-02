import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { homedir, platform } from 'os';
import type { BrwConfig, ConfigSource, ResolvedConfig, ResolvedConfigEntry } from './types.js';

const isLinux = platform() === 'linux';
const defaultScreenshotDir = isLinux
  ? join(homedir(), '.config', 'brw', 'screenshots')
  : '/tmp/brw-screenshots';
const defaultLogFile = isLinux
  ? join(homedir(), '.config', 'brw', 'brw-proxy.log')
  : '/tmp/brw-proxy.log';

const DEFAULTS: BrwConfig = {
  proxyPort: 9225,
  cdpPort: 9222,
  chromeDataDir: join(homedir(), '.config', 'brw', 'chrome-data'),
  chromePath: null,
  headless: false,
  screenshotDir: defaultScreenshotDir,
  idleTimeout: 14400,
  windowWidth: 1280,
  windowHeight: 800,
  allowedUrls: ['*'],
  blockedUrls: ['*169.254.169.254*', '*metadata.google.internal*'],
  blockedProtocols: ['file', 'javascript', 'data', 'chrome', 'chrome-extension', 'view-source', 'ftp'],
  disabledCommands: [],
  auditLog: null,
  allowedPaths: null,
  cookieScope: 'tab',
  autoScreenshot: true,
  logFile: defaultLogFile,
  chromeLaunch: true,
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
  blockedUrls?: string[];
  blockedProtocols?: string[];
  disabledCommands?: string[];
  auditLog?: string;
  allowedPaths?: string[];
  cookieScope?: string;
  autoScreenshot?: boolean;
  logFile?: string;
  chromeLaunch?: boolean;
}

/** Security-sensitive keys where repo config cannot weaken user settings. */
const securityWarnings: string[] = [];

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

function resolveStringArrayOrNull(
  envVar: string | undefined,
  repoVal: string[] | undefined,
  userVal: string[] | undefined,
  defaultVal: string[] | null
): ResolvedConfigEntry<string[] | null> {
  if (envVar !== undefined && envVar !== '') {
    return entry(envVar.split(',').map((s) => s.trim()), 'env');
  }
  if (repoVal !== undefined) return entry(repoVal, 'repo');
  if (userVal !== undefined) return entry(userVal, 'user');
  return entry(defaultVal, 'default');
}

/**
 * Resolve allowedUrls with security-aware merging.
 * Repo config cannot weaken user's restrictive allowlist.
 * If user sets a non-wildcard value, repo config is ignored.
 */
function resolveAllowedUrls(
  envVar: string | undefined,
  repoVal: string[] | undefined,
  userVal: string[] | undefined,
  defaultVal: string[]
): ResolvedConfigEntry<string[]> {
  // Env always wins
  if (envVar !== undefined && envVar !== '') {
    return entry(envVar.split(',').map((s) => s.trim()), 'env');
  }

  const userIsRestrictive = userVal !== undefined &&
    !(userVal.length === 1 && userVal[0] === '*');

  if (userIsRestrictive) {
    // User has restrictive allowlist — repo cannot override
    if (repoVal !== undefined) {
      const repoIsWildcard = repoVal.length === 1 && repoVal[0] === '*';
      if (repoIsWildcard || !arraysEqual(repoVal, userVal!)) {
        securityWarnings.push(
          `Repo allowedUrls=${JSON.stringify(repoVal)} ignored — user config restricts to ${JSON.stringify(userVal)}`
        );
      }
    }
    return entry(userVal!, 'user');
  }

  // User has wildcard or no setting — repo can narrow
  if (repoVal !== undefined) return entry(repoVal, 'repo');
  if (userVal !== undefined) return entry(userVal, 'user');
  return entry(defaultVal, 'default');
}

/**
 * Resolve blockedUrls/disabledCommands with union merge.
 * Repo can only ADD entries, never remove user's.
 */
function resolveUnionStringArray(
  envVar: string | undefined,
  repoVal: string[] | undefined,
  userVal: string[] | undefined,
  defaultVal: string[]
): ResolvedConfigEntry<string[]> {
  // Env always wins (replaces everything)
  if (envVar !== undefined && envVar !== '') {
    return entry(envVar.split(',').map((s) => s.trim()), 'env');
  }

  // Union of user + repo entries
  const userEntries = userVal || [];
  const repoEntries = repoVal || [];

  if (userEntries.length > 0 || repoEntries.length > 0) {
    const merged = [...new Set([...userEntries, ...repoEntries])];
    const source: ConfigSource = userEntries.length > 0 ? 'user' : 'repo';
    return entry(merged, source);
  }

  return entry(defaultVal, 'default');
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

export function resolveConfig(cwd?: string): ResolvedConfig {
  const workDir = cwd || process.cwd();
  securityWarnings.length = 0;

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
    allowedUrls: resolveAllowedUrls(env.BRW_ALLOWED_URLS, repoConfig?.allowedUrls, userConfig?.allowedUrls, DEFAULTS.allowedUrls),
    blockedUrls: resolveUnionStringArray(env.BRW_BLOCKED_URLS, repoConfig?.blockedUrls, userConfig?.blockedUrls, DEFAULTS.blockedUrls),
    blockedProtocols: resolveStringArray(env.BRW_BLOCKED_PROTOCOLS, repoConfig?.blockedProtocols, userConfig?.blockedProtocols, DEFAULTS.blockedProtocols),
    disabledCommands: resolveUnionStringArray(env.BRW_DISABLED_COMMANDS, repoConfig?.disabledCommands, userConfig?.disabledCommands, DEFAULTS.disabledCommands),
    auditLog: resolveStringOrNull(env.BRW_AUDIT_LOG, repoConfig?.auditLog, userConfig?.auditLog, DEFAULTS.auditLog),
    allowedPaths: resolveStringArrayOrNull(env.BRW_ALLOWED_PATHS, repoConfig?.allowedPaths, userConfig?.allowedPaths, DEFAULTS.allowedPaths),
    cookieScope: resolveString(env.BRW_COOKIE_SCOPE, repoConfig?.cookieScope, userConfig?.cookieScope, DEFAULTS.cookieScope),
    autoScreenshot: resolveBoolean(env.BRW_AUTO_SCREENSHOT, repoConfig?.autoScreenshot, userConfig?.autoScreenshot, DEFAULTS.autoScreenshot),
    logFile: resolveString(env.BRW_LOG_FILE, repoConfig?.logFile, userConfig?.logFile, DEFAULTS.logFile),
    chromeLaunch: resolveBoolean(env.BRW_CHROME_LAUNCH, repoConfig?.chromeLaunch, userConfig?.chromeLaunch, DEFAULTS.chromeLaunch),
  };
}

/**
 * Get any security warnings generated during the last resolveConfig() call.
 */
export function getSecurityWarnings(): string[] {
  return [...securityWarnings];
}

export function getConfig(cwd?: string): BrwConfig {
  const resolved = resolveConfig(cwd);
  return Object.fromEntries(
    Object.entries(resolved).map(([key, entry]) => [key, (entry as ResolvedConfigEntry<unknown>).value])
  ) as unknown as BrwConfig;
}

/**
 * Check if a URL is allowed by the allowlist AND not blocked by the blocklist.
 * Supports glob patterns: * matches everything, *.example.com matches subdomains, etc.
 */
export function checkUrlPolicy(url: string, allowedUrls: string[], blockedUrls: string[]): boolean {
  // First check allowlist
  if (!checkAllowedUrl(url, allowedUrls)) return false;

  // Then check blocklist
  if (blockedUrls.length === 0) return true;

  for (const pattern of blockedUrls) {
    if (pattern === '*') return false;
    if (globMatch(url, pattern)) return false;
  }

  return true;
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
 * Check if a file path is within the allowed path prefixes.
 * When allowedPaths is null, everything is allowed (default open behavior).
 */
export function checkAllowedPath(filePath: string, allowedPaths: string[] | null): boolean {
  if (allowedPaths === null) return true;
  if (allowedPaths.length === 0) return false;

  const resolved = resolve(filePath);
  for (const prefix of allowedPaths) {
    const resolvedPrefix = resolve(prefix);
    if (resolved === resolvedPrefix || resolved.startsWith(resolvedPrefix + '/')) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a URL's protocol is blocked.
 * Returns the protocol name if blocked, or null if allowed.
 */
export function checkProtocol(url: string, blockedProtocols: string[]): string | null {
  if (blockedProtocols.length === 0) return null;
  try {
    const colonIdx = url.indexOf(':');
    if (colonIdx === -1) return null;
    const protocol = url.substring(0, colonIdx).toLowerCase();
    if (blockedProtocols.includes(protocol)) return protocol;
  } catch {
    // best effort
  }
  return null;
}

/**
 * Simple glob matching for URL patterns.
 * Supports * as wildcard (matches any sequence of characters).
 */
export function globMatch(str: string, pattern: string): boolean {
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
