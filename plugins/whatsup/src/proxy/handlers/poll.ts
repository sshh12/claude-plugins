import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";
import { MessageStore } from "../message-store.js";
import { filterMessageForOutput } from "../allowlist.js";

export async function handlePoll(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    timeout?: number;
    from?: string;
    chat?: string;
    since?: number;
    limit?: number;
  },
  messageStore: MessageStore
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  const timeoutMs = (params.timeout ?? config.pollTimeout ?? 30) * 1000;
  const limit = params.limit ?? 50;

  const filter: Record<string, unknown> = {};
  if (params.from) filter.from = params.from;
  if (params.chat) filter.chat = params.chat;
  if (params.since) filter.since = params.since;

  try {
    const result = await messageStore.subscribe(filter, timeoutMs);
    const messages = (result.messages ?? [])
      .slice(0, limit)
      .map((msg: any) => filterMessageForOutput(msg, config))
      .filter(Boolean);

    return {
      ok: true,
      messages,
      timedOut: result.timedOut ?? false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Poll failed: ${msg}`, code: ErrorCode.TIMEOUT };
  }
}
