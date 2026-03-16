import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";
import { MessageStore } from "../message-store.js";
import { filterMessageForOutput } from "../allowlist.js";

export async function handleReadChat(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    chatId: string;
    limit?: number;
    before?: string;
  },
  messageStore: MessageStore
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  const limit = params.limit ?? 50;

  try {
    const raw = messageStore.query({
      chat: params.chatId,
      limit,
    });

    const messages = raw
      .map((msg: any) => filterMessageForOutput(msg, config))
      .filter(Boolean);

    return { ok: true, messages };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to read chat: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
