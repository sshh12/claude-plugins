import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";
import { phoneToJid } from "../allowlist.js";

function normalizeJid(to: string): string {
  if (to.startsWith("+") || /^\d+$/.test(to)) {
    return phoneToJid(to);
  }
  return to;
}

export async function handleForward(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    to: string;
    messageId: string;
    chatId: string;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  const toJid = normalizeJid(params.to);

  try {
    const sock = wa.getSocket();
    // Construct a minimal message key reference for forwarding
    const forwardMsg = {
      key: { remoteJid: params.chatId, id: params.messageId },
    };
    await wa.sendMessage(toJid, { forward: forwardMsg });
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to forward message: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
