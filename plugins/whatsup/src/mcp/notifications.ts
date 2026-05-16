import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StoredMessage, WhatsUpConfig } from "../shared/types.js";
import { normalizePhone, jidToPhone, isGroupJid, wrapUntrusted } from "../proxy/allowlist.js";
import { audit, getGlobalLogger } from "../proxy/logger.js";

// MCP's typed Server doesn't know about our custom "notifications/claude/channel"
// method. The runtime accepts arbitrary methods — cast at the call site.
type ChannelMeta = {
  chat_id: string;
  message_id: string;
  user: string;
  user_id: string;
  ts: string;
  chat_type: "dm" | "group" | "system";
  attachment_kind?: string;
  attachment_file_id?: string;
  attachment_mime?: string;
  attachment_name?: string;
  reply_to_id?: string;
};

function attachmentKind(msg: StoredMessage): string | undefined {
  if (!msg.hasMedia) return undefined;
  return msg.mediaType;
}

/**
 * Filter a live inbound message through the allowlist + readMode policy
 * and emit it to Claude as a notifications/claude/channel event.
 *
 * Returns true if the message was delivered, false if it was filtered out.
 */
export function pushIncoming(
  mcp: Server,
  msg: StoredMessage,
  config: WhatsUpConfig
): boolean {
  // 1. Suppress echoes of our own sends — Baileys re-emits these via messages.upsert
  if (msg.isFromMe) return false;

  // 2. Allowlist gate
  const isGroup = isGroupJid(msg.chatId);
  if (isGroup) {
    if (!config.allowlistGroups.includes(msg.chatId)) return false;
  } else {
    // DM: check sender against allowlist in allowlist readMode
    if (config.readMode === "allowlist") {
      const phone = jidToPhone(msg.sender) ?? jidToPhone(msg.chatId);
      if (!phone) return false;
      const normalized = normalizePhone(phone);
      const allowed = config.allowlist.some(
        (entry) => normalizePhone(entry) === normalized
      );
      if (!allowed) return false;
    }
  }

  // 3. Build channel meta. Content is wrapped in <untrusted_user_message>
  //    so prompt-injection-rules from training survive the transport.
  const content = msg.text ? wrapUntrusted(msg.text) : "";

  const meta: ChannelMeta = {
    chat_id: msg.chatId,
    message_id: msg.id,
    user: msg.pushName ?? msg.senderName ?? msg.sender,
    user_id: msg.sender,
    ts: new Date(msg.timestamp * 1000).toISOString(),
    chat_type: isGroup ? "group" : "dm",
  };

  const kind = attachmentKind(msg);
  if (kind) {
    meta.attachment_kind = kind;
    meta.attachment_file_id = msg.id; // download_attachment looks up by message id
  }
  if (msg.quotedMessageId) meta.reply_to_id = msg.quotedMessageId;

  audit("channel_push", {
    chat_id: msg.chatId,
    message_id: msg.id,
    has_text: !!msg.text,
    has_media: !!kind,
  });

  // Cast: the typed SendNotificationT union doesn't include claude/channel,
  // but the runtime layer is method-agnostic.
  (mcp as any)
    .notification({
      method: "notifications/claude/channel",
      params: { content, meta },
    })
    .catch((err: any) => {
      getGlobalLogger().warn("channel notification failed", {
        error: err?.message ?? String(err),
      });
    });

  return true;
}

/**
 * Push a system-originated channel notification (QR pairing, connection events).
 */
export function pushSystem(mcp: Server, content: string): void {
  const meta: ChannelMeta = {
    chat_id: "system",
    message_id: `system-${Date.now()}`,
    user: "WhatsUp",
    user_id: "system",
    ts: new Date().toISOString(),
    chat_type: "system",
  };
  (mcp as any)
    .notification({
      method: "notifications/claude/channel",
      params: { content, meta },
    })
    .catch(() => {});
}
