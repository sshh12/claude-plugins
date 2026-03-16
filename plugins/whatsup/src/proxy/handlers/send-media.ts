import { readFile, stat } from "fs/promises";
import { extname, resolve, normalize } from "path";
import { WhatsUpConfig, ApiResponse, ErrorCode } from "../../shared/types.js";
import type { WhatsAppManager } from "../whatsapp.js";
import { phoneToJid } from "../allowlist.js";

function normalizeJid(to: string): string {
  if (to.startsWith("+") || /^\d+$/.test(to)) {
    return phoneToJid(to);
  }
  return to;
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".avi", ".mov"]);
const AUDIO_EXTS = new Set([".mp3", ".ogg", ".opus", ".m4a"]);

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
};

function detectType(ext: string): "image" | "video" | "audio" | "document" {
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "document";
}

function isPathSafe(filePath: string): boolean {
  const normalized = normalize(filePath);
  if (normalized.includes("..")) return false;
  return true;
}

export async function handleSendMedia(
  wa: WhatsAppManager,
  config: WhatsUpConfig,
  params: {
    to: string;
    path: string;
    caption?: string;
    type?: "image" | "video" | "audio" | "document";
    quote?: string;
    viewOnce?: boolean;
    fileName?: string;
  }
): Promise<ApiResponse> {
  if (!wa.isReady()) {
    return { ok: false, error: "WhatsApp not connected", code: ErrorCode.NOT_CONNECTED };
  }

  if (!isPathSafe(params.path)) {
    return {
      ok: false,
      error: "Path traversal not allowed",
      code: ErrorCode.PATH_BLOCKED,
      hint: "File paths must not contain '..' segments",
    };
  }

  const filePath = resolve(params.path);

  // Verify file exists and check size
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    return { ok: false, error: `File not found: ${filePath}`, code: ErrorCode.FILE_NOT_FOUND };
  }

  if (config.maxMediaSize && fileStats.size > config.maxMediaSize) {
    return {
      ok: false,
      error: `File exceeds max media size (${fileStats.size} > ${config.maxMediaSize})`,
      code: ErrorCode.INVALID_ARGUMENT,
      hint: "Reduce file size or increase maxMediaSize in config",
    };
  }

  const ext = extname(filePath).toLowerCase();
  const mediaType = params.type ?? detectType(ext);
  const mimetype = MIME_MAP[ext] ?? "application/octet-stream";

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to read file: ${msg}`, code: ErrorCode.FILE_NOT_FOUND };
  }

  const jid = normalizeJid(params.to);
  let content: Record<string, unknown>;

  switch (mediaType) {
    case "image":
      content = { image: buffer, caption: params.caption, mimetype };
      break;
    case "video":
      content = { video: buffer, caption: params.caption, mimetype };
      break;
    case "audio":
      content = { audio: buffer, mimetype };
      break;
    case "document":
      content = {
        document: buffer,
        mimetype,
        fileName: params.fileName ?? filePath.split("/").pop(),
      };
      if (params.caption) content.caption = params.caption;
      break;
  }

  if (params.viewOnce) {
    content.viewOnce = true;
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
    return { ok: false, error: `Failed to send media: ${msg}`, code: ErrorCode.SEND_FAILED };
  }
}
