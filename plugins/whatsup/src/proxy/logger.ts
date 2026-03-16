import { appendFileSync, readFileSync, writeFileSync, existsSync, openSync, closeSync } from 'fs';

export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

const MAX_LINES_ON_INIT = 500;

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return '';
  return ' ' + JSON.stringify(meta);
}

export function truncateLogFile(logFile: string, maxLines: number = MAX_LINES_ON_INIT): void {
  try {
    if (!existsSync(logFile)) return;
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      const truncated = lines.slice(lines.length - maxLines).join('\n');
      writeFileSync(logFile, truncated);
    }
  } catch {
    // Best effort
  }
}

export function createLogger(logFile: string, level: string = 'info'): Logger {
  truncateLogFile(logFile);

  const levels: Record<string, number> = { error: 0, warn: 1, info: 2 };
  const minLevel = levels[level.toLowerCase()] ?? 2;

  function log(lvl: string, message: string, meta?: Record<string, unknown>): void {
    const lvlNum = levels[lvl.toLowerCase()] ?? 2;
    if (lvlNum > minLevel) return;

    const timestamp = new Date().toISOString();
    const entry = {
      timestamp,
      level: lvl,
      message,
      ...meta,
    };
    const line = JSON.stringify(entry) + '\n';
    process.stderr.write(`[${timestamp}] [${lvl}] ${message}${formatMeta(meta)}\n`);
    try {
      appendFileSync(logFile, line);
    } catch {
      // Best effort -- log file may not be writable
    }
  }

  return {
    info: (message, meta) => log('INFO', message, meta),
    warn: (message, meta) => log('WARN', message, meta),
    error: (message, meta) => log('ERROR', message, meta),
  };
}

let globalLogger: Logger | null = null;

export function setGlobalLogger(logger: Logger): void {
  globalLogger = logger;
}

export function getGlobalLogger(): Logger {
  if (!globalLogger) {
    // Fallback: return a stderr-only logger if not yet initialized
    return {
      info: (msg, meta) => process.stderr.write(`[INFO] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}\n`),
      warn: (msg, meta) => process.stderr.write(`[WARN] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}\n`),
      error: (msg, meta) => process.stderr.write(`[ERROR] ${msg}${meta ? ' ' + JSON.stringify(meta) : ''}\n`),
    };
  }
  return globalLogger;
}

// ---- Audit Logging ----

let auditLogPath: string | null = null;
let auditFileCreated = false;

export function setAuditLog(path: string | null): void {
  auditLogPath = path;
  auditFileCreated = false;
}

export function audit(event: string, data: Record<string, unknown>): void {
  if (!auditLogPath) return;

  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };

  try {
    const line = JSON.stringify(entry) + '\n';
    if (!auditFileCreated && !existsSync(auditLogPath)) {
      // Create file with restrictive permissions (owner-only read/write)
      const fd = openSync(auditLogPath, 'a', 0o600);
      closeSync(fd);
      auditFileCreated = true;
    }
    appendFileSync(auditLogPath, line);
  } catch {
    // Best effort -- audit log may not be writable
  }
}

export function readLogTail(logFile: string, lines: number = 50): string {
  try {
    if (!existsSync(logFile)) return '';
    const content = readFileSync(logFile, 'utf-8');
    const allLines = content.split('\n');
    return allLines.slice(Math.max(0, allLines.length - lines)).join('\n');
  } catch {
    return '';
  }
}
