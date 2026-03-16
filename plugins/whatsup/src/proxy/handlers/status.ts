import { readFile } from "fs/promises";
import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";

export async function handleStatus(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    text?: string;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  if (!params.text) {
    return { ok: false, error: "text is required for status update", code: ErrorCode.INVALID_ARGUMENT };
  }

  try {
    await wa.updateProfileStatus(params.text);
    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to update status: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}

export async function handleProfile(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    name?: string;
    picture?: string;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  if (!params.name && !params.picture) {
    return { ok: false, error: "At least one of name or picture is required", code: ErrorCode.INVALID_ARGUMENT };
  }

  try {
    if (params.name) {
      await wa.updateProfileName(params.name);
    }

    if (params.picture) {
      const sock = wa.getSocket();
      if (sock) {
        const imgBuffer = await readFile(params.picture);
        await sock.updateProfilePicture(sock.user?.id ?? "", imgBuffer);
      }
    }

    return { ok: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to update profile: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
