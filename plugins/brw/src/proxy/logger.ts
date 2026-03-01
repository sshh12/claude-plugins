import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'fs';

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

function truncateLogFile(logFile: string): void {
  try {
    if (!existsSync(logFile)) return;
    const content = readFileSync(logFile, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > MAX_LINES_ON_INIT) {
      const truncated = lines.slice(lines.length - MAX_LINES_ON_INIT).join('\n');
      writeFileSync(logFile, truncated);
    }
  } catch {
    // Best effort
  }
}

export function createLogger(logFile: string): Logger {
  truncateLogFile(logFile);

  function log(level: string, message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}${formatMeta(meta)}\n`;
    process.stderr.write(line);
    try {
      appendFileSync(logFile, line);
    } catch {
      // Best effort — log file may not be writable
    }
  }

  return {
    info: (message, meta) => log('INFO', message, meta),
    warn: (message, meta) => log('WARN', message, meta),
    error: (message, meta) => log('ERROR', message, meta),
  };
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
