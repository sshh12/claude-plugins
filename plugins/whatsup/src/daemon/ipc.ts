import type { Socket } from "net";
import type { ApiResponse, StoredMessage } from "../shared/types.js";
import type { EffectiveConfigOverride } from "../shared/config.js";

/**
 * IPC protocol between the socket OWNER (whichever mcp-server process won the
 * Unix-socket listen) and PROXY processes (the other Claude Code sessions).
 * Newline-delimited JSON, one object per line. Pure module — no Baileys/MCP.
 */

export const PROTOCOL_VERSION = 1;

// Drop a connection whose unterminated line exceeds this (hostile/broken peer).
const MAX_LINE_BYTES = 1_000_000;

export type ProxyFrame =
  | {
      t: "hello";
      protocol: number;
      clientPid: number;
      cfg?: EffectiveConfigOverride;
    }
  | { t: "call"; id: number; name: string; args: Record<string, any> };

export type OwnerFrame =
  | { t: "welcome"; protocol: number; ownerPid: number }
  | { t: "result"; id: number; result: ApiResponse }
  | { t: "push"; kind: "message"; payload: StoredMessage }
  | { t: "push"; kind: "system"; payload: { content: string } };

export function encodeFrame(obj: ProxyFrame | OwnerFrame): string {
  return JSON.stringify(obj) + "\n";
}

/**
 * Best-effort write. Swallows the benign "peer already gone" errors and
 * returns false so the caller can prune that connection.
 */
export function writeFrame(socket: Socket, obj: ProxyFrame | OwnerFrame): boolean {
  try {
    if (socket.destroyed || !socket.writable) return false;
    socket.write(encodeFrame(obj));
    return true;
  } catch {
    return false;
  }
}

/** Accumulates socket chunks, yields parsed JSON objects per newline. */
export class LineDecoder {
  private buf = "";

  push(chunk: Buffer | string): unknown[] {
    this.buf += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    if (this.buf.length > MAX_LINE_BYTES) {
      this.buf = "";
      throw new Error("IPC line buffer overflow");
    }
    const out: unknown[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip one malformed line, keep the stream */
      }
    }
    return out;
  }
}

export function isProxyFrame(x: unknown): x is ProxyFrame {
  if (!x || typeof x !== "object") return false;
  const t = (x as any).t;
  return t === "hello" || t === "call";
}

export function isOwnerFrame(x: unknown): x is OwnerFrame {
  if (!x || typeof x !== "object") return false;
  const t = (x as any).t;
  return t === "welcome" || t === "result" || t === "push";
}
