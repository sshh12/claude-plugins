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
    quote?: string;
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
    options.quoted = { key: { remoteJid: jid, id: params.quote } };
  }

  try {
    const sent = await wa.sendMessage(jid, content as any, options);
    return { ok: true, messageId: sent?.key?.id ?? null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to send message: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}

export async function handleSendLocation(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    to: string;
    latitude: number;
    longitude: number;
    name?: string;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  const jid = normalizeJid(params.to);
  const content: Record<string, unknown> = {
    location: {
      degreesLatitude: params.latitude,
      degreesLongitude: params.longitude,
      name: params.name,
    },
  };

  try {
    const sent = await wa.sendMessage(jid, content as any);
    return { ok: true, messageId: sent?.key?.id ?? null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to send location: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}

export async function handleSendContact(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    to: string;
    vcard: string;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  const jid = normalizeJid(params.to);
  const displayName = params.vcard.match(/FN:(.*)/)?.[1]?.trim() ?? "Contact";
  const content = {
    contacts: {
      displayName,
      contacts: [{ vcard: params.vcard }],
    },
  };

  try {
    const sent = await wa.sendMessage(jid, content);
    return { ok: true, messageId: sent?.key?.id ?? null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to send contact: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}

export async function handleSendPoll(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    to: string;
    question: string;
    options: string[];
    multiSelect?: boolean;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  if (!params.options || params.options.length < 2) {
    return { ok: false, error: "Poll requires at least 2 options", code: ErrorCode.INVALID_ARGUMENT };
  }

  const jid = normalizeJid(params.to);
  const content = {
    poll: {
      name: params.question,
      values: params.options,
      selectableCount: params.multiSelect ? 0 : 1,
    },
  };

  try {
    const sent = await wa.sendMessage(jid, content as any);
    return { ok: true, messageId: sent?.key?.id ?? null };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to send poll: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
