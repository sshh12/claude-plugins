import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname } from "path";
import type { Logger } from "./logger.js";

/**
 * Connector lease lock.
 *
 * Why this exists: `.mcp.json` starts one mcp-server.js per Claude Code
 * process. In a multi-agent team every subprocess loads the plugin and would
 * otherwise open its own Baileys socket against the SAME linked-device
 * credentials. WhatsApp permits one socket per device, so concurrent sockets
 * fight (DisconnectReason 440 connectionReplaced) in a crash loop.
 *
 * This lock guarantees exactly one process (the "connector") owns the socket.
 * Others run as read-only "standby". It is a HEARTBEAT lock, not a plain
 * lockfile, so a hard-killed connector (no cleanup) does not wedge every
 * future session into standby forever — a stale heartbeat is reclaimable.
 *
 * Single-machine, last-writer-wins-with-verification. The startup contention
 * window is tiny and the heartbeat self-demote (onLost) is the safety net: if
 * two processes ever briefly both believe they are connector, the one whose
 * pid is no longer in the file demotes within one heartbeat interval.
 */

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const STALE_MS = 30_000;
export const STANDBY_POLL_MS = 20_000;

interface LockData {
  pid: number;
  startedAt: number;
  heartbeatAt: number;
}

export class ConnectorLock {
  private lockPath: string;
  private logger: Logger;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private startedAt = Date.now();

  constructor(lockPath: string, logger: Logger) {
    this.lockPath = lockPath;
    this.logger = logger;
  }

  /**
   * Try to become the connector. Succeeds if there is no lock, or the
   * existing holder is dead or its heartbeat is stale. Returns true if this
   * process now owns the lease.
   */
  tryAcquire(): boolean {
    const existing = this.readLock();
    if (
      existing &&
      existing.pid !== process.pid &&
      this.isHolderAlive(existing) &&
      !this.isStale(existing)
    ) {
      return false; // a live, fresh holder exists
    }
    return this.writeLockVerified();
  }

  /**
   * Begin refreshing the heartbeat. If a foreign pid takes over the file
   * (we stalled and a standby promoted), stop and invoke onLost so the
   * caller can drop its socket and self-demote to standby.
   */
  startHeartbeat(onLost: () => void): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const data = this.readLock();
      if (data && data.pid !== process.pid) {
        // Someone else owns the file now — we lost the lease.
        this.logger.warn("Connector lease lost to another instance", {
          holderPid: data.pid,
        });
        this.stopHeartbeat();
        try {
          onLost();
        } catch {
          // best effort
        }
        return;
      }
      // Re-assert ownership with a fresh heartbeat (covers missing/our file).
      this.writeLockVerified();
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref();
  }

  /**
   * Release the lease on graceful shutdown. Only removes the file if we
   * still own it. Best-effort; never throws.
   */
  release(): void {
    this.stopHeartbeat();
    try {
      const data = this.readLock();
      if (data && data.pid === process.pid && existsSync(this.lockPath)) {
        unlinkSync(this.lockPath);
      }
    } catch (err: any) {
      this.logger.warn("Connector lock release failed", {
        error: err?.message ?? String(err),
      });
    }
  }

  /** Pid of the current lock holder, or null if none / unreadable. */
  readHolderPid(): number | null {
    return this.readLock()?.pid ?? null;
  }

  // ---- internals ----

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private readLock(): LockData | null {
    try {
      if (!existsSync(this.lockPath)) return null;
      const parsed = JSON.parse(readFileSync(this.lockPath, "utf-8"));
      if (
        parsed &&
        typeof parsed.pid === "number" &&
        typeof parsed.heartbeatAt === "number"
      ) {
        return parsed as LockData;
      }
      return null; // corrupt — treat as no lock (reclaimable)
    } catch {
      return null;
    }
  }

  private isHolderAlive(data: LockData): boolean {
    if (data.pid === process.pid) return true;
    if (!data.pid || data.pid <= 0) return false;
    try {
      process.kill(data.pid, 0);
      return true;
    } catch (err: any) {
      // EPERM: pid exists but owned by another user — still alive.
      // ESRCH: no such process — dead.
      return err?.code === "EPERM";
    }
  }

  private isStale(data: LockData): boolean {
    return Date.now() - data.heartbeatAt > STALE_MS;
  }

  /**
   * Atomically write our lock data and verify we won. Per-pid temp name so
   * concurrent contenders don't clobber each other's temp mid-rename; the
   * rename is atomic and last-writer-wins, then we re-read to confirm our
   * pid survived.
   */
  private writeLockVerified(): boolean {
    try {
      mkdirSync(dirname(this.lockPath), { recursive: true, mode: 0o700 });
      const data: LockData = {
        pid: process.pid,
        startedAt: this.startedAt,
        heartbeatAt: Date.now(),
      };
      const tmp = `${this.lockPath}.tmp.${process.pid}`;
      writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
      renameSync(tmp, this.lockPath);
      const after = this.readLock();
      return after?.pid === process.pid;
    } catch (err: any) {
      this.logger.warn("Connector lock write failed", {
        error: err?.message ?? String(err),
      });
      return false;
    }
  }
}
