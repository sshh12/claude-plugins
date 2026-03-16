import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";

export async function handleListChats(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    limit?: number;
    unreadOnly?: boolean;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  try {
    const chatMap = wa.getChats();
    let chats = Array.from(chatMap.entries()).map(([id, chat]: [string, any]) => ({
      id,
      name: chat.name ?? chat.subject ?? id,
      lastMessage: chat.lastMessage ?? null,
      lastMessageTime: Number(chat.conversationTimestamp ?? chat.lastMessageRecvTimestamp ?? 0),
      unreadCount: chat.unreadCount ?? 0,
    }));

    // Sort by last message time, most recent first
    chats.sort((a, b) => b.lastMessageTime - a.lastMessageTime);

    if (params.unreadOnly) {
      chats = chats.filter((c) => c.unreadCount > 0);
    }

    const limit = params.limit ?? 50;
    chats = chats.slice(0, limit);

    return { ok: true, chats };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to list chats: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
