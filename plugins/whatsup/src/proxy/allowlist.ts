import type { ApiResponse, WhatsUpConfig, StoredMessage } from '../shared/types.js';
import { ErrorCode } from '../shared/types.js';
import { audit } from './logger.js';

/**
 * Normalize a phone number to E.164 format for comparison.
 * Strips spaces, dashes, parens. Ensures leading +.
 */
export function normalizePhone(phone: string): string {
  // Strip all non-digit characters, then ensure leading +
  const digits = phone.replace(/[^\d]/g, '');
  return '+' + digits;
}

/**
 * Convert a phone number to WhatsApp JID format.
 * "+1234567890" -> "1234567890@s.whatsapp.net"
 */
export function phoneToJid(phone: string): string {
  const normalized = normalizePhone(phone);
  // Strip the leading + to get digits only
  const digits = normalized.slice(1);
  return `${digits}@s.whatsapp.net`;
}

/**
 * Extract phone number from a JID.
 * "1234567890@s.whatsapp.net" -> "+1234567890"
 * Returns null if the JID is not a valid individual chat JID.
 * Note: @lid JIDs cannot be converted to phone numbers without a mapping.
 */
export function jidToPhone(jid: string): string | null {
  if (jid.endsWith('@lid')) return null; // LID JIDs need external resolution
  if (!jid.endsWith('@s.whatsapp.net')) return null;
  const digits = jid.split('@')[0];
  if (!digits || !/^\d+$/.test(digits)) return null;
  return '+' + digits;
}

/**
 * Check if a JID is a group.
 */
export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/**
 * Check if a JID is allowlisted for WRITE operations.
 * Returns null if allowed, ApiResponse with error if blocked.
 */
export function enforceWriteAllowlist(
  target: string,
  config: WhatsUpConfig
): ApiResponse | null {
  // Normalize: if target is a phone number (not a JID), convert to JID
  const jid = target.includes('@') ? target : phoneToJid(target);

  // Group JID check
  if (isGroupJid(jid)) {
    const allowed = config.allowlistGroups.includes(jid);
    audit('allowlist_check', {
      jid,
      operation: 'write',
      type: 'group',
      allowed,
    });
    if (!allowed) {
      return {
        ok: false,
        error: `Group ${jid} is not in the allowlist. Add it to allowlistGroups in config.`,
        code: ErrorCode.GROUP_NOT_ALLOWLISTED,
        hint: 'Configure allowlistGroups with the group JID to enable messaging this group.',
      };
    }
    return null;
  }

  // Individual contact check
  const phone = jidToPhone(jid);
  if (!phone) {
    audit('allowlist_check', {
      jid,
      operation: 'write',
      type: 'unknown',
      allowed: false,
    });
    return {
      ok: false,
      error: `Invalid JID format: ${jid}`,
      code: ErrorCode.CONTACT_NOT_ALLOWLISTED,
    };
  }

  const normalizedPhone = normalizePhone(phone);
  const isAllowed = config.allowlist.some(
    (entry) => normalizePhone(entry) === normalizedPhone
  );

  audit('allowlist_check', {
    jid,
    phone: normalizedPhone,
    operation: 'write',
    type: 'contact',
    allowed: isAllowed,
  });

  if (!isAllowed) {
    return {
      ok: false,
      error: `Contact ${normalizedPhone} is not in the allowlist. Add their phone number to the allowlist in config.`,
      code: ErrorCode.CONTACT_NOT_ALLOWLISTED,
      hint: 'Configure the allowlist with phone numbers (E.164 format) to enable messaging.',
    };
  }

  return null;
}

/**
 * Check if a JID is allowlisted for READ operations.
 * Returns "full" if full content is accessible, "metadata" for metadata only,
 * or "tagged" for full content wrapped in untrusted tags.
 */
export function getReadAccess(
  jid: string,
  config: WhatsUpConfig
): 'full' | 'metadata' | 'tagged' {
  // "all" readMode: all messages get full content (will be wrapped in untrusted tags)
  if (config.readMode === 'all') {
    return 'tagged';
  }

  // "allowlist" readMode: check if contact/group is allowlisted
  if (isGroupJid(jid)) {
    return config.allowlistGroups.includes(jid) ? 'tagged' : 'metadata';
  }

  const phone = jidToPhone(jid);
  if (!phone) return 'metadata';

  const normalizedPhone = normalizePhone(phone);
  const isAllowed = config.allowlist.some(
    (entry) => normalizePhone(entry) === normalizedPhone
  );

  return isAllowed ? 'tagged' : 'metadata';
}

/**
 * Wrap message content in untrusted tags for CLI output.
 */
export function wrapUntrusted(content: string): string {
  return `<untrusted_user_message>${content}</untrusted_user_message>`;
}

/**
 * Filter/tag messages based on read access level.
 *
 * For "allowlist" readMode: allowlisted contacts get full content (tagged),
 *   non-allowlisted get metadata only (sender + timestamp, no body).
 * For "all" readMode: all messages get full content wrapped in untrusted tags.
 */
export function filterMessageForOutput(
  message: StoredMessage,
  config: WhatsUpConfig
): StoredMessage {
  const chatJid = message.chatId;
  const access = getReadAccess(chatJid, config);

  audit('read_access_check', {
    chatId: chatJid,
    messageId: message.id,
    access,
  });

  if (access === 'metadata') {
    // Strip message body and media, keep only metadata
    return {
      ...message,
      text: undefined,
      mediaUrl: undefined,
      hasMedia: message.hasMedia,
    };
  }

  // "tagged" or "full" -- wrap text content in untrusted tags
  return {
    ...message,
    text: message.text ? wrapUntrusted(message.text) : undefined,
    pushName: message.pushName ? wrapUntrusted(message.pushName) : undefined,
    senderName: message.senderName ? wrapUntrusted(message.senderName) : undefined,
  };
}
