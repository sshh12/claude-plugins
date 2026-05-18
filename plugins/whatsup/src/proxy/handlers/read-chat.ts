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
  // No isReady() guard: this reads only the in-memory message buffer
  // (hydrated from the history JSONL on startup). runRead gates the
  // connected path; this handler just serves the buffer.

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
