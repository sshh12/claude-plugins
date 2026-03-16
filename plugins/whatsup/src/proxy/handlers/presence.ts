import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";

export async function handlePresence(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    available?: boolean;
    unavailable?: boolean;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  try {
    if (params.unavailable) {
      await wa.sendPresenceUpdate("unavailable");
    } else {
      await wa.sendPresenceUpdate("available");
    }
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to update presence: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
