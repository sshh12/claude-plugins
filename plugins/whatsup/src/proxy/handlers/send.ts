import type { WAMessage } from "baileys";
import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";
import { phoneToJid } from "../allowlist.js";

function normalizeJid(to: string): string {
  if (to.startsWith("+") || /^\d+$/.test(to)) {
    return phoneToJid(to);
  }
  return to;
}

export async function handleSend(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    to: string;
    message: string;
    // Full Baileys message to quote. Resolved by the caller from the raw
    // store; passing a full WAMessage is the Baileys contract (a bare
    // { key } shape crashes generateWAMessage).
    quote?: WAMessage;
    mentions?: string[];
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  const jid = normalizeJid(params.to);
  const content: Record<string, unknown> = { text: params.message };

  if (params.mentions && params.mentions.length > 0) {
    content.mentions = params.mentions;
  }

  const options: Record<string, unknown> = {};
  if (params.quote) {
    options.quoted = params.quote;
  }

  try {
    const sent = await wa.sendMessage(jid, content as any, options);
    return { ok: true, messageId: sent?.key?.id ?? null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to send message: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
