import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";

export async function handleMarkRead(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    chatId: string;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  try {
    await wa.readMessages([{ remoteJid: params.chatId }]);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to mark as read: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
