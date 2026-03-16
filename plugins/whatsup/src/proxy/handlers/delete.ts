import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";

export async function handleDelete(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    messageId: string;
    chatId: string;
    forMe?: boolean;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  const key = { remoteJid: params.chatId, id: params.messageId };

  try {
    if (params.forMe) {
      // Delete for me only
      await wa.sendMessage(params.chatId, { delete: key, deleteForMe: true } as any);
    } else {
      // Delete for everyone
      await wa.sendMessage(params.chatId, { delete: key });
    }
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to delete message: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
