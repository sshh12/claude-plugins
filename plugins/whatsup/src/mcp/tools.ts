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
import { hasCredentials } from "../proxy/auth.js";
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
      "Get WhatsApp connection state. Returns connected, authenticated, phone, pushName, the QR file path if pairing is pending, reconnect diagnostics (lastDisconnectReason, reconnectAttempts, reconnectScheduled, reconnectGaveUp), the shared broker daemon's pid/uptime (daemonPid, daemonUptimeSec), and replacedByOtherInstance (true when an external WhatsApp Web/phone session took the socket; call reconnect to retake it).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "reconnect",
    description:
      "Force a fresh WhatsApp socket connection. Use when status shows connected=false but authenticated=true, or when reconnectGaveUp=true after sustained network trouble.",
    inputSchema: { type: "object", properties: {} },
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
  // Differentiate "never paired" from "paired but socket dropped" so Claude
  // and the user can act on the right thing.
  if (!status.authenticated) {
    return {
      ok: false,
      error: "WhatsApp not paired",
      code: ErrorCode.NOT_AUTHENTICATED,
      hint: "Call the status tool to retrieve the QR file path, then pair under WhatsApp → Settings → Linked Devices.",
    };
  }
  if (status.reconnectGaveUp) {
    return {
      ok: false,
      error: "WhatsApp socket disconnected and reconnect gave up",
      code: ErrorCode.NOT_CONNECTED,
      hint: "Call the reconnect tool. If that fails, the phone may have unlinked the device — re-pair via status.",
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
      return callReconnect(ctx);
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

  // Pick a one-line diagnostic for Claude to relay to the user.
  let diagnosis: string;
  if (status.replacedByOtherInstance) {
    diagnosis =
      "another session/instance replaced this connection — not auto-reconnecting; call the reconnect tool to retake it";
  } else if (ready) {
    diagnosis = "connected and ready";
  } else if (!creds) {
    diagnosis = "no credentials — pair the device by scanning the QR file";
  } else if (!status.authenticated) {
    diagnosis = "credentials present but never connected this session — waiting on initial socket open";
  } else if (status.reconnectGaveUp) {
    diagnosis = `reconnect gave up after ${status.reconnectAttempts ?? 0} attempts — call the reconnect tool`;
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
    lastConnected: status.lastConnected,
    lastDisconnected: status.lastDisconnected,
    lastDisconnectCode: status.lastDisconnectCode,
    lastDisconnectReason: status.lastDisconnectReason,
    reconnectAttempts: status.reconnectAttempts ?? 0,
    reconnectScheduled: status.reconnectScheduled ?? false,
    reconnectGaveUp: status.reconnectGaveUp ?? false,
    replacedByOtherInstance: status.replacedByOtherInstance ?? false,
    daemonPid: daemon.pid,
    daemonUptimeSec: daemon.uptimeSec,
    allowlist: ctx.config.allowlist,
    allowlistGroups: ctx.config.allowlistGroups,
    readMode: ctx.config.readMode,
  };
}

async function callReconnect(ctx: ToolCtx): Promise<ApiResponse> {
  if (!hasCredentials(ctx.config.authDir)) {
    return {
      ok: false,
      error: "No credentials — pair the device first",
      code: ErrorCode.NOT_AUTHENTICATED,
      hint: "Call status to retrieve the QR file path.",
    };
  }
  try {
    await ctx.wa.forceReconnect();
    // forceReconnect resolves once the socket is created; the open event is
    // async. Give the user the current snapshot.
    return {
      ok: true,
      message: "Reconnect initiated. Call status in a few seconds to confirm.",
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
