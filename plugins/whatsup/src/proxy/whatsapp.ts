import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type WAMessage,
  type Contact,
  type Chat,
  type ChatUpdate,
  type WAMessageKey,
  type AnyMessageContent,
  type MiscMessageGenerationOptions,
  type WAPresence,
} from "baileys";
import type { Boom } from "@hapi/boom";
import pino from "pino";
import type {
  WhatsUpConfig,
  ConnectionStatus,
  StoredMessage,
} from "../shared/types.js";
import { MessageStore } from "./message-store.js";
import { initAuthState, saveQrCode, cleanupQrCode, clearCredentials, type AuthState } from "./auth.js";
import { getGlobalLogger, audit } from "./logger.js";

// ---- WhatsApp Connection Manager ----

export class WhatsAppManager {
  private sock: WASocket | null = null;
  private config: WhatsUpConfig;
  private messageStore: MessageStore;
  private authState: AuthState | null = null;
  private connectionStatus: ConnectionStatus;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private qrHandler?: (qr: string) => void;
  private contacts: Map<string, Contact> = new Map();
  private chats: Map<string, Chat> = new Map();
  private lidToPhone: Map<string, string> = new Map(); // LID JID → phone JID

  constructor(config: WhatsUpConfig, messageStore: MessageStore) {
    this.config = config;
    this.messageStore = messageStore;
    this.connectionStatus = {
      connected: false,
      authenticated: false,
    };
  }

  /**
   * Connect to WhatsApp via Baileys WASocket.
   * Sets up all event handlers for connection, messages, contacts, and chats.
   *
   * @param options.onQr - Callback invoked when a QR code is received for pairing
   * @returns Current connection status after initial setup
   */
  async connect(options?: { onQr?: (qr: string) => void }): Promise<ConnectionStatus> {
    const logger = getGlobalLogger();

    this.qrHandler = options?.onQr;
    audit("connection_attempt", {});

    // 1. Initialize auth state
    this.authState = await initAuthState(this.config);

    // 2. Fetch latest Baileys version (best-effort, falls back to bundled)
    let version: [number, number, number] | undefined;
    try {
      const versionResult = await fetchLatestBaileysVersion();
      if (!versionResult.error) {
        version = versionResult.version;
        logger.info("Using Baileys version", { version: version.join("."), isLatest: versionResult.isLatest });
      }
    } catch {
      logger.warn("Could not fetch latest Baileys version, using bundled");
    }

    // 3. Create a silent pino logger to suppress Baileys internal logging
    const baileysLogger = pino({ level: "silent" }) as any;

    // 4. Create WASocket
    this.sock = makeWASocket({
      auth: {
        creds: this.authState.state.creds,
        keys: makeCacheableSignalKeyStore(this.authState.state.keys, baileysLogger),
      },
      printQRInTerminal: false,
      logger: baileysLogger,
      browser: ["WhatsUp", "Chrome", "1.0"],
      generateHighQualityLinkPreview: true,
      ...(version ? { version } : {}),
    });

    // 5. Set up event handlers
    this.setupEventHandlers();

    logger.info("WhatsApp socket created, waiting for connection...");

    return this.connectionStatus;
  }

  /**
   * Disconnect gracefully from WhatsApp.
   * Clears the socket, cancels reconnect timers, and resets state.
   */
  async disconnect(): Promise<void> {
    const logger = getGlobalLogger();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // Ignore close errors
      }
      this.sock = null;
    }

    this.connectionStatus = {
      connected: false,
      authenticated: false,
    };
    this.reconnectAttempts = 0;
    this.qrHandler = undefined;

    logger.info("WhatsApp disconnected");
    audit("disconnected", {});
  }

  /**
   * Get current connection status.
   */
  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  /**
   * Get the underlying WASocket instance.
   * Handlers and other modules use this to access Baileys API directly.
   */
  getSocket(): WASocket | null {
    return this.sock;
  }

  /**
   * Get cached contacts map (JID -> Contact).
   */
  getContacts(): Map<string, Contact> {
    return this.contacts;
  }

  /**
   * Get cached chats map (JID -> Chat).
   */
  getChats(): Map<string, Chat> {
    return this.chats;
  }

  /**
   * Send a message to the specified JID.
   * Throws if the socket is not connected and authenticated.
   */
  async sendMessage(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<ReturnType<WASocket["sendMessage"]>> {
    if (!this.sock || !this.isReady()) {
      throw new Error("WhatsApp is not connected");
    }
    return this.sock.sendMessage(jid, content, options);
  }

  /**
   * Mark messages as read.
   */
  async readMessages(keys: WAMessageKey[]): Promise<void> {
    if (!this.sock || !this.isReady()) {
      throw new Error("WhatsApp is not connected");
    }
    await this.sock.readMessages(keys);
  }

  /**
   * Update presence (available, unavailable, composing, recording, paused).
   */
  async sendPresenceUpdate(type: WAPresence, jid?: string): Promise<void> {
    if (!this.sock || !this.isReady()) {
      throw new Error("WhatsApp is not connected");
    }
    await this.sock.sendPresenceUpdate(type, jid);
  }

  /**
   * Update the user's profile "about" / status text.
   */
  async updateProfileStatus(status: string): Promise<void> {
    if (!this.sock || !this.isReady()) {
      throw new Error("WhatsApp is not connected");
    }
    await this.sock.updateProfileStatus(status);
  }

  /**
   * Update the user's profile display name.
   */
  async updateProfileName(name: string): Promise<void> {
    if (!this.sock || !this.isReady()) {
      throw new Error("WhatsApp is not connected");
    }
    await this.sock.updateProfileName(name);
  }

  /**
   * Get a contact's profile picture URL.
   * Returns null if no profile picture is set or an error occurs.
   */
  async getProfilePicture(jid: string): Promise<string | null> {
    if (!this.sock || !this.isReady()) {
      throw new Error("WhatsApp is not connected");
    }
    try {
      const url = await this.sock.profilePictureUrl(jid, "image");
      return url ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Check if the connection is fully ready (connected and authenticated).
   */
  isReady(): boolean {
    return this.connectionStatus.connected && this.connectionStatus.authenticated;
  }

  /**
   * Resolve a JID to a phone-based JID if possible.
   * Converts @lid JIDs to @s.whatsapp.net using the contact cache.
   * Returns the original JID if no mapping is found.
   */
  resolveJid(jid: string): string {
    if (!jid.endsWith("@lid")) return jid;
    return this.lidToPhone.get(jid) ?? jid;
  }

  /**
   * Register a LID → phone JID mapping.
   * Called when we learn about the association from contacts or messages.
   */
  private registerLidMapping(contact: Contact): void {
    const id = contact.id;
    const lid = (contact as any).lid;
    if (lid && id?.endsWith("@s.whatsapp.net")) {
      this.lidToPhone.set(lid, id);
    }
    if (id?.endsWith("@lid") && lid?.endsWith("@s.whatsapp.net")) {
      this.lidToPhone.set(id, lid);
    }
  }

  /**
   * Resolve allowlisted phone numbers to their LID JIDs via onWhatsApp().
   * Called once after connection opens.
   */
  private async resolveAllowlistLids(): Promise<void> {
    if (!this.sock) return;
    const logger = getGlobalLogger();
    const numbers = this.config.allowlist;
    if (numbers.length === 0) return;

    logger.info("Resolving allowlisted numbers to LID JIDs", { count: numbers.length });

    for (const phone of numbers) {
      try {
        const digits = phone.replace(/[^\d]/g, "");
        const results = await this.sock.onWhatsApp(digits);
        if (results && results.length > 0) {
          for (const result of results) {
            const phoneJid = `${digits}@s.whatsapp.net`;
            // result.jid may be phone JID or LID
            if (result.jid && result.jid !== phoneJid) {
              this.lidToPhone.set(result.jid, phoneJid);
              logger.info("LID mapping found", { phone, lid: result.jid, phoneJid });
            }
            // Check for lid field
            if ((result as any).lid) {
              this.lidToPhone.set((result as any).lid, phoneJid);
              logger.info("LID mapping found (lid field)", { phone, lid: (result as any).lid, phoneJid });
            }
          }
        }
      } catch (err: any) {
        logger.warn("Failed to resolve LID for number", { phone, error: err?.message });
      }
    }

    logger.info("LID resolution complete", { mappings: this.lidToPhone.size });
  }

  // ---- Private Methods ----

  /**
   * Set up all Baileys event handlers on the socket.
   */
  private setupEventHandlers(): void {
    if (!this.sock) return;

    const logger = getGlobalLogger();
    const ev = this.sock.ev;

    // --- connection.update ---
    ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR code received -- needs scanning
      if (qr) {
        logger.info("QR code received, scan to authenticate");
        audit("qr_received", {});

        // Save QR code to file
        try {
          await saveQrCode(qr, this.config.qrCodeFile);
        } catch (err: any) {
          logger.error("Failed to save QR code file", { error: err?.message });
        }

        // Invoke the callback so callers can handle QR display
        if (this.qrHandler) {
          try {
            this.qrHandler(qr);
          } catch {
            // Ignore callback errors
          }
        }
      }

      // Connection opened
      if (connection === "open") {
        this.connectionStatus.connected = true;
        this.connectionStatus.authenticated = true;
        this.connectionStatus.lastConnected = Date.now();
        this.reconnectAttempts = 0;

        // Extract user info from the socket
        if (this.sock?.user) {
          this.connectionStatus.phone = this.sock.user.id;
          this.connectionStatus.pushName = this.sock.user.name ?? undefined;
        }

        // Clean up QR code file now that we are authenticated
        cleanupQrCode(this.config.qrCodeFile);

        // Resolve allowlisted phone numbers to LID JIDs for matching
        this.resolveAllowlistLids().catch(() => {});

        logger.info("WhatsApp connected", {
          phone: this.connectionStatus.phone,
          pushName: this.connectionStatus.pushName,
        });
        audit("connection_open", {
          phone: this.connectionStatus.phone,
          pushName: this.connectionStatus.pushName,
        });
      }

      // Connection closed
      if (connection === "close") {
        this.connectionStatus.connected = false;

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message ?? "unknown";

        logger.warn("WhatsApp connection closed", {
          statusCode,
          error: errorMessage,
        });
        audit("connection_close", { statusCode, error: errorMessage });

        if (statusCode === DisconnectReason.loggedOut) {
          // User logged out -- clear credentials and reset
          logger.info("Logged out from WhatsApp, clearing credentials");
          audit("logged_out", {});

          this.connectionStatus.authenticated = false;
          this.connectionStatus.phone = undefined;
          this.connectionStatus.pushName = undefined;

          try {
            await clearCredentials(this.config.authDir);
          } catch (err: any) {
            logger.error("Failed to clear credentials after logout", { error: err?.message });
          }
        } else if (this.config.autoReconnect) {
          // Attempt reconnect for non-logout disconnects
          this.scheduleReconnect();
        }
      }
    });

    // --- creds.update ---
    ev.on("creds.update", async () => {
      if (this.authState) {
        try {
          await this.authState.saveCreds();
        } catch (err: any) {
          logger.error("Failed to save credentials", { error: err?.message });
        }
      }
    });

    // --- messages.upsert ---
    ev.on("messages.upsert", ({ messages, type }) => {
      for (const msg of messages) {
        const stored = toBaileysMessage(msg);
        if (stored) {
          // Resolve LID JIDs to phone JIDs for allowlist matching
          stored.chatId = this.resolveJid(stored.chatId);
          stored.sender = this.resolveJid(stored.sender);

          this.messageStore.add(stored);

          if (type === "notify") {
            logger.info("Message received", {
              id: stored.id,
              chatId: stored.chatId,
              sender: stored.sender,
              isFromMe: stored.isFromMe,
              messageType: stored.messageType,
              hasText: !!stored.text,
            });
          }
        }
      }
    });

    // --- messages.update ---
    ev.on("messages.update", (updates) => {
      // Log message edits/deletes but we don't modify the store
      // (the store is append-only for simplicity)
      for (const update of updates) {
        if (update.update.message) {
          logger.info("Message updated", { key: update.key });
        }
      }
    });

    // --- contacts.upsert ---
    ev.on("contacts.upsert", (contacts) => {
      for (const contact of contacts) {
        if (contact.id) {
          this.contacts.set(contact.id, contact);
          this.registerLidMapping(contact);
        }
      }
      logger.info("Contacts updated", { count: contacts.length, lidMappings: this.lidToPhone.size });
    });

    // --- contacts.update ---
    ev.on("contacts.update", (updates) => {
      for (const update of updates) {
        if (update.id) {
          const existing = this.contacts.get(update.id);
          if (existing) {
            this.contacts.set(update.id, { ...existing, ...update } as Contact);
          }
        }
      }
    });

    // --- chats.upsert ---
    ev.on("chats.upsert", (newChats) => {
      for (const chat of newChats) {
        if (chat.id) {
          this.chats.set(chat.id, chat);
        }
      }
      logger.info("Chats upserted", { count: newChats.length });
    });

    // --- chats.update ---
    ev.on("chats.update", (updates: ChatUpdate[]) => {
      for (const update of updates) {
        if (update.id) {
          const existing = this.chats.get(update.id);
          if (existing) {
            this.chats.set(update.id, { ...existing, ...update } as Chat);
          }
        }
      }
    });

    // --- chats.delete ---
    ev.on("chats.delete", (deletedIds) => {
      for (const id of deletedIds) {
        this.chats.delete(id);
      }
    });

    // --- messaging-history.set ---
    ev.on("messaging-history.set", ({ chats: histChats, contacts: histContacts, messages: histMessages }) => {
      // Cache contacts from history sync and build LID map
      for (const contact of histContacts) {
        if (contact.id) {
          this.contacts.set(contact.id, contact);
          this.registerLidMapping(contact);
        }
      }

      // Cache chats from history sync
      for (const chat of histChats) {
        if (chat.id) {
          this.chats.set(chat.id, chat);
        }
      }

      // Add historical messages to the store (with LID resolution)
      for (const msg of histMessages) {
        const stored = toBaileysMessage(msg);
        if (stored) {
          stored.chatId = this.resolveJid(stored.chatId);
          stored.sender = this.resolveJid(stored.sender);
          this.messageStore.add(stored);
        }
      }

      logger.info("History sync received", {
        chats: histChats.length,
        contacts: histContacts.length,
        messages: histMessages.length,
      });
    });
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Backoff: 1s, 2s, 4s, 8s, ..., capped at 60s.
   * Max attempts: 10.
   */
  private scheduleReconnect(): void {
    const logger = getGlobalLogger();
    const MAX_ATTEMPTS = 10;
    const MAX_DELAY_MS = 60_000;

    if (this.reconnectAttempts >= MAX_ATTEMPTS) {
      logger.error("Max reconnect attempts reached, giving up", {
        attempts: this.reconnectAttempts,
      });
      audit("reconnect_failed", { attempts: this.reconnectAttempts });
      return;
    }

    const delayMs = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      MAX_DELAY_MS
    );
    this.reconnectAttempts++;

    logger.info("Scheduling reconnect", {
      attempt: this.reconnectAttempts,
      delayMs,
    });
    audit("reconnect_scheduled", { attempt: this.reconnectAttempts, delayMs });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        logger.info("Reconnecting to WhatsApp...", { attempt: this.reconnectAttempts });
        await this.connect({ onQr: this.qrHandler });
      } catch (err: any) {
        logger.error("Reconnect failed", {
          attempt: this.reconnectAttempts,
          error: err?.message,
        });
        // The connection.update handler will schedule the next attempt
        // if the connection closes again
      }
    }, delayMs);
  }
}

// ---- Message Conversion ----

/**
 * Convert a Baileys WAMessage into our StoredMessage format.
 * Handles the many message types that Baileys can produce.
 * Returns null if the message cannot be meaningfully converted.
 */
export function toBaileysMessage(msg: WAMessage): StoredMessage | null {
  if (!msg.key || !msg.key.remoteJid) return null;

  const key = msg.key;
  const message = msg.message;

  // Determine message type and extract text content
  let text: string | undefined;
  let messageType = "unknown";
  let mediaType: StoredMessage["mediaType"];
  let hasMedia = false;

  if (message) {
    if (message.conversation) {
      messageType = "conversation";
      text = message.conversation;
    } else if (message.extendedTextMessage) {
      messageType = "extendedTextMessage";
      text = message.extendedTextMessage.text ?? undefined;
    } else if (message.imageMessage) {
      messageType = "imageMessage";
      text = message.imageMessage.caption ?? undefined;
      mediaType = "image";
      hasMedia = true;
    } else if (message.videoMessage) {
      messageType = "videoMessage";
      text = message.videoMessage.caption ?? undefined;
      mediaType = "video";
      hasMedia = true;
    } else if (message.audioMessage) {
      messageType = "audioMessage";
      mediaType = "audio";
      hasMedia = true;
    } else if (message.documentMessage) {
      messageType = "documentMessage";
      text = message.documentMessage.caption ?? undefined;
      mediaType = "document";
      hasMedia = true;
    } else if (message.stickerMessage) {
      messageType = "stickerMessage";
      mediaType = "sticker";
      hasMedia = true;
    } else if (message.locationMessage) {
      messageType = "locationMessage";
      const loc = message.locationMessage;
      text = loc.name
        ? `${loc.name} (${loc.degreesLatitude}, ${loc.degreesLongitude})`
        : `Location: ${loc.degreesLatitude}, ${loc.degreesLongitude}`;
    } else if (message.contactMessage) {
      messageType = "contactMessage";
      text = message.contactMessage.displayName ?? undefined;
    } else if (message.contactsArrayMessage) {
      messageType = "contactsArrayMessage";
      const names = message.contactsArrayMessage.contacts?.map((c) => c.displayName).filter(Boolean);
      text = names?.join(", ") ?? undefined;
    } else if (message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3) {
      messageType = "pollCreationMessage";
      const poll = message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3;
      text = poll?.name ?? undefined;
    } else if (message.reactionMessage) {
      messageType = "reactionMessage";
      text = message.reactionMessage.text ?? undefined;
    } else if (message.protocolMessage) {
      // Protocol messages (edits, deletes, ephemeral settings) -- skip most
      messageType = "protocolMessage";
      return null;
    } else if (message.ephemeralMessage) {
      // Unwrap ephemeral wrapper and recurse
      if (message.ephemeralMessage.message) {
        const innerMsg: WAMessage = {
          ...msg,
          message: message.ephemeralMessage.message,
        };
        return toBaileysMessage(innerMsg);
      }
      return null;
    } else if (message.viewOnceMessage) {
      // Unwrap view-once wrapper and recurse
      if (message.viewOnceMessage.message) {
        const innerMsg: WAMessage = {
          ...msg,
          message: message.viewOnceMessage.message,
        };
        return toBaileysMessage(innerMsg);
      }
      return null;
    } else if (message.viewOnceMessageV2) {
      if (message.viewOnceMessageV2.message) {
        const innerMsg: WAMessage = {
          ...msg,
          message: message.viewOnceMessageV2.message,
        };
        return toBaileysMessage(innerMsg);
      }
      return null;
    } else {
      // Fallback: try to identify the type from the first key
      const keys = Object.keys(message);
      if (keys.length > 0) {
        messageType = keys[0];
      }
    }
  }

  // Determine sender
  const isFromMe = !!key.fromMe;
  const remoteJid = key.remoteJid!;
  const isGroup = remoteJid.endsWith("@g.us");
  const sender = isFromMe
    ? (key.participant ?? remoteJid)
    : isGroup
      ? (key.participant ?? remoteJid)
      : remoteJid;

  // Extract quoted message ID from context info
  let quotedMessageId: string | undefined;
  if (message) {
    const contextInfo =
      (message.extendedTextMessage?.contextInfo) ??
      (message.imageMessage?.contextInfo) ??
      (message.videoMessage?.contextInfo) ??
      (message.audioMessage?.contextInfo) ??
      (message.documentMessage?.contextInfo) ??
      (message.stickerMessage?.contextInfo);

    if (contextInfo?.stanzaId) {
      quotedMessageId = contextInfo.stanzaId;
    }
  }

  // Compute timestamp (Baileys uses seconds, we store as seconds)
  let timestamp: number;
  if (typeof msg.messageTimestamp === "number") {
    timestamp = msg.messageTimestamp;
  } else if (msg.messageTimestamp && typeof (msg.messageTimestamp as any).low === "number") {
    // Long type from protobuf
    timestamp = (msg.messageTimestamp as any).low;
  } else {
    timestamp = Math.floor(Date.now() / 1000);
  }

  return {
    id: key.id ?? `unknown-${Date.now()}`,
    chatId: remoteJid,
    sender,
    senderName: msg.pushName ?? undefined,
    text,
    timestamp,
    isFromMe,
    isGroup,
    quotedMessageId,
    mediaType,
    hasMedia,
    pushName: msg.pushName ?? undefined,
    messageType,
  };
}
