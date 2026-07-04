// ---- Error Codes ----

export enum ErrorCode {
  NOT_AUTHENTICATED = "NOT_AUTHENTICATED",
  CONTACT_NOT_ALLOWLISTED = "CONTACT_NOT_ALLOWLISTED",
  SEND_FAILED = "SEND_FAILED",
  POLL_TIMEOUT = "POLL_TIMEOUT",
  SOCKET_ERROR = "SOCKET_ERROR",
  PROXY_NOT_RUNNING = "PROXY_NOT_RUNNING",
  PROXY_START_FAILED = "PROXY_START_FAILED",
  INVALID_ARGUMENT = "INVALID_ARGUMENT",
  COMMAND_DISABLED = "COMMAND_DISABLED",
  RATE_LIMITED = "RATE_LIMITED",
  MEDIA_TOO_LARGE = "MEDIA_TOO_LARGE",
  MEDIA_NOT_FOUND = "MEDIA_NOT_FOUND",
  PATH_BLOCKED = "PATH_BLOCKED",
  GROUP_NOT_ALLOWLISTED = "GROUP_NOT_ALLOWLISTED",
  NOT_CONNECTED = "NOT_CONNECTED",
  TIMEOUT = "TIMEOUT",
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  DAEMON_UNREACHABLE = "DAEMON_UNREACHABLE",
  PAIRING_FAILED = "PAIRING_FAILED",
  REPAIR_REQUIRED = "REPAIR_REQUIRED",
  ALERT_NOT_CONFIGURED = "ALERT_NOT_CONFIGURED",
}

// ---- API Response ----

export interface ApiResponse {
  ok: boolean;
  error?: string;
  code?: ErrorCode;
  hint?: string;
  warning?: string;
  [key: string]: any;
}

// ---- Configuration ----

export interface WhatsUpConfig {
  authDir: string;
  allowlist: string[];           // E.164 phone numbers
  allowlistGroups: string[];     // group JIDs
  logFile: string;
  auditLog: string;              // defaults to ~/.config/whatsup/audit.jsonl
  disabledCommands: string[];
  messageBufferSize: number;
  mediaDownloadDir: string;
  autoReconnect: boolean;
  qrCodeFile: string;
  readMode: "allowlist" | "all";
  rateLimitPerContact: number;   // msgs/minute
  rateLimitTotal: number;        // msgs/minute
  maxMediaSize: number;          // bytes
  historyFile: string;           // JSONL persistent message log
  historyRetentionDays: number;  // prune entries older than this on startup
  historyLoadLimit: number;      // how many recent entries to load into the in-memory buffer
  daemonSocketFile: string;      // Unix socket the in-process owner listens on
  // Secondary, WhatsApp-independent channel for out-of-band alerts (deauth,
  // pairing code, replaced, reconnect-gave-up). Empty = disabled.
  alertWebhookUrl: string;
  // The operator's own WhatsApp number (digits, no +) used by the pairing-code
  // re-pair flow. Locks pair_request to this number so a prompt-injected
  // channel message cannot aim it. Empty = must be passed explicitly.
  pairPhone: string;
  // When true, a genuine deauth auto-issues a pairing code and pushes it to the
  // alert channel (requires pairPhone). Off by default — pairing is sensitive.
  autoRepair: boolean;
}

// Config entry with source tracking
export type ConfigSource = "default" | "user" | "repo" | "env";

export interface ResolvedConfigEntry<T> {
  value: T;
  source: ConfigSource;
}

export type ResolvedConfig = {
  [K in keyof WhatsUpConfig]: ResolvedConfigEntry<WhatsUpConfig[K]>;
};

// ---- Message Store ----

export interface StoredMessage {
  id: string;
  chatId: string;
  sender: string;
  senderName?: string;
  text?: string;
  timestamp: number;
  isFromMe: boolean;
  isGroup: boolean;
  quotedMessageId?: string;
  mediaType?: "image" | "video" | "audio" | "document" | "sticker";
  mediaUrl?: string;
  hasMedia: boolean;
  pushName?: string;
  messageType: string;  // the baileys message type
}

// ---- Chat Info ----

export interface ChatInfo {
  id: string;
  name?: string;
  isGroup: boolean;
  lastMessage?: string;
  lastMessageTimestamp?: number;
  unreadCount: number;
}

// ---- Contact Info ----

export interface ContactInfo {
  id: string;
  name?: string;
  pushName?: string;
  phone?: string;
  isGroup: boolean;
}

// ---- Connection Status ----

export interface ConnectionStatus {
  connected: boolean;
  authenticated: boolean;
  phone?: string;
  pushName?: string;
  lastConnected?: number;
  lastDisconnected?: number;
  lastDisconnectCode?: number | string;
  lastDisconnectReason?: string;
  reconnectAttempts?: number;
  reconnectScheduled?: boolean;
  reconnectGaveUp?: boolean;
  // Set when a 440 connectionReplaced arrives — an external WhatsApp Web /
  // phone session took the socket from the owner. We deliberately do NOT
  // auto-reconnect (it would ping-pong); the reconnect tool clears this.
  replacedByOtherInstance?: boolean;
  // The disconnect code that put us into the replaced state (401 = auth-level
  // conflict, dangerous to reconnect; 440 = plain connectionReplaced, safe to
  // retake). Lets the reconnect tool refuse only the dangerous case.
  replacedCode?: number | string;
  // True once we're in a state that needs a deliberate re-pair (genuine
  // deauth, or a 401 during a reconnect grace window). While set, `reconnect`
  // is unsafe — the operator should re-pair (pair_request) or restore.
  needsRepair?: boolean;
  // Human-facing risk note when reconnect could trigger a credential wipe.
  deauthRisk?: string;
  // Pending phone-number pairing code (P0-#1). Present only between
  // pair_request and successful pairing; cleared on connection open.
  pairingCode?: string;
  pairingCodeExpiresAt?: number;
  // The number pairing is currently being requested for (digits, no +).
  pairingPhone?: string;
  // Stats from the most recent messaging-history.set sync (backfill on
  // re-pair / reconnect). Lets `health`/`status` show that history synced.
  lastHistorySync?: { at: number; chats: number; contacts: number; messages: number };
}

// ---- Security Warnings ----

export type SecurityWarning = {
  field: string;
  message: string;
};
