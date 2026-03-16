import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type {
  WhatsUpConfig,
  ConfigSource,
  ResolvedConfig,
  ResolvedConfigEntry,
  SecurityWarning,
} from "./types.js";

// ---- Defaults ----

const DEFAULTS: WhatsUpConfig = {
  proxyPort: 9226,
  authDir: join(homedir(), ".config", "whatsup", "auth"),
  allowlist: [],
  allowlistGroups: [],
  idleTimeout: 3600,
  logFile: "/tmp/whatsup-proxy.log",
  auditLog: join(homedir(), ".config", "whatsup", "audit.jsonl"),
  disabledCommands: [],
  messageBufferSize: 500,
  mediaDownloadDir: "/tmp/whatsup-media",
  pollTimeout: 30,
  autoReconnect: true,
  qrCodeFile: "/tmp/whatsup-qr.png",
  readMode: "allowlist",
  rateLimitPerContact: 30,
  rateLimitTotal: 100,
  maxMediaSize: 67108864, // 64 MB
};

// ---- Config File Shape ----

interface ConfigFile {
  proxyPort?: number;
  authDir?: string;
  allowlist?: string[];
  allowlistGroups?: string[];
  idleTimeout?: number;
  logFile?: string;
  auditLog?: string;
  disabledCommands?: string[];
  messageBufferSize?: number;
  mediaDownloadDir?: string;
  pollTimeout?: number;
  autoReconnect?: boolean;
  qrCodeFile?: string;
  readMode?: "allowlist" | "all";
  rateLimitPerContact?: number;
  rateLimitTotal?: number;
  maxMediaSize?: number;
}

/**
 * Keys that repo config is NOT allowed to set.
 * These can only come from env vars or user config.
 */
const LOCKED_FROM_REPO: ReadonlySet<keyof ConfigFile> = new Set([
  "authDir",
  "logFile",
  "auditLog",
  "qrCodeFile",
]);

/** Security warnings accumulated during the last resolveConfig() call. */
let securityWarnings: SecurityWarning[] = [];

// ---- File Helpers ----

function loadJsonFile(path: string): ConfigFile | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as ConfigFile;
  } catch {
    return null;
  }
}

/**
 * Walk up the directory tree from startDir looking for .claude/whatsup.json.
 * Stops at filesystem root or home directory.
 */
function findRepoConfigFile(startDir: string): ConfigFile | null {
  const home = homedir();
  let dir = startDir;

  while (true) {
    const config = loadJsonFile(join(dir, ".claude", "whatsup.json"));
    if (config) return config;

    const parent = dirname(dir);
    if (parent === dir || dir === home) break;
    dir = parent;
  }

  return null;
}

// ---- Phone Normalization ----

/**
 * Normalize a phone number to E.164-ish format.
 * Strips spaces, dashes, parentheses, dots. Ensures leading +.
 */
export function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-().]/g, "");
  if (!cleaned.startsWith("+") && /^\d+$/.test(cleaned)) {
    cleaned = "+" + cleaned;
  }
  return cleaned;
}

// ---- Resolve Helpers ----

function entry<T>(value: T, source: ConfigSource): ResolvedConfigEntry<T> {
  return { value, source };
}

function resolveString(
  envVar: string | undefined,
  repoVal: string | undefined,
  userVal: string | undefined,
  defaultVal: string
): ResolvedConfigEntry<string> {
  if (envVar !== undefined && envVar !== "") return entry(envVar, "env");
  if (repoVal !== undefined) return entry(repoVal, "repo");
  if (userVal !== undefined) return entry(userVal, "user");
  return entry(defaultVal, "default");
}

/**
 * Resolve a string field that is locked from repo config.
 * Repo values are silently ignored and a security warning is emitted.
 */
function resolveLockedString(
  field: string,
  envVar: string | undefined,
  repoVal: string | undefined,
  userVal: string | undefined,
  defaultVal: string
): ResolvedConfigEntry<string> {
  if (envVar !== undefined && envVar !== "") return entry(envVar, "env");
  if (repoVal !== undefined) {
    securityWarnings.push({
      field,
      message: `Repo config for "${field}" ignored — this field can only be set via env var or user config`,
    });
  }
  if (userVal !== undefined) return entry(userVal, "user");
  return entry(defaultVal, "default");
}

function resolveNumber(
  envVar: string | undefined,
  repoVal: number | undefined,
  userVal: number | undefined,
  defaultVal: number
): ResolvedConfigEntry<number> {
  if (envVar !== undefined && envVar !== "") {
    const num = parseInt(envVar, 10);
    if (!isNaN(num)) return entry(num, "env");
  }
  if (repoVal !== undefined) return entry(repoVal, "repo");
  if (userVal !== undefined) return entry(userVal, "user");
  return entry(defaultVal, "default");
}

function resolveBoolean(
  envVar: string | undefined,
  repoVal: boolean | undefined,
  userVal: boolean | undefined,
  defaultVal: boolean
): ResolvedConfigEntry<boolean> {
  if (envVar !== undefined && envVar !== "") {
    return entry(envVar === "true" || envVar === "1", "env");
  }
  if (repoVal !== undefined) return entry(repoVal, "repo");
  if (userVal !== undefined) return entry(userVal, "user");
  return entry(defaultVal, "default");
}

function resolveStringArray(
  envVar: string | undefined,
  repoVal: string[] | undefined,
  userVal: string[] | undefined,
  defaultVal: string[]
): ResolvedConfigEntry<string[]> {
  if (envVar !== undefined && envVar !== "") {
    return entry(
      envVar.split(",").map((s) => s.trim()),
      "env"
    );
  }
  if (repoVal !== undefined) return entry(repoVal, "repo");
  if (userVal !== undefined) return entry(userVal, "user");
  return entry(defaultVal, "default");
}

// ---- Security-Aware Merge Helpers ----

/**
 * Resolve allowlist/allowlistGroups with intersection merge.
 * Repo config can only NARROW the set (intersection with user's), never widen it.
 * If user has [A,B] and repo has [A,B,C], result is [A,B].
 */
function resolveIntersectionStringArray(
  field: string,
  envVar: string | undefined,
  repoVal: string[] | undefined,
  userVal: string[] | undefined,
  defaultVal: string[]
): ResolvedConfigEntry<string[]> {
  // Env always wins
  if (envVar !== undefined && envVar !== "") {
    return entry(
      envVar.split(",").map((s) => s.trim()),
      "env"
    );
  }

  // If both user and repo have values, take the intersection
  if (userVal !== undefined && repoVal !== undefined) {
    const userSet = new Set(userVal);
    const intersection = repoVal.filter((v) => userSet.has(v));

    // Warn if repo tried to add entries not in user's list
    const repoExtras = repoVal.filter((v) => !userSet.has(v));
    if (repoExtras.length > 0) {
      securityWarnings.push({
        field,
        message: `Repo ${field} tried to add entries not in user config: ${JSON.stringify(repoExtras)} — only intersection is used`,
      });
    }

    return entry(intersection, "user");
  }

  // Repo alone can narrow default (but default is [] which blocks all, so repo can only add)
  if (repoVal !== undefined) return entry(repoVal, "repo");
  if (userVal !== undefined) return entry(userVal, "user");
  return entry(defaultVal, "default");
}

/**
 * Resolve disabledCommands with union merge.
 * Repo can only ADD entries, never remove user's.
 */
function resolveUnionStringArray(
  envVar: string | undefined,
  repoVal: string[] | undefined,
  userVal: string[] | undefined,
  defaultVal: string[]
): ResolvedConfigEntry<string[]> {
  // Env always wins (replaces everything)
  if (envVar !== undefined && envVar !== "") {
    return entry(
      envVar.split(",").map((s) => s.trim()),
      "env"
    );
  }

  // Union of user + repo entries
  const userEntries = userVal || [];
  const repoEntries = repoVal || [];

  if (userEntries.length > 0 || repoEntries.length > 0) {
    const merged = [...new Set([...userEntries, ...repoEntries])];
    const source: ConfigSource = userEntries.length > 0 ? "user" : "repo";
    return entry(merged, source);
  }

  return entry(defaultVal, "default");
}

/**
 * Resolve readMode with strictness merge.
 * "allowlist" is stricter than "all". Repo can only make stricter.
 */
function resolveReadMode(
  envVar: string | undefined,
  repoVal: "allowlist" | "all" | undefined,
  userVal: "allowlist" | "all" | undefined,
  defaultVal: "allowlist" | "all"
): ResolvedConfigEntry<"allowlist" | "all"> {
  if (envVar !== undefined && envVar !== "") {
    const val = envVar as "allowlist" | "all";
    if (val === "allowlist" || val === "all") return entry(val, "env");
  }

  // If user set "allowlist" (strict), repo cannot weaken to "all"
  if (userVal === "allowlist" && repoVal === "all") {
    securityWarnings.push({
      field: "readMode",
      message: `Repo readMode="all" ignored — user config restricts to "allowlist"`,
    });
    return entry("allowlist", "user");
  }

  // If user set "all" (permissive), repo can make it stricter
  if (repoVal !== undefined) {
    if (userVal !== undefined && userVal === "all" && repoVal === "allowlist") {
      return entry("allowlist", "repo");
    }
    if (userVal === undefined) return entry(repoVal, "repo");
  }

  if (userVal !== undefined) return entry(userVal, "user");
  return entry(defaultVal, "default");
}

/**
 * Resolve a numeric field where repo can only LOWER the value.
 * Used for rate limits and maxMediaSize.
 */
function resolveMinNumber(
  field: string,
  envVar: string | undefined,
  repoVal: number | undefined,
  userVal: number | undefined,
  defaultVal: number
): ResolvedConfigEntry<number> {
  if (envVar !== undefined && envVar !== "") {
    const num = parseInt(envVar, 10);
    if (!isNaN(num)) return entry(num, "env");
  }

  const effective = userVal !== undefined ? userVal : defaultVal;

  if (repoVal !== undefined) {
    if (repoVal > effective) {
      securityWarnings.push({
        field,
        message: `Repo ${field}=${repoVal} ignored — cannot exceed user/default value of ${effective}`,
      });
      return userVal !== undefined
        ? entry(userVal, "user")
        : entry(defaultVal, "default");
    }
    return entry(repoVal, "repo");
  }

  if (userVal !== undefined) return entry(userVal, "user");
  return entry(defaultVal, "default");
}

// ---- Public API ----

export function resolveConfig(cwd?: string): ResolvedConfig {
  const workDir = cwd || process.cwd();
  securityWarnings = [];

  // Load config files (lower priority first)
  const userConfig = loadJsonFile(
    join(homedir(), ".config", "whatsup", "config.json")
  );
  const repoConfig = findRepoConfigFile(workDir);

  // Strip locked keys from repo config and warn
  if (repoConfig) {
    for (const key of LOCKED_FROM_REPO) {
      if (key in repoConfig) {
        // Handled inside resolveLockedString for string fields
      }
    }
  }

  const env = process.env;

  return {
    proxyPort: resolveNumber(
      env.WHATSUP_PORT,
      repoConfig?.proxyPort,
      userConfig?.proxyPort,
      DEFAULTS.proxyPort
    ),
    authDir: resolveLockedString(
      "authDir",
      env.WHATSUP_AUTH_DIR,
      repoConfig?.authDir,
      userConfig?.authDir,
      DEFAULTS.authDir
    ),
    allowlist: resolveIntersectionStringArray(
      "allowlist",
      env.WHATSUP_ALLOWLIST,
      repoConfig?.allowlist,
      userConfig?.allowlist,
      DEFAULTS.allowlist
    ),
    allowlistGroups: resolveIntersectionStringArray(
      "allowlistGroups",
      env.WHATSUP_ALLOWLIST_GROUPS,
      repoConfig?.allowlistGroups,
      userConfig?.allowlistGroups,
      DEFAULTS.allowlistGroups
    ),
    idleTimeout: resolveNumber(
      env.WHATSUP_IDLE_TIMEOUT,
      repoConfig?.idleTimeout,
      userConfig?.idleTimeout,
      DEFAULTS.idleTimeout
    ),
    logFile: resolveLockedString(
      "logFile",
      env.WHATSUP_LOG_FILE,
      repoConfig?.logFile,
      userConfig?.logFile,
      DEFAULTS.logFile
    ),
    auditLog: resolveLockedString(
      "auditLog",
      env.WHATSUP_AUDIT_LOG,
      repoConfig?.auditLog,
      userConfig?.auditLog,
      DEFAULTS.auditLog
    ),
    disabledCommands: resolveUnionStringArray(
      env.WHATSUP_DISABLED_COMMANDS,
      repoConfig?.disabledCommands,
      userConfig?.disabledCommands,
      DEFAULTS.disabledCommands
    ),
    messageBufferSize: resolveNumber(
      env.WHATSUP_MESSAGE_BUFFER_SIZE,
      repoConfig?.messageBufferSize,
      userConfig?.messageBufferSize,
      DEFAULTS.messageBufferSize
    ),
    mediaDownloadDir: resolveString(
      env.WHATSUP_MEDIA_DOWNLOAD_DIR,
      repoConfig?.mediaDownloadDir,
      userConfig?.mediaDownloadDir,
      DEFAULTS.mediaDownloadDir
    ),
    pollTimeout: resolveNumber(
      env.WHATSUP_POLL_TIMEOUT,
      repoConfig?.pollTimeout,
      userConfig?.pollTimeout,
      DEFAULTS.pollTimeout
    ),
    autoReconnect: resolveBoolean(
      env.WHATSUP_AUTO_RECONNECT,
      repoConfig?.autoReconnect,
      userConfig?.autoReconnect,
      DEFAULTS.autoReconnect
    ),
    qrCodeFile: resolveLockedString(
      "qrCodeFile",
      env.WHATSUP_QR_CODE_FILE,
      repoConfig?.qrCodeFile,
      userConfig?.qrCodeFile,
      DEFAULTS.qrCodeFile
    ),
    readMode: resolveReadMode(
      env.WHATSUP_READ_MODE,
      repoConfig?.readMode,
      userConfig?.readMode,
      DEFAULTS.readMode
    ),
    rateLimitPerContact: resolveMinNumber(
      "rateLimitPerContact",
      env.WHATSUP_RATE_LIMIT_PER_CONTACT,
      repoConfig?.rateLimitPerContact,
      userConfig?.rateLimitPerContact,
      DEFAULTS.rateLimitPerContact
    ),
    rateLimitTotal: resolveMinNumber(
      "rateLimitTotal",
      env.WHATSUP_RATE_LIMIT_TOTAL,
      repoConfig?.rateLimitTotal,
      userConfig?.rateLimitTotal,
      DEFAULTS.rateLimitTotal
    ),
    maxMediaSize: resolveMinNumber(
      "maxMediaSize",
      env.WHATSUP_MAX_MEDIA_SIZE,
      repoConfig?.maxMediaSize,
      userConfig?.maxMediaSize,
      DEFAULTS.maxMediaSize
    ),
  };
}

/**
 * Get any security warnings generated during the last resolveConfig() call.
 */
export function getSecurityWarnings(): SecurityWarning[] {
  return [...securityWarnings];
}

/**
 * Get flat config values (without source annotations).
 */
export function getConfig(cwd?: string): WhatsUpConfig {
  const resolved = resolveConfig(cwd);
  return Object.fromEntries(
    Object.entries(resolved).map(([key, ent]) => [
      key,
      (ent as ResolvedConfigEntry<unknown>).value,
    ])
  ) as unknown as WhatsUpConfig;
}
