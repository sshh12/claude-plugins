import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";
import { phoneToJid } from "../allowlist.js";

function normalizeJid(to: string): string {
  if (to.startsWith("+") || /^\d+$/.test(to)) {
    return phoneToJid(to);
  }
  return to;
}

export async function handleTyping(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    to: string;
    stop?: boolean;
    recording?: boolean;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  const jid = normalizeJid(params.to);

  try {
    if (params.stop) {
      await wa.sendPresenceUpdate("paused", jid);
    } else if (params.recording) {
      await wa.sendPresenceUpdate("recording", jid);
    } else {
      await wa.sendPresenceUpdate("composing", jid);
    }
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to update typing status: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
