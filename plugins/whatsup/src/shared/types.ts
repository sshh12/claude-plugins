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
}

// ---- Exit Codes ----

export enum ExitCode {
  SUCCESS = 0,
  USAGE_ERROR = 1,
  PROXY_ERROR = 2,
  SOCKET_ERROR = 3,
  ALLOWLIST_BLOCKED = 4,
}

// ---- API Response ----

export interface ApiResponse {
  ok: boolean;
  error?: string;
  code?: ErrorCode;
  hint?: string;
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
}

// ---- Poll Result ----

export interface PollResult {
  ok: boolean;
  messages: StoredMessage[];
  timedOut: boolean;
}

// ---- Security Warnings ----

export type SecurityWarning = {
  field: string;
  message: string;
};
