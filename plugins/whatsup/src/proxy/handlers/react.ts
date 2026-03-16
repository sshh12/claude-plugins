import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";

export async function handleReact(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    messageId: string;
    chatId: string;
    emoji: string;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  if (params.emoji === undefined || params.emoji === null) {
    return { ok: false, error: "emoji is required (empty string to remove)", code: ErrorCode.INVALID_ARGUMENT };
  }

  try {
    await wa.sendMessage(params.chatId, {
      react: {
        text: params.emoji,
        key: { remoteJid: params.chatId, id: params.messageId },
      },
    });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to react: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
