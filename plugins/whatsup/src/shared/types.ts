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
  STANDBY = "STANDBY",
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
  proxyPort: number;
  authDir: string;
  allowlist: string[];           // E.164 phone numbers
  allowlistGroups: string[];     // group JIDs
  idleTimeout: number;           // seconds
  logFile: string;
  auditLog: string;              // defaults to ~/.config/whatsup/audit.jsonl
  disabledCommands: string[];
  messageBufferSize: number;
  mediaDownloadDir: string;
  pollTimeout: number;           // seconds
  autoReconnect: boolean;
  qrCodeFile: string;
  readMode: "allowlist" | "all";
  rateLimitPerContact: number;   // msgs/minute
  rateLimitTotal: number;        // msgs/minute
  maxMediaSize: number;          // bytes
  historyFile: string;           // JSONL persistent message log
  historyRetentionDays: number;  // prune entries older than this on startup
  historyLoadLimit: number;      // how many recent entries to load into the in-memory buffer
  connectorLockFile: string;     // heartbeat lease lock — only the holder opens a WA socket
}

// Which role this MCP process plays for the shared WhatsApp connection.
// "connector" holds the lease and owns the single socket; "standby" does not
// open a socket and serves read-only tools off the on-disk history.
export type ConnectorRole = "connector" | "standby";

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
  // Set when a 440 connectionReplaced arrives while we hold the connector
  // lease — i.e. an external WhatsApp Web/phone session stole the socket.
  // We deliberately do NOT auto-reconnect; the reconnect tool clears this.
  replacedByOtherInstance?: boolean;
}

// ---- Security Warnings ----

export type SecurityWarning = {
  field: string;
  message: string;
};
