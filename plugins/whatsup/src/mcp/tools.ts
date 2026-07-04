import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { downloadMediaMessage } from "baileys";
import type { WAMessage } from "baileys";
import type { ApiResponse, WhatsUpConfig } from "../shared/types.js";
import { ErrorCode } from "../shared/types.js";
import type { WhatsAppManager } from "../proxy/whatsapp.js";
import type { MessageStore } from "../proxy/message-store.js";
import type { RateLimiter } from "../proxy/rate-limiter.js";
import { enforceWriteAllowlist, phoneToJid } from "../proxy/allowlist.js";
import { hasCredentials, listCredentialBackups } from "../proxy/auth.js";
import type { Alerter } from "../proxy/alerter.js";
import { audit, getGlobalLogger } from "../proxy/logger.js";
import { handleSend } from "../proxy/handlers/send.js";
import { handleSendMedia } from "../proxy/handlers/send-media.js";
import { handleReact } from "../proxy/handlers/react.js";
import { handleEdit } from "../proxy/handlers/edit.js";
import { handleReadChat } from "../proxy/handlers/read-chat.js";
import { handleListChats } from "../proxy/handlers/list-chats.js";
import { handleContacts } from "../proxy/handlers/contacts.js";
import { handleSearch } from "../proxy/handlers/search.js";
import { filterMessageForOutput } from "../proxy/allowlist.js";
import { appendMessage as appendHistoryMessage } from "../proxy/history-store.js";
import type { StoredMessage } from "../shared/types.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ToolCtx {
  wa: WhatsAppManager;
  config: WhatsUpConfig;
  messageStore: MessageStore;
  rateLimiter: RateLimiter;
  // Secondary, WhatsApp-independent out-of-band channel (for the `alert` tool
  // and status/health reporting of whether it's configured).
  alerter: Alerter;
  // The broker daemon builds one ToolCtx per request; this surfaces the
  // daemon's own pid/uptime for the `status` tool.
  daemonInfo: () => { pid: number; uptimeSec: number };
}

// ---- Definitions surfaced to the MCP client ----

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "reply",
    description:
      "Send a WhatsApp message. Pass chat_id from an inbound channel notification. Optionally attach files (absolute paths) and quote-reply to a message id. Only allowlisted contacts/groups can receive messages.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: {
          type: "string",
          description: "Destination JID (e.g. 18005551234@s.whatsapp.net) or E.164 phone (+18005551234).",
        },
        text: { type: "string", description: "Message text. Optional when files are provided." },
        reply_to: {
          type: "string",
          description: "Optional message_id from inbound channel meta to quote-reply.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Optional absolute file paths to attach. Images send as photos, others as documents.",
        },
      },
      required: ["chat_id"],
    },
  },
  {
    name: "react",
    description:
      "Add an emoji reaction to a WhatsApp message. Pass empty emoji to remove your existing reaction.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: "string" },
        message_id: { type: "string" },
        emoji: { type: "string", description: 'Single emoji, or "" to clear.' },
      },
      required: ["chat_id", "message_id", "emoji"],
    },
  },
  {
    name: "edit_message",
    description: "Edit a message this account previously sent. Only works on the account's own messages.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: "string" },
        message_id: { type: "string" },
        text: { type: "string" },
      },
      required: ["chat_id", "message_id", "text"],
    },
  },
  {
    name: "download_attachment",
    description:
      "Download a media attachment from an inbound WhatsApp message to the local media directory. Use when inbound channel meta has attachment_file_id. Returns the local file path ready to Read.",
    inputSchema: {
      type: "object",
      properties: {
        file_id: {
          type: "string",
          description: "The attachment_file_id (== message_id) from the inbound channel meta.",
        },
      },
      required: ["file_id"],
    },
  },
  {
    name: "status",
    description:
      "Get WhatsApp connection state. Returns connected, authenticated, phone, pushName, hasCredentials, the QR file path if pairing is pending, any pending pairingCode, reconnect diagnostics (lastDisconnectReason, reconnectAttempts, reconnectScheduled, reconnectGaveUp), needsRepair + deauthRisk (a re-pair is required; reconnect is unsafe), replacedByOtherInstance + replacedCode (401 = do NOT reconnect, 440 = safe retake), lastHistorySync, alertChannelConfigured, and the shared broker daemon's pid/uptime.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "reconnect",
    description:
      "Force a fresh WhatsApp socket. Safe for ordinary drops (connected=false, authenticated=true) and 440 connectionReplaced. REFUSES by default when the link was taken over with a 401 auth conflict (replacedByOtherInstance with replacedCode=401) — reconnecting there can trigger a full credential deauth. Re-pair with pair_request instead, or pass force=true to override.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description: "Override the 401-conflict refusal. Reconnecting in that state risks wiping credentials.",
        },
      },
    },
  },
  {
    name: "pair_request",
    description:
      "Link this device to WhatsApp with an 8-character phone pairing code — no QR, no GUI. Issues a code for your own WhatsApp number; enter it on the phone under WhatsApp → Settings → Linked Devices → Link a Device → \"Link with phone number instead\". If WHATSUP_PAIR_PHONE is set, phone is optional and locked to that number. Moves any existing credentials aside (recoverable via restore_credentials).",
    inputSchema: {
      type: "object",
      properties: {
        phone: {
          type: "string",
          description: "Your WhatsApp number in digits/E.164 (e.g. 18005551234). Optional when WHATSUP_PAIR_PHONE is configured.",
        },
      },
    },
  },
  {
    name: "pair_status",
    description:
      "Check an in-progress phone pairing: returns the current pairingCode (if any), whether credentials now exist, connection state, and lastPairError if the previous attempt was rejected. Poll after pair_request until connected=true.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "qr_request",
    description:
      "Bring up a fresh, rotating QR for scanning (fallback when phone-code pairing fails). WhatsApp stops rotating the QR once a pairing code is requested, so use this to get a live QR back. Writes to qrCodeFile and keeps it refreshed (~every 20s); status reports qrGeneratedAt/qrAgeSec so you can tell it's fresh.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "restore_credentials",
    description:
      "Self-heal a spurious deauth: restore the most recent credential backup and reconnect. No-op if live credentials are already present. Try this before pair_request when a drop may have been spurious.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "reset_credentials",
    description:
      "Clean slate for pairing: back up a completed session (or delete half-finished pairing leftovers) and bring up a fresh unregistered socket, ready for pair_request or qr_request. No deauth risk — a real session is preserved as a backup, never destroyed. Use when pairing is stuck in a failure loop.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "health",
    description:
      "One-call send-path + receive-path + auth health check. Reports overall health, ready/connected/authenticated, credential + pairing state, last inbound/outbound activity, last history sync, buffered message count, and whether the out-of-band alert channel is configured. Read-only — sends no message.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "alert",
    description:
      "Send a message to the operator over the secondary, WhatsApp-independent channel (the configured alert webhook). Use to reach the operator when WhatsApp itself is down, instead of shelling out to say/osascript. Fails with ALERT_NOT_CONFIGURED if no webhook is set.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Message to deliver out-of-band." },
      },
      required: ["text"],
    },
  },
  {
    name: "unreplied",
    description:
      "List inbound messages received this session that haven't been replied to. Use on session start to catch up after a restart.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: "string", description: "Optional filter to a single chat." },
      },
    },
  },
  {
    name: "list_chats",
    description: "List recent chats with their last-message timestamps and unread counts.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        unread_only: { type: "boolean" },
      },
    },
  },
  {
    name: "read_chat",
    description: "Read recent messages from a chat. Returns messages from the in-memory buffer.",
    inputSchema: {
      type: "object",
      properties: {
        chat_id: { type: "string" },
        limit: { type: "number" },
        before: { type: "string", description: "Message id to read before (paging)." },
      },
      required: ["chat_id"],
    },
  },
  {
    name: "search",
    description: "Search message text across the in-memory buffer. Returns matching messages.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        chat: { type: "string" },
        from: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "contacts",
    description: "List or search the contact cache.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "subscribe",
    description:
      "Start receiving inbound WhatsApp messages on this session's channel. The shared broker daemon delivers live messages only to sessions that have subscribed, so call this once (after `status`) if this agent is the one handling WhatsApp. Idempotent.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "unsubscribe",
    description:
      "Stop receiving inbound WhatsApp messages on this session's channel. Other sessions are unaffected. You can still send and use read tools.",
    inputSchema: { type: "object", properties: {} },
  },
];

// ---- Wrapper plumbing ----

function normalizeTarget(to: string): string {
  if (to.startsWith("+") || /^\d+$/.test(to)) return phoneToJid(to);
  return to;
}

function checkDisabled(commandName: string, config: WhatsUpConfig): ApiResponse | null {
  if (!config.disabledCommands.includes(commandName)) return null;
  audit("command_disabled", { command: commandName });
  return {
    ok: false,
    error: `Command "${commandName}" is disabled by security policy`,
    code: ErrorCode.COMMAND_DISABLED,
  };
}

function checkConnected(wa: WhatsAppManager): ApiResponse | null {
  if (wa.isReady()) return null;
  const status = wa.getStatus();
  // Differentiate "never paired" from "paired but socket dropped" from
  // "needs a deliberate re-pair" so Claude and the user act on the right thing.
  if (!status.authenticated) {
    return {
      ok: false,
      error: "WhatsApp not paired",
      code: ErrorCode.NOT_AUTHENTICATED,
      hint: "Call pair_request for a phone pairing code (no QR/GUI needed), or status for the QR file path.",
    };
  }
  // Dangerous 401 takeover: do NOT nudge toward reconnect (that's what wiped
  // creds in the incident).
  if (status.replacedByOtherInstance && status.replacedCode === 401) {
    return {
      ok: false,
      error: "WhatsApp link was taken over with a 401 auth conflict",
      code: ErrorCode.REPAIR_REQUIRED,
      hint:
        status.deauthRisk ??
        "Do not reconnect (it risks a full deauth). Re-pair with pair_request, or wait for it to recover.",
    };
  }
  if (status.needsRepair) {
    return {
      ok: false,
      error: "WhatsApp link needs re-pairing",
      code: ErrorCode.REPAIR_REQUIRED,
      hint:
        status.deauthRisk ??
        "Call restore_credentials (self-heals a spurious drop) or pair_request (phone pairing code).",
    };
  }
  if (status.reconnectGaveUp) {
    return {
      ok: false,
      error: "WhatsApp socket disconnected and reconnect gave up",
      code: ErrorCode.NOT_CONNECTED,
      hint: "Call reconnect. If it stays down, the device may be unlinked — restore_credentials or pair_request.",
    };
  }
  return {
    ok: false,
    error: "WhatsApp socket is not currently connected",
    code: ErrorCode.NOT_CONNECTED,
    hint: status.reconnectScheduled
      ? `Reconnect attempt ${status.reconnectAttempts ?? 0} in flight — retry shortly. Last disconnect: ${status.lastDisconnectReason ?? "unknown"}.`
      : "Call the reconnect tool to wake the socket.",
  };
}

async function runWrite(
  ctx: ToolCtx,
  commandName: string,
  target: string,
  fn: () => Promise<ApiResponse>
): Promise<ApiResponse> {
  const disabled = checkDisabled(commandName, ctx.config);
  if (disabled) return disabled;

  const conn = checkConnected(ctx.wa);
  if (conn) return conn;

  const blocked = enforceWriteAllowlist(target, ctx.config);
  if (blocked) return blocked;

  const limited = ctx.rateLimiter.check(target);
  if (limited) return limited;

  const start = Date.now();
  try {
    const result = await fn();
    if (result.ok) ctx.rateLimiter.record(target);
    audit("command", {
      command: commandName,
      target,
      ok: result.ok,
      duration: Date.now() - start,
    });
    return result;
  } catch (err: any) {
    const message = err?.message ?? String(err);
    audit("command_error", { command: commandName, target, error: message });
    return { ok: false, error: message, code: ErrorCode.SEND_FAILED };
  }
}

async function runRead(
  ctx: ToolCtx,
  commandName: string,
  fn: () => Promise<ApiResponse>
): Promise<ApiResponse> {
  const disabled = checkDisabled(commandName, ctx.config);
  if (disabled) return disabled;

  const conn = checkConnected(ctx.wa);
  if (conn) return conn;

  const start = Date.now();
  try {
    const result = await fn();
    audit("command", {
      command: commandName,
      ok: result.ok,
      duration: Date.now() - start,
    });
    return result;
  } catch (err: any) {
    const message = err?.message ?? String(err);
    audit("command_error", { command: commandName, error: message });
    return { ok: false, error: message, code: ErrorCode.SOCKET_ERROR };
  }
}

// ---- Tool dispatch ----

export async function callTool(
  ctx: ToolCtx,
  name: string,
  args: Record<string, any>
): Promise<ApiResponse> {
  switch (name) {
    case "reply":
      return callReply(ctx, args);
    case "react":
      return callReact(ctx, args);
    case "edit_message":
      return callEdit(ctx, args);
    case "download_attachment":
      return callDownload(ctx, args);
    case "status":
      return callStatus(ctx);
    case "reconnect":
      return callReconnect(ctx, args);
    case "pair_request":
      return callPairRequest(ctx, args);
    case "pair_status":
      return callPairStatus(ctx);
    case "qr_request":
      return callQrRequest(ctx);
    case "restore_credentials":
      return callRestore(ctx);
    case "reset_credentials":
      return callReset(ctx);
    case "health":
      return callHealth(ctx);
    case "alert":
      return callAlert(ctx, args);
    case "unreplied":
      return callUnreplied(ctx, args);
    case "list_chats":
      return callListChats(ctx, args);
    case "read_chat":
      return callReadChat(ctx, args);
    case "search":
      return callSearch(ctx, args);
    case "contacts":
      return callContacts(ctx, args);
    case "subscribe":
    case "unsubscribe":
      // Connection-scoped: the broker daemon intercepts these at the IPC
      // layer and they never reach callTool. This is only a safety net.
      return { ok: true, note: `${name} is handled by the broker daemon` };
    default:
      return { ok: false, error: `Unknown tool: ${name}`, code: ErrorCode.INVALID_ARGUMENT };
  }
}

// ---- Tool implementations ----

async function callReply(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  const chatId = String(args.chat_id ?? "");
  if (!chatId) {
    return { ok: false, error: "chat_id is required", code: ErrorCode.INVALID_ARGUMENT };
  }
  const target = normalizeTarget(chatId);
  const text: string | undefined = args.text;
  const replyTo: string | undefined = args.reply_to;
  const files: string[] = Array.isArray(args.files) ? args.files : [];

  if (!text && files.length === 0) {
    return {
      ok: false,
      error: "Either text or files is required",
      code: ErrorCode.INVALID_ARGUMENT,
    };
  }

  // Resolve the full raw message to quote. Baileys needs the whole WAMessage
  // (it carries key.participant for groups); a bare { key } shape crashes
  // generateWAMessage. If the message isn't in the in-session raw buffer
  // (evicted, or from a prior session), fail soft: send without the quote and
  // surface a warning rather than throwing SEND_FAILED.
  let quotedMsg: WAMessage | undefined;
  let quoteWarning: string | undefined;
  if (replyTo) {
    quotedMsg = ctx.messageStore.getRaw(replyTo);
    if (!quotedMsg) {
      quoteWarning =
        `Could not quote message ${replyTo}: not in the in-session raw buffer ` +
        `(evicted or from a prior session). Message sent without the quoted reply.`;
    }
  }

  const sentIds: string[] = [];

  // Files first, then text — text doubles as caption only when there's a single file
  // and no separate text-only message is intended. Keep it simple: text is its own message.
  for (const path of files) {
    const result = await runWrite(ctx, "send-media", target, () =>
      handleSendMedia(ctx.wa, ctx.config, {
        to: target,
        path,
        caption: !text && files.length === 1 ? undefined : undefined,
        quote: quotedMsg,
      })
    );
    if (!result.ok) return result;
    if (result.messageId) sentIds.push(result.messageId);
  }

  if (text) {
    const result = await runWrite(ctx, "send", target, () =>
      handleSend(ctx.wa, ctx.config, {
        to: target,
        message: text,
        quote: files.length === 0 ? quotedMsg : undefined,
      })
    );
    if (!result.ok) return result;
    if (result.messageId) sentIds.push(result.messageId);
  }

  // Persist our outbound to the history file so `unreplied` sees that this
  // chat has been responded to even after a restart. We may receive an echo
  // from messages.upsert too — that's fine, MessageStore dedupes by id.
  for (const id of sentIds) {
    const synthetic: StoredMessage = {
      id,
      chatId: target,
      sender: ctx.wa.getStatus().phone ?? "self",
      text: text,
      timestamp: Math.floor(Date.now() / 1000),
      isFromMe: true,
      isGroup: target.endsWith("@g.us"),
      hasMedia: files.length > 0,
      messageType: files.length > 0 ? "mediaMessage" : "conversation",
    };
    ctx.messageStore.add(synthetic);
    appendHistoryMessage(ctx.config.historyFile, synthetic);
  }

  const resp: ApiResponse = { ok: true, messageIds: sentIds };
  if (quoteWarning) resp.warning = quoteWarning;
  return resp;
}

async function callReact(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  const chatId = String(args.chat_id ?? "");
  const messageId = String(args.message_id ?? "");
  const emoji = String(args.emoji ?? "");
  if (!chatId || !messageId) {
    return {
      ok: false,
      error: "chat_id and message_id are required",
      code: ErrorCode.INVALID_ARGUMENT,
    };
  }
  return runWrite(ctx, "react", normalizeTarget(chatId), () =>
    handleReact(ctx.wa, ctx.config, { chatId: normalizeTarget(chatId), messageId, emoji })
  );
}

async function callEdit(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  const chatId = String(args.chat_id ?? "");
  const messageId = String(args.message_id ?? "");
  const text = String(args.text ?? "");
  if (!chatId || !messageId || !text) {
    return {
      ok: false,
      error: "chat_id, message_id, and text are required",
      code: ErrorCode.INVALID_ARGUMENT,
    };
  }
  return runWrite(ctx, "edit", normalizeTarget(chatId), () =>
    handleEdit(ctx.wa, ctx.config, {
      chatId: normalizeTarget(chatId),
      messageId,
      newText: text,
    })
  );
}

async function callDownload(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  const fileId = String(args.file_id ?? "");
  if (!fileId) {
    return { ok: false, error: "file_id is required", code: ErrorCode.INVALID_ARGUMENT };
  }
  return runRead(ctx, "download_attachment", async () => {
    const raw = ctx.messageStore.getRaw(fileId);
    if (!raw) {
      return {
        ok: false,
        error: `No raw message buffered for id ${fileId}`,
        code: ErrorCode.FILE_NOT_FOUND,
        hint: "The message may have been evicted from the buffer (messageBufferSize default 500)",
      };
    }
    try {
      const buffer = await downloadMediaMessage(raw as WAMessage, "buffer", {});
      if (!buffer || (buffer as Buffer).length === 0) {
        return {
          ok: false,
          error: "Downloaded media is empty",
          code: ErrorCode.SEND_FAILED,
        };
      }
      const ext = inferExtension(raw as WAMessage);
      await mkdir(ctx.config.mediaDownloadDir, { recursive: true });
      const outPath = join(ctx.config.mediaDownloadDir, `${fileId}${ext}`);
      await writeFile(outPath, buffer as Buffer);
      return { ok: true, path: outPath, bytes: (buffer as Buffer).length };
    } catch (err: any) {
      return {
        ok: false,
        error: `Download failed: ${err?.message ?? String(err)}`,
        code: ErrorCode.SEND_FAILED,
      };
    }
  });
}

function inferExtension(msg: WAMessage): string {
  const m = msg.message;
  if (!m) return ".bin";
  const mime =
    m.imageMessage?.mimetype ??
    m.videoMessage?.mimetype ??
    m.audioMessage?.mimetype ??
    m.documentMessage?.mimetype ??
    m.stickerMessage?.mimetype;
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/ogg": ".ogg",
    "audio/ogg; codecs=opus": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "application/pdf": ".pdf",
  };
  if (mime) {
    const head = mime.split(";")[0].trim();
    if (map[head]) return map[head];
    if (map[mime]) return map[mime];
  }
  // Document files often carry a useful fileName
  const docName = m.documentMessage?.fileName;
  if (docName && docName.includes(".")) {
    const dot = docName.lastIndexOf(".");
    return docName.slice(dot);
  }
  return ".bin";
}

async function callStatus(ctx: ToolCtx): Promise<ApiResponse> {
  const status = ctx.wa.getStatus();
  const creds = hasCredentials(ctx.config.authDir);
  const ready = ctx.wa.isReady();

  // Pick a one-line diagnostic for Claude to relay to the user. Order matters:
  // a pending pairing code and the dangerous 401-takeover case come first so
  // we never nudge toward a reconnect that could wipe credentials.
  let diagnosis: string;
  if (status.pairingCode) {
    diagnosis = `pairing code issued (${status.pairingCode}) — enter it on your phone under Linked Devices → Link with phone number`;
  } else if (ready) {
    diagnosis = "connected and ready";
  } else if (status.lastPairError && !creds) {
    diagnosis = `last pairing attempt rejected (${status.lastPairError}) — retry pair_request for a fresh code, or qr_request to scan a QR`;
  } else if (!creds) {
    diagnosis =
      "no credentials — call pair_request for a phone pairing code (no QR/GUI), or qr_request to scan a QR";
  } else if (status.replacedByOtherInstance) {
    diagnosis =
      status.replacedCode === 401
        ? "link taken over via a 401 auth conflict — do NOT reconnect (risks a full deauth); re-pair with pair_request or wait it out"
        : "another session replaced this connection (440) — safe to retake with reconnect";
  } else if (status.needsRepair) {
    diagnosis =
      status.deauthRisk ??
      "needs re-pair — call restore_credentials (spurious drop) or pair_request";
  } else if (!status.authenticated) {
    diagnosis =
      "credentials present but not connected this session — waiting on initial socket open";
  } else if (status.reconnectGaveUp) {
    diagnosis = `reconnect gave up after ${status.reconnectAttempts ?? 0} attempts — call reconnect, or restore_credentials/pair_request if the link is gone`;
  } else if (status.reconnectScheduled) {
    diagnosis = `reconnecting (attempt ${status.reconnectAttempts ?? 0}) — last disconnect: ${status.lastDisconnectReason ?? "unknown"}`;
  } else if (status.connected === false && status.authenticated === true) {
    diagnosis = "socket dropped, no reconnect scheduled — call the reconnect tool";
  } else {
    diagnosis = "initial connect in progress";
  }

  const daemon = ctx.daemonInfo();

  return {
    ok: true,
    diagnosis,
    ready,
    connected: status.connected,
    authenticated: status.authenticated,
    phone: status.phone,
    pushName: status.pushName,
    hasCredentials: creds,
    qrCodeFile: creds ? undefined : ctx.config.qrCodeFile,
    qrGeneratedAt: status.qrGeneratedAt,
    qrAgeSec:
      status.qrGeneratedAt !== undefined
        ? Math.round((Date.now() - status.qrGeneratedAt) / 1000)
        : undefined,
    pairingCode: status.pairingCode,
    pairingPhone: status.pairingPhone,
    pairingCodeExpiresAt: status.pairingCodeExpiresAt,
    lastPairError: status.lastPairError,
    waVersion: status.waVersion,
    needsRepair: status.needsRepair ?? false,
    deauthRisk: status.deauthRisk,
    lastConnected: status.lastConnected,
    lastDisconnected: status.lastDisconnected,
    lastDisconnectCode: status.lastDisconnectCode,
    lastDisconnectReason: status.lastDisconnectReason,
    reconnectAttempts: status.reconnectAttempts ?? 0,
    reconnectScheduled: status.reconnectScheduled ?? false,
    reconnectGaveUp: status.reconnectGaveUp ?? false,
    replacedByOtherInstance: status.replacedByOtherInstance ?? false,
    replacedCode: status.replacedCode,
    lastHistorySync: status.lastHistorySync,
    alertChannelConfigured: ctx.alerter.isConfigured(),
    autoRepairEnabled: ctx.config.autoRepair && !!ctx.config.pairPhone,
    daemonPid: daemon.pid,
    daemonUptimeSec: daemon.uptimeSec,
    allowlist: ctx.config.allowlist,
    allowlistGroups: ctx.config.allowlistGroups,
    readMode: ctx.config.readMode,
  };
}

async function callReconnect(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  if (!hasCredentials(ctx.config.authDir)) {
    return {
      ok: false,
      error: "No credentials — pair the device first",
      code: ErrorCode.NOT_AUTHENTICATED,
      hint: "Call pair_request for a phone pairing code (no QR/GUI), or restore_credentials if a backup exists.",
    };
  }

  const status = ctx.wa.getStatus();
  const force = args?.force === true;

  // The root-cause guard: refuse to reconnect when the link was taken over
  // with a 401 auth conflict. That is exactly the state where forceReconnect
  // cascaded into a full credential deauth in the incident. 440 retakes and
  // ordinary drops are unaffected.
  if (status.replacedByOtherInstance && status.replacedCode === 401 && !force) {
    audit("reconnect_refused", { reason: "replaced_401" });
    return {
      ok: false,
      error:
        "Reconnect refused: the link was taken over with a 401 auth conflict. Reconnecting here can trigger a full credential deauth.",
      code: ErrorCode.REPAIR_REQUIRED,
      hint: "Wait for it to recover, re-pair with pair_request (no QR needed), or pass force=true to attempt a retake anyway (risks wiping credentials).",
      deauthRisk: status.deauthRisk,
    };
  }

  try {
    await ctx.wa.forceReconnect();
    // forceReconnect resolves once the socket is created; the open event is
    // async. Give the user the current snapshot.
    return {
      ok: true,
      message: "Reconnect initiated. Call status in a few seconds to confirm.",
      forced: force,
      status: ctx.wa.getStatus(),
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Reconnect failed: ${err?.message ?? String(err)}`,
      code: ErrorCode.SOCKET_ERROR,
    };
  }
}

// ---- Pairing / recovery / health / alert ----

/** Poll the manager for a freshly-issued pairing code (issued on the qr event). */
async function waitForPairingCode(
  wa: WhatsAppManager,
  timeoutMs: number
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = wa.getStatus();
    if (s.pairingCode) return s.pairingCode;
    if (s.lastPairError) return undefined; // attempt was rejected fast
    if (s.connected && s.authenticated) return undefined; // already paired
    if (Date.now() >= deadline) return wa.getStatus().pairingCode;
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function callPairRequest(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  const disabled = checkDisabled("pair_request", ctx.config);
  if (disabled) return disabled;

  const configured = (ctx.config.pairPhone ?? "").replace(/[^\d]/g, "");
  const argPhone = args?.phone ? String(args.phone).replace(/[^\d]/g, "") : "";

  // Security: a configured pairPhone locks the flow to the operator's own
  // number so a prompt-injected channel message can't aim it elsewhere.
  let phone: string;
  if (configured) {
    if (argPhone && argPhone !== configured) {
      return {
        ok: false,
        error:
          "pair_request is locked to the configured WHATSUP_PAIR_PHONE — refusing to pair a different number.",
        code: ErrorCode.INVALID_ARGUMENT,
      };
    }
    phone = configured;
  } else if (argPhone) {
    phone = argPhone;
  } else {
    return {
      ok: false,
      error: "No phone number — set WHATSUP_PAIR_PHONE or pass phone (digits/E.164).",
      code: ErrorCode.INVALID_ARGUMENT,
    };
  }

  if (ctx.wa.isReady()) {
    return {
      ok: false,
      error: "Already connected and paired — no need to pair. Use reconnect if the socket drops.",
      code: ErrorCode.INVALID_ARGUMENT,
      status: ctx.wa.getStatus(),
    };
  }

  audit("pair_request", { phone });
  try {
    const { backedUp, cleared } = await ctx.wa.startPairing(phone);
    const code = await waitForPairingCode(ctx.wa, 12_000);
    const s = ctx.wa.getStatus();
    if (code) {
      return {
        ok: true,
        pairingCode: code,
        phone,
        backedUp,
        cleared,
        waVersion: s.waVersion,
        hint: `Enter ${code} in WhatsApp → Settings → Linked Devices → Link a Device → "Link with phone number instead". Then poll pair_status until connected=true.`,
      };
    }
    if (s.lastPairError) {
      return {
        ok: false,
        error: `Pairing was rejected by WhatsApp: ${s.lastPairError}`,
        code: ErrorCode.PAIRING_FAILED,
        waVersion: s.waVersion,
        hint: "Retry pair_request for a fresh code, or qr_request to scan a QR. If it keeps failing, the WA client version may be stale — report the waVersion.",
      };
    }
    return {
      ok: true,
      pairingCode: undefined,
      phone,
      backedUp,
      cleared,
      waVersion: s.waVersion,
      message: "Pairing started but no code yet — call pair_status shortly.",
      hint: "If no code appears within ~30s, check the whatsup log; the number may be invalid.",
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Pairing failed: ${err?.message ?? String(err)}`,
      code: ErrorCode.PAIRING_FAILED,
    };
  }
}

async function callPairStatus(ctx: ToolCtx): Promise<ApiResponse> {
  const s = ctx.wa.getStatus();
  const creds = hasCredentials(ctx.config.authDir);
  const ready = ctx.wa.isReady();
  return {
    ok: true,
    ready,
    connected: s.connected,
    authenticated: s.authenticated,
    hasCredentials: creds,
    pairingCode: s.pairingCode,
    pairingPhone: s.pairingPhone,
    pairingCodeExpiresAt: s.pairingCodeExpiresAt,
    needsRepair: s.needsRepair ?? false,
    lastPairError: s.lastPairError,
    waVersion: s.waVersion,
    diagnosis: ready
      ? "paired and connected"
      : s.pairingCode
        ? "code issued — enter it on your phone under Linked Devices → Link with phone number"
        : s.lastPairError
          ? `last pairing attempt rejected (${s.lastPairError}) — retry pair_request or try qr_request`
          : creds
            ? "credentials present — connecting"
            : "no code yet — call pair_request",
  };
}

async function callRestore(ctx: ToolCtx): Promise<ApiResponse> {
  const disabled = checkDisabled("restore_credentials", ctx.config);
  if (disabled) return disabled;

  if (hasCredentials(ctx.config.authDir)) {
    return {
      ok: false,
      error: "Live credentials already present — nothing to restore.",
      code: ErrorCode.INVALID_ARGUMENT,
      hint: "If the socket is just down, call reconnect instead.",
    };
  }
  const backups = listCredentialBackups(ctx.config.authDir);
  if (backups.length === 0) {
    return {
      ok: false,
      error: "No credential backups found to restore.",
      code: ErrorCode.FILE_NOT_FOUND,
      hint: "Re-pair with pair_request.",
    };
  }
  try {
    const restored = await ctx.wa.restoreAndReconnect();
    if (!restored) {
      return {
        ok: false,
        error: "Restore found no usable backup.",
        code: ErrorCode.FILE_NOT_FOUND,
      };
    }
    return {
      ok: true,
      restoredFrom: restored,
      availableBackups: backups.length,
      message: "Credentials restored; reconnecting. Call status in a few seconds to confirm.",
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Restore failed: ${err?.message ?? String(err)}`,
      code: ErrorCode.SOCKET_ERROR,
    };
  }
}

async function callQrRequest(ctx: ToolCtx): Promise<ApiResponse> {
  const disabled = checkDisabled("qr_request", ctx.config);
  if (disabled) return disabled;

  if (ctx.wa.isReady()) {
    return {
      ok: false,
      error: "Already connected and paired — no QR needed.",
      code: ErrorCode.INVALID_ARGUMENT,
      status: ctx.wa.getStatus(),
    };
  }
  try {
    const { backedUp, cleared } = await ctx.wa.startQrPairing();
    // Give the socket a moment to emit the first QR.
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      if (ctx.wa.getStatus().qrGeneratedAt) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    const s = ctx.wa.getStatus();
    return {
      ok: true,
      qrCodeFile: ctx.config.qrCodeFile,
      qrGeneratedAt: s.qrGeneratedAt,
      backedUp,
      cleared,
      waVersion: s.waVersion,
      message: s.qrGeneratedAt
        ? "Fresh QR written. It refreshes every ~20s while unpaired; open the file and scan promptly."
        : "QR mode started but no QR yet — call status shortly for qrGeneratedAt.",
      hint: `Open ${ctx.config.qrCodeFile} and scan under WhatsApp → Settings → Linked Devices → Link a Device.`,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `QR request failed: ${err?.message ?? String(err)}`,
      code: ErrorCode.PAIRING_FAILED,
    };
  }
}

async function callReset(ctx: ToolCtx): Promise<ApiResponse> {
  const disabled = checkDisabled("reset_credentials", ctx.config);
  if (disabled) return disabled;
  try {
    const { backedUp, cleared } = await ctx.wa.resetCredentials();
    return {
      ok: true,
      backedUp,
      cleared,
      message:
        "Credentials reset to a clean slate; a fresh unregistered socket is coming up. Call pair_request (phone code) or qr_request (QR) to link.",
      hint: backedUp
        ? `A completed session was preserved at ${backedUp} — restore_credentials brings it back.`
        : undefined,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Reset failed: ${err?.message ?? String(err)}`,
      code: ErrorCode.SOCKET_ERROR,
    };
  }
}

async function callHealth(ctx: ToolCtx): Promise<ApiResponse> {
  const s = ctx.wa.getStatus();
  const ready = ctx.wa.isReady();
  const creds = hasCredentials(ctx.config.authDir);
  const stats = ctx.messageStore.getStats();

  // Last inbound/outbound activity from the in-memory buffer.
  const all = ctx.messageStore.query({ limit: 1000 });
  let lastInbound: number | undefined;
  let lastOutbound: number | undefined;
  for (const m of all) {
    if (m.isFromMe) {
      if (!lastOutbound || m.timestamp > lastOutbound) lastOutbound = m.timestamp;
    } else if (!lastInbound || m.timestamp > lastInbound) {
      lastInbound = m.timestamp;
    }
  }

  const sendPath = ready ? "ok" : creds ? "down" : "unpaired";
  const receivePath = ready ? "ok" : "down";
  const authHealth = ready
    ? "ok"
    : creds
      ? s.needsRepair
        ? "needs_repair"
        : "disconnected"
      : "unpaired";

  return {
    ok: true,
    overall: ready ? "healthy" : "degraded",
    sendPath,
    receivePath,
    authHealth,
    ready,
    connected: s.connected,
    authenticated: s.authenticated,
    hasCredentials: creds,
    needsRepair: s.needsRepair ?? false,
    deauthRisk: s.deauthRisk,
    lastPairError: s.lastPairError,
    waVersion: s.waVersion,
    replacedByOtherInstance: s.replacedByOtherInstance ?? false,
    pairingPending: !!s.pairingCode,
    qrGeneratedAt: s.qrGeneratedAt,
    qrAgeSec:
      s.qrGeneratedAt !== undefined
        ? Math.round((Date.now() - s.qrGeneratedAt) / 1000)
        : undefined,
    lastConnected: s.lastConnected,
    lastDisconnected: s.lastDisconnected,
    lastDisconnectReason: s.lastDisconnectReason,
    lastInbound,
    lastOutbound,
    lastHistorySync: s.lastHistorySync,
    bufferedMessages: stats.size,
    credentialBackups: listCredentialBackups(ctx.config.authDir).length,
    alertChannelConfigured: ctx.alerter.isConfigured(),
    autoRepairEnabled: ctx.config.autoRepair && !!ctx.config.pairPhone,
  };
}

async function callAlert(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  const disabled = checkDisabled("alert", ctx.config);
  if (disabled) return disabled;

  const text = String(args?.text ?? "").trim();
  if (!text) {
    return { ok: false, error: "text is required", code: ErrorCode.INVALID_ARGUMENT };
  }
  if (!ctx.alerter.isConfigured()) {
    return {
      ok: false,
      error: "No secondary alert channel configured.",
      code: ErrorCode.ALERT_NOT_CONFIGURED,
      hint: "Set WHATSUP_ALERT_WEBHOOK_URL (env or ~/.config/whatsup/config.json).",
    };
  }
  const delivered = await ctx.alerter.send({ kind: "manual", text });
  if (delivered) {
    audit("alert_manual", { chars: text.length });
    return { ok: true, delivered: true };
  }
  return {
    ok: false,
    error: "Alert delivery failed.",
    code: ErrorCode.SEND_FAILED,
    hint: "Check the webhook URL and the whatsup log.",
  };
}

async function callUnreplied(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  return runRead(ctx, "unreplied", async () => {
    const chatId: string | undefined = args.chat_id ? String(args.chat_id) : undefined;

    // Pull a big window so the per-chat max-outbound computation is reliable
    // even if there are many inbound messages between outbound ones.
    const all = ctx.messageStore.query({ chat: chatId, limit: 1000 });

    // For each chat, compute the timestamp of the most recent outbound.
    // A message is unreplied iff it's inbound AND its timestamp is strictly
    // greater than the last outbound in that chat. If we've never sent to
    // the chat, ALL inbound messages from it are unreplied.
    const lastSentByChat = new Map<string, number>();
    for (const m of all) {
      if (!m.isFromMe) continue;
      const prev = lastSentByChat.get(m.chatId) ?? 0;
      if (m.timestamp > prev) lastSentByChat.set(m.chatId, m.timestamp);
    }

    const pending = all
      .filter((m) => !m.isFromMe)
      .filter((m) => m.timestamp > (lastSentByChat.get(m.chatId) ?? 0))
      .map((m) => filterMessageForOutput(m, ctx.config));

    return { ok: true, messages: pending };
  });
}

async function callListChats(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  return runRead(ctx, "list-chats", () =>
    handleListChats(ctx.wa, ctx.config, {
      limit: args.limit,
      unreadOnly: args.unread_only,
    })
  );
}

async function callReadChat(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  const chatId = String(args.chat_id ?? "");
  if (!chatId) {
    return { ok: false, error: "chat_id is required", code: ErrorCode.INVALID_ARGUMENT };
  }
  return runRead(ctx, "read-chat", () =>
    handleReadChat(
      ctx.wa,
      ctx.config,
      { chatId, limit: args.limit, before: args.before },
      ctx.messageStore
    )
  );
}

async function callSearch(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  const query = String(args.query ?? "");
  if (!query) {
    return { ok: false, error: "query is required", code: ErrorCode.INVALID_ARGUMENT };
  }
  return runRead(ctx, "search", () =>
    handleSearch(
      ctx.wa,
      ctx.config,
      { query, chat: args.chat, from: args.from, limit: args.limit },
      ctx.messageStore
    )
  );
}

async function callContacts(ctx: ToolCtx, args: any): Promise<ApiResponse> {
  return runRead(ctx, "contacts", () =>
    handleContacts(ctx.wa, ctx.config, { search: args.search, limit: args.limit })
  );
}
