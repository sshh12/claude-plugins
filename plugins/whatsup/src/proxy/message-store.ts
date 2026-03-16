import type { StoredMessage } from '../shared/types.js';

type MessageFilter = {
  from?: string;   // sender JID
  chat?: string;   // chat JID
  since?: number;  // timestamp
  limit?: number;  // max results
};

type MessageSubscriber = {
  filter: MessageFilter;
  resolve: (result: { messages: StoredMessage[]; timedOut: boolean }) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export class MessageStore {
  private buffer: StoredMessage[];
  private maxSize: number;
  private subscribers: Set<MessageSubscriber>;

  constructor(maxSize: number = 500) {
    this.buffer = [];
    this.maxSize = maxSize;
    this.subscribers = new Set();
  }

  /**
   * Add a message to the buffer and notify matching subscribers.
   * When the buffer is full, the oldest message is dropped.
   */
  add(message: StoredMessage): void {
    // Deduplicate: if same ID exists, keep the one with more content
    const existingIdx = this.buffer.findIndex((m) => m.id === message.id);
    if (existingIdx !== -1) {
      const existing = this.buffer[existingIdx];
      let upgraded = false;
      // Prefer the version that has text or a known messageType
      if (!existing.text && message.text) {
        this.buffer[existingIdx] = message;
        upgraded = true;
      } else if (existing.messageType === "unknown" && message.messageType !== "unknown") {
        this.buffer[existingIdx] = message;
        upgraded = true;
      }
      // If the message was upgraded (now has text), notify waiting subscribers
      if (upgraded) {
        for (const subscriber of this.subscribers) {
          if (this.matchesFilter(message, subscriber.filter)) {
            const matches = this.applyFilter(this.buffer, subscriber.filter);
            if (subscriber.timer) clearTimeout(subscriber.timer);
            this.subscribers.delete(subscriber);
            subscriber.resolve({ messages: matches, timedOut: false });
          }
        }
      }
      return;
    }

    this.buffer.push(message);

    // Ring buffer: drop oldest when full
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    // Check all subscribers for matches
    // Only notify on messages with actual content (text or media), not bare "unknown" events
    if (message.text || message.hasMedia || message.messageType !== "unknown") {
      for (const subscriber of this.subscribers) {
        if (this.matchesFilter(message, subscriber.filter)) {
          const matches = this.applyFilter(this.buffer, subscriber.filter);
          if (subscriber.timer) {
            clearTimeout(subscriber.timer);
          }
          this.subscribers.delete(subscriber);
          subscriber.resolve({ messages: matches, timedOut: false });
        }
      }
    }
  }

  /**
   * Query existing messages in the buffer.
   */
  query(filter: MessageFilter): StoredMessage[] {
    return this.applyFilter(this.buffer, filter);
  }

  /**
   * Subscribe to new messages matching a filter with a timeout.
   * Returns immediately if matching messages already exist in the buffer.
   */
  subscribe(
    filter: MessageFilter,
    timeoutMs: number
  ): Promise<{ messages: StoredMessage[]; timedOut: boolean }> {
    // Check existing buffer first
    const existing = this.applyFilter(this.buffer, filter);
    if (existing.length > 0) {
      return Promise.resolve({ messages: existing, timedOut: false });
    }

    return new Promise((resolve) => {
      const subscriber: MessageSubscriber = {
        filter,
        resolve,
      };

      subscriber.timer = setTimeout(() => {
        this.subscribers.delete(subscriber);
        // On timeout, return whatever matches are available now
        const finalMatches = this.applyFilter(this.buffer, filter);
        resolve({ messages: finalMatches, timedOut: true });
      }, timeoutMs);

      this.subscribers.add(subscriber);
    });
  }

  /**
   * Search messages by text content (case-insensitive).
   */
  search(query: string, filter?: Omit<MessageFilter, 'since'>): StoredMessage[] {
    const lowerQuery = query.toLowerCase();

    let candidates = this.buffer.filter(
      (msg) => msg.text && msg.text.toLowerCase().includes(lowerQuery)
    );

    if (filter) {
      candidates = this.applyFilter(candidates, { ...filter, since: undefined });
    }

    return candidates;
  }

  /**
   * Get buffer size and stats.
   */
  getStats(): { size: number; maxSize: number; oldest?: number; newest?: number } {
    return {
      size: this.buffer.length,
      maxSize: this.maxSize,
      oldest: this.buffer.length > 0 ? this.buffer[0].timestamp : undefined,
      newest: this.buffer.length > 0 ? this.buffer[this.buffer.length - 1].timestamp : undefined,
    };
  }

  /**
   * Clear the buffer and cancel all pending subscribers.
   */
  clear(): void {
    this.buffer = [];

    for (const subscriber of this.subscribers) {
      if (subscriber.timer) {
        clearTimeout(subscriber.timer);
      }
      subscriber.resolve({ messages: [], timedOut: true });
    }
    this.subscribers.clear();
  }

  /**
   * Check if a single message matches a filter.
   */
  private matchesFilter(message: StoredMessage, filter: MessageFilter): boolean {
    if (filter.from && message.sender !== filter.from) return false;
    if (filter.chat && message.chatId !== filter.chat) return false;
    if (filter.since && message.timestamp < filter.since) return false;
    return true;
  }

  /**
   * Apply a filter to a list of messages and return matching results.
   */
  private applyFilter(messages: StoredMessage[], filter: MessageFilter): StoredMessage[] {
    let results = messages.filter((msg) => this.matchesFilter(msg, filter));

    if (filter.limit && results.length > filter.limit) {
      // Return the most recent messages up to the limit
      results = results.slice(results.length - filter.limit);
    }

    return results;
  }
}
