import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";
import { MessageStore } from "../message-store.js";
import { filterMessageForOutput } from "../allowlist.js";

export async function handleSearch(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    query: string;
    chat?: string;
    from?: string;
    limit?: number;
  },
  messageStore: MessageStore
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  if (!params.query) {
    return { ok: false, error: "query is required", code: ErrorCode.INVALID_ARGUMENT };
  }

  const limit = params.limit ?? 20;

  try {
    const filter: Record<string, unknown> = {};
    if (params.chat) filter.chat = params.chat;
    if (params.from) filter.from = params.from;

    const raw = messageStore.search(params.query, filter);

    const messages = raw
      .slice(0, limit)
      .map((msg: any) => filterMessageForOutput(msg, config))
      .filter(Boolean);

    return { ok: true, messages, total: raw.length };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Search failed: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
