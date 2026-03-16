import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";

export async function handleContacts(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    search?: string;
    limit?: number;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  try {
    const contactMap = wa.getContacts();
    let contacts = Array.from(contactMap.entries()).map(([jid, contact]) => ({
      jid,
      name: contact.name ?? contact.notify ?? null,
      phone: jid.replace("@s.whatsapp.net", ""),
    }));

    if (params.search) {
      const query = params.search.toLowerCase();
      contacts = contacts.filter(
        (c) =>
          (c.name && c.name.toLowerCase().includes(query)) ||
          c.phone.includes(query) ||
          c.jid.toLowerCase().includes(query)
      );
    }

    const limit = params.limit ?? 100;
    contacts = contacts.slice(0, limit);

    return { ok: true, contacts };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to list contacts: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
