import type { WhatsUpConfig } from "../shared/types.js";
import { getGlobalLogger, audit } from "./logger.js";

/**
 * Secondary, WhatsApp-INDEPENDENT notification channel.
 *
 * The whole point: when the WhatsApp link itself is dead (deauth, replaced,
 * reconnect-gave-up) there is no in-band way to tell the operator how to
 * revive it. This delivers those alerts out-of-band via a plain HTTP POST to
 * an operator-configured webhook (`WHATSUP_ALERT_WEBHOOK_URL`) — point it at
 * Pushover / ntfy / Slack / an email relay / a phone push service.
 *
 * Fire-and-forget: never throws, never blocks the connection lifecycle. Uses
 * Node 18+ global fetch, so no extra dependency.
 */

// Superset of WhatsAppManager's SystemEvent["kind"] plus "manual" (the `alert`
// tool). Keep in sync with SystemEvent in whatsapp.ts.
export type AlertKind =
  | "qr"
  | "pairing_code"
  | "connected"
  | "recovered"
  | "replaced"
  | "deauth"
  | "reconnect_gave_up"
  | "manual";

export interface Alert {
  kind: AlertKind;
  /** Short human-facing summary — the notification title/body. */
  text: string;
  /** Optional structured extras (pairing code, phone, disconnect reason). */
  data?: Record<string, unknown>;
}

const POST_TIMEOUT_MS = 8_000;

export class Alerter {
  private webhookUrl: string;

  constructor(config: WhatsUpConfig) {
    this.webhookUrl = (config.alertWebhookUrl ?? "").trim();
  }

  /** True when at least one out-of-band transport is configured. */
  isConfigured(): boolean {
    return this.webhookUrl.length > 0;
  }

  /**
   * Best-effort out-of-band delivery. Resolves true if a transport accepted
   * the alert, false if none is configured or delivery failed. Never rejects.
   */
  async send(alert: Alert): Promise<boolean> {
    const logger = getGlobalLogger();
    audit("alert_emit", { kind: alert.kind, configured: this.isConfigured() });

    if (!this.isConfigured()) {
      logger.warn("Alert not delivered — no secondary channel configured", {
        kind: alert.kind,
      });
      return false;
    }

    const ok = await this.postWebhook(alert);
    if (ok) {
      logger.info("Alert delivered via webhook", { kind: alert.kind });
      audit("alert_delivered", { kind: alert.kind, transport: "webhook" });
    } else {
      logger.error("Alert webhook delivery failed", { kind: alert.kind });
      audit("alert_failed", { kind: alert.kind, transport: "webhook" });
    }
    return ok;
  }

  private async postWebhook(alert: Alert): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: "whatsup",
          kind: alert.kind,
          text: alert.text,
          data: alert.data ?? {},
          ts: new Date().toISOString(),
        }),
        signal: controller.signal,
      });
      return res.ok;
    } catch (err: any) {
      getGlobalLogger().warn("Alert webhook POST threw", {
        error: err?.message ?? String(err),
      });
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
