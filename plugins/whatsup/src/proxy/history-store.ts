import {
  appendFileSync,
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname } from "path";
import { mkdirSync } from "fs";
import type { StoredMessage } from "../shared/types.js";
import { getGlobalLogger } from "./logger.js";

/**
 * Persistent message history as JSONL. One StoredMessage per line.
 *
 * Why a flat file: easy to inspect with `jq`, atomic appendFileSync writes
 * for small lines on POSIX, no DB dependency, no schema migration story.
 *
 * Caveats:
 * - Raw Baileys WAMessage protos do NOT persist (binary, not JSON-safe).
 *   download_attachment only works for in-session messages.
 * - Two MCP processes appending concurrently can tear lines. Same property
 *   as the audit log; a singleton lock is the long-term answer.
 */

/**
 * Append a single message to the history file.
 * Best-effort — logs but does not throw on failure.
 */
export function appendMessage(filePath: string, msg: StoredMessage): void {
  try {
    ensureFile(filePath);
    const line = JSON.stringify(msg) + "\n";
    appendFileSync(filePath, line);
  } catch (err: any) {
    getGlobalLogger().warn("history append failed", {
      error: err?.message ?? String(err),
    });
  }
}

/**
 * Read the file and return the most recent `limit` valid messages, sorted
 * by timestamp ascending (oldest first — matches the order add() expects).
 * Skips malformed lines. Empty / missing file returns [].
 */
export function loadRecentMessages(filePath: string, limit: number): StoredMessage[] {
  if (!existsSync(filePath)) return [];

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: any) {
    getGlobalLogger().warn("history read failed", {
      error: err?.message ?? String(err),
    });
    return [];
  }

  const lines = raw.split("\n");
  // Tail first so we cap parse cost on huge files.
  const tail = lines.slice(Math.max(0, lines.length - limit - 1));

  const messages: StoredMessage[] = [];
  for (const line of tail) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as StoredMessage;
      // Minimal shape check — older log lines may lack new fields, that's fine.
      if (!parsed.id || !parsed.chatId || typeof parsed.timestamp !== "number") continue;
      messages.push(parsed);
    } catch {
      // skip malformed
    }
  }

  // Defensive sort — log SHOULD already be in timestamp order but a torn
  // restart or clock skew can produce out-of-order entries.
  messages.sort((a, b) => a.timestamp - b.timestamp);

  return messages.length > limit ? messages.slice(messages.length - limit) : messages;
}

/**
 * Prune messages older than `retentionDays` from the file.
 * Rewrites atomically via tmp + rename. Returns the number of entries
 * kept and dropped. Best-effort; logs and returns on failure.
 */
export function pruneOld(
  filePath: string,
  retentionDays: number
): { kept: number; dropped: number } {
  if (!existsSync(filePath)) return { kept: 0, dropped: 0 };
  if (retentionDays <= 0) return { kept: 0, dropped: 0 };

  const cutoffSeconds = Math.floor(Date.now() / 1000) - retentionDays * 86400;

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err: any) {
    getGlobalLogger().warn("history prune read failed", {
      error: err?.message ?? String(err),
    });
    return { kept: 0, dropped: 0 };
  }

  const kept: string[] = [];
  let dropped = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as StoredMessage;
      if (typeof parsed.timestamp === "number" && parsed.timestamp >= cutoffSeconds) {
        kept.push(line);
      } else {
        dropped++;
      }
    } catch {
      dropped++;
    }
  }

  if (dropped === 0) return { kept: kept.length, dropped: 0 };

  const tmp = filePath + ".tmp";
  try {
    writeFileSync(tmp, kept.length ? kept.join("\n") + "\n" : "", { mode: 0o600 });
    renameSync(tmp, filePath);
  } catch (err: any) {
    getGlobalLogger().warn("history prune rewrite failed", {
      error: err?.message ?? String(err),
    });
    return { kept: kept.length, dropped: 0 };
  }

  return { kept: kept.length, dropped };
}

/**
 * Ensure the history file exists with 0600 perms and that its parent
 * directory exists. Idempotent.
 */
function ensureFile(filePath: string): void {
  if (!existsSync(filePath)) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(filePath, "", { mode: 0o600 });
    return;
  }
  // Re-enforce 0600 if perms drifted.
  try {
    const st = statSync(filePath);
    const current = st.mode & 0o777;
    if (current !== 0o600) chmodSync(filePath, 0o600);
  } catch {
    // best effort
  }
}
