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
import { hostname } from "os";
import type {
  WhatsUpConfig,
  ConnectionStatus,
  StoredMessage,
} from "../shared/types.js";
import { MessageStore } from "./message-store.js";
import {
  initAuthState,
  saveQrCode,
  cleanupQrCode,
  backupCredentials,
  restoreCredentials,
  hasCredentials,
  type AuthState,
} from "./auth.js";
import { getGlobalLogger, audit } from "./logger.js";

// ---- WhatsApp Connection Manager ----

/**
 * Lifecycle event surfaced to the broker so it can (a) push a system channel
 * notification and (b) fire the out-of-band alerter. This is how a dying
 * WhatsApp link tells the operator how to revive it (P0-#2 / P1-#5).
 */
export interface SystemEvent {
  kind:
    | "qr"
    | "pairing_code"
    | "connected"
    | "recovered"
    | "replaced"
    | "deauth"
    | "reconnect_gave_up";
  content: string;
  /** When true, also deliver out-of-band via the secondary channel. */
  alert?: boolean;
  data?: Record<string, unknown>;
}

// After a user-initiated reconnect we refuse to auto-wipe credentials on a
// 401 for this long — that wipe (authDir -> authDir.bak) is exactly the
// cascade the post-mortem hit. Within the window we preserve creds in place
// and flag needsRepair instead.
const RECONNECT_GRACE_MS = 20_000;
// Best-effort pairing-code validity shown to the operator.
const PAIRING_CODE_TTL_MS = 180_000;

export class WhatsAppManager {
  private sock: WASocket | null = null;
  private config: WhatsUpConfig;
  private messageStore: MessageStore;
  private authState: AuthState | null = null;
  private connectionStatus: ConnectionStatus;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private qrHandler?: (qr: string) => void;
  private messageHandler?: (msg: StoredMessage) => void;
  private systemHandler?: (evt: SystemEvent) => void;
  // Phone-number pairing (P0-#1): when set, the next `qr` event issues a
  // pairing code for this number instead of a QR PNG.
  private pendingPairPhone: string | null = null;
  private pairingRequested = false;
  // Suppress the destructive 401 credential wipe until this timestamp (set on
  // every user-initiated forceReconnect). See RECONNECT_GRACE_MS.
  private reconnectGraceUntil = 0;
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
   * @param options.onMessage - Callback invoked for each live (non-history) inbound message.
   *   Fires after the message has been stored in messageStore. Not called during history sync.
   * @returns Current connection status after initial setup
   */
  async connect(options?: {
    onQr?: (qr: string) => void;
    onMessage?: (msg: StoredMessage) => void;
    onSystem?: (evt: SystemEvent) => void;
  }): Promise<ConnectionStatus> {
    const logger = getGlobalLogger();

    this.qrHandler = options?.onQr;
    this.messageHandler = options?.onMessage;
    this.systemHandler = options?.onSystem;
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

    // 4. Create WASocket.
    // browser[1] stays "Chrome" so Baileys' getPlatformId() keeps working for
    // the pairing-code flow; the host name rides in browser[0] so a conflicting
    // linked-device shows which host holds the link (P1-#6 / P2-#9).
    const hostShort = hostname().split(".")[0].slice(0, 24);
    this.sock = makeWASocket({
      auth: {
        creds: this.authState.state.creds,
        keys: makeCacheableSignalKeyStore(this.authState.state.keys, baileysLogger),
      },
      printQRInTerminal: false,
      logger: baileysLogger,
      browser: [`WhatsUp@${hostShort}`, "Chrome", "1.0"],
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
    this.messageHandler = undefined;

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
   * Test-only: merge fields into the live connection status so recovery paths
   * (reconnect guard, needsRepair) can be exercised without a real socket.
   * Only reachable via the WHATSUP_TEST_INJECT-gated broker hook.
   */
  __setTestStatus(partial: Partial<ConnectionStatus>): void {
    Object.assign(this.connectionStatus, partial);
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
   * Force a fresh reconnect. Tears down any existing socket, resets the
   * backoff counter, and re-runs connect() with the same handlers.
   * Use after `reconnectGaveUp` to wake the server back up.
   */
  async forceReconnect(): Promise<ConnectionStatus> {
    const logger = getGlobalLogger();
    logger.info("Force reconnect requested");
    audit("force_reconnect", {});

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignore
      }
      this.sock = null;
    }

    this.reconnectAttempts = 0;
    this.connectionStatus.reconnectAttempts = 0;
    this.connectionStatus.reconnectScheduled = false;
    this.connectionStatus.reconnectGaveUp = false;
    this.connectionStatus.replacedByOtherInstance = false;
    this.connectionStatus.replacedCode = undefined;
    this.connectionStatus.connected = false;

    // Open the no-wipe grace window: if this reconnect closes with a 401, we
    // preserve credentials in place (needsRepair) rather than renaming them
    // aside. This is the direct fix for the post-mortem's deauth cascade.
    this.reconnectGraceUntil = Date.now() + RECONNECT_GRACE_MS;

    return this.connect({
      onQr: this.qrHandler,
      onMessage: this.messageHandler,
      onSystem: this.systemHandler,
    });
  }

  /**
   * Begin a phone-number pairing (P0-#1). Moves any existing credentials aside
   * (recoverable via restore_credentials), then brings up a fresh unregistered
   * socket; the next `qr` event issues an 8-char pairing code for `phone`
   * instead of a QR PNG. Returns the backup path if creds were moved.
   */
  async startPairing(phone: string): Promise<{ backedUp: string | null }> {
    const digits = phone.replace(/[^\d]/g, "");
    if (!digits) throw new Error("A phone number (digits) is required to pair");

    let backedUp: string | null = null;
    // Pairing requires an UNREGISTERED auth dir, or Baileys resumes the old
    // session and never emits a fresh pairing challenge.
    if (hasCredentials(this.config.authDir)) {
      backedUp = await backupCredentials(this.config.authDir);
    }

    this.pendingPairPhone = digits;
    this.pairingRequested = false;
    this.connectionStatus.pairingCode = undefined;
    this.connectionStatus.pairingCodeExpiresAt = undefined;
    this.connectionStatus.pairingPhone = digits;
    this.connectionStatus.needsRepair = true;
    audit("pairing_started", { phone: digits, backedUp });

    await this.forceReconnect();
    return { backedUp };
  }

  /**
   * Restore the most recent credential backup and reconnect (P1-#4).
   * Returns the restored backup path, or null if there was nothing to restore.
   */
  async restoreAndReconnect(): Promise<string | null> {
    const restored = await restoreCredentials(this.config.authDir);
    if (!restored) return null;
    this.connectionStatus.needsRepair = false;
    this.connectionStatus.deauthRisk = undefined;
    await this.forceReconnect();
    return restored;
  }

  /** Emit a lifecycle event to the broker (system push + optional alert). */
  private emitSystem(evt: SystemEvent): void {
    if (!this.systemHandler) return;
    try {
      this.systemHandler(evt);
    } catch {
      /* handler errors must never break the connection lifecycle */
    }
  }

  /** Operator-facing instructions used on any deauth. */
  private repairInstructions(code: number | string): string {
    const phone = this.config.pairPhone;
    return [
      `WhatsApp link lost (disconnect ${code}). This channel is down.`,
      ``,
      `From this host, choose one:`,
      `  • restore_credentials — self-heals a spurious drop from the newest backup.`,
      phone
        ? `  • pair_request — issues a phone pairing code (delivered here + to your alert channel).`
        : `  • pair_request({ phone: "<your number, digits>" }) — issues a phone pairing code.`,
      ``,
      `Enter the code in WhatsApp → Settings → Linked Devices → Link a Device →`,
      `"Link with phone number instead".`,
    ].join("\n");
  }

  /**
   * Handle a credential-invalidating disconnect (genuine logout, or a 401
   * inside the reconnect grace window). Never lets a user-initiated reconnect
   * silently wipe creds; auto-repairs only when explicitly enabled.
   */
  private async onDeauth(opts: {
    code: number | string;
    reason: string;
    preserveInPlace: boolean;
  }): Promise<void> {
    const logger = getGlobalLogger();
    this.connectionStatus.authenticated = false;
    this.connectionStatus.phone = undefined;
    this.connectionStatus.pushName = undefined;
    this.connectionStatus.needsRepair = true;
    this.connectionStatus.reconnectScheduled = false;

    const autoRepair = this.config.autoRepair && !!this.config.pairPhone;

    // Back up (clearing the live dir) when auto-repairing (a fresh pairing
    // needs an unregistered dir) or on a genuine logout (defense in depth).
    // Preserve-in-place only when asked AND not auto-repairing — that keeps
    // restore_credentials a no-op rename.
    let backupPath: string | null = null;
    if (autoRepair || !opts.preserveInPlace) {
      try {
        backupPath = await backupCredentials(this.config.authDir);
      } catch (err: any) {
        logger.error("Failed to back up credentials on deauth", { error: err?.message });
      }
    }

    audit("deauth", {
      code: opts.code,
      reason: opts.reason,
      preserveInPlace: opts.preserveInPlace,
      autoRepair,
      backupPath,
    });

    if (autoRepair) {
      this.connectionStatus.deauthRisk = "auto-repair in progress — pairing code incoming";
      this.emitSystem({
        kind: "deauth",
        alert: true,
        content: `WhatsApp link lost (${opts.code}). Auto-repair is enabled — issuing a new pairing code…`,
        data: { code: opts.code, reason: opts.reason, backupPath },
      });
      this.startPairing(this.config.pairPhone).catch((err: any) =>
        logger.error("Auto-repair pairing failed", { error: err?.message })
      );
      return;
    }

    this.connectionStatus.deauthRisk = opts.preserveInPlace
      ? "credentials preserved in place — call restore_credentials or pair_request"
      : `credentials backed up${backupPath ? ` to ${backupPath}` : ""} — call restore_credentials or pair_request`;
    this.emitSystem({
      kind: "deauth",
      alert: true,
      content: this.repairInstructions(opts.code),
      data: { code: opts.code, reason: opts.reason, backupPath },
    });
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

      // QR / pairing challenge received. The `qr` event fires exactly when the
      // websocket is open and the account is unregistered — the correct moment
      // to request a phone pairing code (P0-#1). If a pair is pending, issue a
      // code and skip the GUI-bound QR PNG entirely.
      if (qr) {
        if (this.pendingPairPhone && !this.pairingRequested && this.sock) {
          this.pairingRequested = true;
          const digits = this.pendingPairPhone;
          try {
            const raw = await this.sock.requestPairingCode(digits);
            const code =
              raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
            this.connectionStatus.pairingCode = code;
            this.connectionStatus.pairingPhone = digits;
            this.connectionStatus.pairingCodeExpiresAt = Date.now() + PAIRING_CODE_TTL_MS;
            logger.info("Pairing code issued", { phone: digits });
            audit("pairing_code_issued", { phone: digits });
            this.emitSystem({
              kind: "pairing_code",
              alert: true,
              content: [
                `WhatsApp pairing code: ${code}`,
                ``,
                `On the phone for +${digits}: WhatsApp → Settings → Linked Devices →`,
                `Link a Device → "Link with phone number instead" → enter the code.`,
                `Expires in ~${Math.round(PAIRING_CODE_TTL_MS / 60000)} min; check with pair_status.`,
              ].join("\n"),
              data: { code, phone: digits },
            });
          } catch (err: any) {
            // Fall back to QR so the operator is never left with nothing.
            this.pairingRequested = false;
            this.pendingPairPhone = null;
            logger.error("requestPairingCode failed — falling back to QR", {
              error: err?.message,
            });
            try {
              await saveQrCode(qr, this.config.qrCodeFile);
            } catch {
              /* ignore */
            }
            this.emitSystem({
              kind: "qr",
              alert: true,
              content: `Pairing-code request failed (${err?.message ?? "unknown"}). Fell back to QR: ${this.config.qrCodeFile}`,
              data: { qrCodeFile: this.config.qrCodeFile },
            });
          }
          return;
        }

        logger.info("QR code received, scan to authenticate");
        audit("qr_received", {});

        try {
          await saveQrCode(qr, this.config.qrCodeFile);
        } catch (err: any) {
          logger.error("Failed to save QR code file", { error: err?.message });
        }

        this.emitSystem({
          kind: "qr",
          alert: true,
          content: [
            `WhatsApp pairing required. QR written to ${this.config.qrCodeFile}.`,
            this.config.pairPhone
              ? `No GUI? Call pair_request for a phone pairing code instead.`
              : `No GUI? Call pair_request({ phone: "<your number>" }) for a code instead.`,
          ].join("\n"),
          data: { qrCodeFile: this.config.qrCodeFile },
        });

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
        // Was the link previously in any degraded/down state? Drives whether
        // we emit a "recovered" alert vs a first-time "connected" event.
        const wasDown =
          !!this.connectionStatus.needsRepair ||
          !!this.connectionStatus.replacedByOtherInstance ||
          !!this.connectionStatus.reconnectGaveUp ||
          this.connectionStatus.lastDisconnected != null;

        this.connectionStatus.connected = true;
        this.connectionStatus.authenticated = true;
        this.connectionStatus.lastConnected = Date.now();
        this.connectionStatus.reconnectAttempts = 0;
        this.connectionStatus.reconnectScheduled = false;
        this.connectionStatus.reconnectGaveUp = false;
        this.connectionStatus.replacedByOtherInstance = false;
        this.connectionStatus.replacedCode = undefined;
        this.connectionStatus.needsRepair = false;
        this.connectionStatus.deauthRisk = undefined;
        this.reconnectAttempts = 0;
        this.reconnectGraceUntil = 0;

        // Pairing (if any) completed — clear the pending code state.
        this.pendingPairPhone = null;
        this.pairingRequested = false;
        this.connectionStatus.pairingCode = undefined;
        this.connectionStatus.pairingCodeExpiresAt = undefined;
        this.connectionStatus.pairingPhone = undefined;

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

        this.emitSystem({
          kind: wasDown ? "recovered" : "connected",
          alert: wasDown,
          content: wasDown
            ? `WhatsApp link recovered — connected as ${this.connectionStatus.phone ?? "unknown"}.`
            : `WhatsApp connected as ${this.connectionStatus.phone ?? "unknown"}.`,
          data: { phone: this.connectionStatus.phone },
        });
      }

      // Connection closed
      if (connection === "close") {
        this.connectionStatus.connected = false;

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message ?? "unknown";

        this.connectionStatus.lastDisconnected = Date.now();
        this.connectionStatus.lastDisconnectCode = statusCode ?? "unknown";
        this.connectionStatus.lastDisconnectReason = errorMessage;

        logger.warn("WhatsApp connection closed", {
          statusCode,
          error: errorMessage,
        });
        audit("connection_close", { statusCode, error: errorMessage });

        if (statusCode === DisconnectReason.loggedOut) {
          // Baileys/WhatsApp maps any 401 to DisconnectReason.loggedOut, but
          // the wire-level reason string distinguishes two semantically
          // different events:
          //   (a) genuine user-initiated unlink from the phone -- terminal.
          //   (b) server-side session conflict / sibling-device displacement
          //       -- often spurious and recoverable.
          // Case (b) shows up as "Stream Errored (conflict)" or similar
          // "replaced" wording. Neither case wipes creds here anymore —
          // (b) yields to the external session; (a) routes through onDeauth,
          // which never wipes during a user-initiated reconnect grace window.
          const conflictLike = /conflict|replaced/i.test(errorMessage);
          const inReconnectGrace = Date.now() < this.reconnectGraceUntil;

          if (conflictLike) {
            // Recoverable takeover. Creds are preserved; do NOT reconnect
            // automatically (it can ping-pong or, worse, tip into a real 401
            // that wipes). Surface the deauth risk so the reconnect tool and
            // status stop nudging toward a dangerous retake.
            this.connectionStatus.replacedByOtherInstance = true;
            this.connectionStatus.replacedCode = 401;
            this.connectionStatus.reconnectScheduled = false;
            this.connectionStatus.deauthRisk =
              "link taken over with a 401 auth conflict — reconnecting risks a full deauth; re-pair (pair_request) or wait it out";
            logger.warn(
              "401 conflict — external takeover; NOT auto-reconnecting (reconnect is unsafe here)",
              { statusCode, error: errorMessage }
            );
            audit("connection_replaced_external", {
              statusCode,
              error: errorMessage,
              reclassifiedFrom: "loggedOut",
            });
            this.emitSystem({
              kind: "replaced",
              alert: true,
              content:
                "WhatsApp link taken over by another session (401 conflict). Not auto-reconnecting — reconnecting can trigger a full deauth. Re-pair with pair_request if it doesn't recover on its own.",
              data: { code: 401, reason: errorMessage },
            });
          } else {
            // Genuine logout. onDeauth handles it safely: during a reconnect
            // grace window we PRESERVE creds in place (the post-mortem's
            // cascade fix); otherwise we back up (defense in depth). Either
            // way we flag needsRepair and push re-pair instructions.
            if (inReconnectGrace) {
              logger.warn(
                "401 during reconnect grace window — preserving credentials in place (no wipe)",
                { statusCode, error: errorMessage }
              );
            } else {
              logger.warn("Logged out from WhatsApp (401)", { error: errorMessage });
              audit("logged_out", {});
            }
            await this.onDeauth({
              code: statusCode,
              reason: errorMessage,
              preserveInPlace: inReconnectGrace,
            });
          }
        } else if (statusCode === DisconnectReason.connectionReplaced) {
          // 440 connectionReplaced: this process is the sole owner of the
          // WhatsApp socket, so the replacer is an EXTERNAL WhatsApp Web /
          // phone / linked-device session. Auto-reconnecting would just
          // ping-pong with that external session, so we yield and surface a
          // distinct status. Unlike the 401 case, a 440 retake does NOT risk
          // a credential wipe, so reconnect stays allowed here.
          this.connectionStatus.replacedByOtherInstance = true;
          this.connectionStatus.replacedCode = 440;
          this.connectionStatus.reconnectScheduled = false;
          logger.warn(
            "Connection replaced by another session (440) — not auto-reconnecting"
          );
          audit("connection_replaced_external", { statusCode: 440 });
          this.emitSystem({
            kind: "replaced",
            alert: true,
            content:
              "WhatsApp connection replaced by another session (440). Safe to retake: call reconnect.",
            data: { code: 440, reason: errorMessage },
          });
        } else if (this.config.autoReconnect) {
          // Attempt reconnect for ordinary disconnects (network blips, 515
          // restartRequired, etc.)
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
          // Keep the raw Baileys WAMessage so download_attachment can use it
          this.messageStore.putRaw(stored.id, msg);

          if (type === "notify") {
            logger.info("Message received", {
              id: stored.id,
              chatId: stored.chatId,
              sender: stored.sender,
              isFromMe: stored.isFromMe,
              messageType: stored.messageType,
              hasText: !!stored.text,
            });

            // Push live messages to subscribers (e.g. MCP channel notifications).
            // Do NOT push history-sync messages — that would flood Claude on reconnect.
            if (this.messageHandler) {
              try {
                this.messageHandler(stored);
              } catch (err: any) {
                logger.warn("messageHandler threw", { error: err?.message });
              }
            }
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

      // Record backfill stats so status/health can show that history synced
      // after a re-pair/reconnect (P1-#7).
      this.connectionStatus.lastHistorySync = {
        at: Date.now(),
        chats: histChats.length,
        contacts: histContacts.length,
        messages: histMessages.length,
      };

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
      this.connectionStatus.reconnectScheduled = false;
      this.connectionStatus.reconnectGaveUp = true;
      audit("reconnect_failed", { attempts: this.reconnectAttempts });
      this.emitSystem({
        kind: "reconnect_gave_up",
        alert: true,
        content: `WhatsApp reconnect gave up after ${this.reconnectAttempts} attempts. Call reconnect to retry, or restore_credentials / pair_request if the link is gone.`,
        data: { attempts: this.reconnectAttempts, lastReason: this.connectionStatus.lastDisconnectReason },
      });
      return;
    }

    const delayMs = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      MAX_DELAY_MS
    );
    this.reconnectAttempts++;
    this.connectionStatus.reconnectAttempts = this.reconnectAttempts;
    this.connectionStatus.reconnectScheduled = true;

    logger.info("Scheduling reconnect", {
      attempt: this.reconnectAttempts,
      delayMs,
    });
    audit("reconnect_scheduled", { attempt: this.reconnectAttempts, delayMs });

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        logger.info("Reconnecting to WhatsApp...", { attempt: this.reconnectAttempts });
        await this.connect({
          onQr: this.qrHandler,
          onMessage: this.messageHandler,
          onSystem: this.systemHandler,
        });
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
