import type { ApiResponse, WhatsUpConfig } from '../shared/types.js';
import { ErrorCode } from '../shared/types.js';

export class RateLimiter {
  private perContact: Map<string, number[]>; // jid -> timestamps
  private totalTimestamps: number[];
  private perContactLimit: number;
  private totalLimit: number;
  private windowMs: number; // 60000 (1 minute)

  constructor(config: WhatsUpConfig) {
    this.perContact = new Map();
    this.totalTimestamps = [];
    this.perContactLimit = config.rateLimitPerContact;
    this.totalLimit = config.rateLimitTotal;
    this.windowMs = 60_000;
  }

  /**
   * Check if a send to this JID would exceed rate limits.
   * Returns null if OK, ApiResponse error if rate limited.
   */
  check(jid: string): ApiResponse | null {
    this.cleanup();

    // Check total limit
    if (this.totalTimestamps.length >= this.totalLimit) {
      return {
        ok: false,
        error: `Total rate limit exceeded: ${this.totalTimestamps.length}/${this.totalLimit} messages in the last minute.`,
        code: ErrorCode.RATE_LIMITED,
        hint: 'WhatsApp may ban accounts for excessive messaging. Wait before retrying.',
      };
    }

    // Check per-contact limit
    const contactTimestamps = this.perContact.get(jid) || [];
    if (contactTimestamps.length >= this.perContactLimit) {
      return {
        ok: false,
        error: `Per-contact rate limit exceeded for ${jid}: ${contactTimestamps.length}/${this.perContactLimit} messages in the last minute.`,
        code: ErrorCode.RATE_LIMITED,
        hint: 'WhatsApp may ban accounts for excessive messaging. Wait before retrying.',
      };
    }

    return null;
  }

  /**
   * Record a successful send.
   */
  record(jid: string): void {
    const now = Date.now();

    this.totalTimestamps.push(now);

    const contactTimestamps = this.perContact.get(jid) || [];
    contactTimestamps.push(now);
    this.perContact.set(jid, contactTimestamps);
  }

  /**
   * Clean up old entries outside the sliding window.
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;

    // Clean total timestamps
    this.totalTimestamps = this.totalTimestamps.filter((ts) => ts > cutoff);

    // Clean per-contact timestamps
    for (const [jid, timestamps] of this.perContact.entries()) {
      const filtered = timestamps.filter((ts) => ts > cutoff);
      if (filtered.length === 0) {
        this.perContact.delete(jid);
      } else {
        this.perContact.set(jid, filtered);
      }
    }
  }

  /**
   * Get current usage stats.
   */
  getStats(): { perContact: Record<string, number>; total: number } {
    this.cleanup();

    const perContact: Record<string, number> = {};
    for (const [jid, timestamps] of this.perContact.entries()) {
      perContact[jid] = timestamps.length;
    }

    return {
      perContact,
      total: this.totalTimestamps.length,
    };
  }
}
