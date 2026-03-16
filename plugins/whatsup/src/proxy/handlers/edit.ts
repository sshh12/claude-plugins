import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";

export async function handleEdit(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    messageId: string;
    chatId: string;
    newText: string;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  if (!params.newText) {
    return { ok: false, error: "newText is required", code: ErrorCode.INVALID_ARGUMENT };
  }

  const key = { remoteJid: params.chatId, id: params.messageId };

  try {
    await wa.sendMessage(params.chatId, { edit: key, text: params.newText });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to edit message: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
