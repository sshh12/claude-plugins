import net from "net";
import { existsSync, mkdirSync, unlinkSync, chmodSync } from "fs";
import { dirname } from "path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  getConfig,
  getSecurityWarnings,
  mergeEffectiveConfig,
  type EffectiveConfigOverride,
} from "../shared/config.js";
import type { ApiResponse, WhatsUpConfig, StoredMessage } from "../shared/types.js";
import { ErrorCode } from "../shared/types.js";
import type { Logger } from "../proxy/logger.js";
import { setAuditLog, audit } from "../proxy/logger.js";
import { WhatsAppManager } from "../proxy/whatsapp.js";
import { MessageStore } from "../proxy/message-store.js";
import { RateLimiter } from "../proxy/rate-limiter.js";
import {
  appendMessage as appendHistoryMessage,
  loadRecentMessages,
  pruneOld,
} from "../proxy/history-store.js";
import { callTool, type ToolCtx } from "../mcp/tools.js";
import { pushIncoming, pushSystem } from "../mcp/notifications.js";
import {
  LineDecoder,
  writeFrame,
  isProxyFrame,
  isOwnerFrame,
  PROTOCOL_VERSION,
  type ProxyFrame,
} from "./ipc.js";

/**
 * One Unix-socket OWNER per machine (the process that won an atomic
 * `listen()`); every other Claude Code session is a thin PROXY that forwards
 * tool calls and relays pushes over IPC. The owner role lives in-process —
 * no separate spawned daemon. On owner exit, a surviving proxy lazily
 * re-elects via the same atomic `listen()`.
 */

const CONNECT_TIMEOUT_MS = 1_200; // bound the macOS "connect to stale socket hangs"
const ELECT_MAX_MS = 15_000;
const REQ_TIMEOUT_MS = 30_000;

type Role = "owner" | "proxy" | "none";

interface ConnRec {
  id: number;
  socket: net.Socket;
  decoder: LineDecoder;
  effective: WhatsUpConfig;
  helloDone: boolean;
  subscribed: boolean;
}

function cfgSubset(c: WhatsUpConfig): EffectiveConfigOverride {
  return {
    allowlist: c.allowlist,
    allowlistGroups: c.allowlistGroups,
    readMode: c.readMode,
    disabledCommands: c.disabledCommands,
    rateLimitPerContact: c.rateLimitPerContact,
    rateLimitTotal: c.rateLimitTotal,
    maxMediaSize: c.maxMediaSize,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Broker {
  handleToolCall(name: string, args: Record<string, any>): Promise<ApiResponse>;
  shutdown(): Promise<void>;
}

export async function startBroker(opts: {
  mcp: Server;
  logger: Logger;
}): Promise<Broker> {
  const { mcp, logger } = opts;
  const config = getConfig();
  if (config.auditLog) setAuditLog(config.auditLog);
  for (const w of getSecurityWarnings()) {
    logger.warn(`Config warning: ${w.field} - ${w.message}`);
  }
  const sockPath = config.daemonSocketFile;
  const startedAt = Date.now();

  let role: Role = "none";
  let shuttingDown = false;

  // ---- owner state (created once, on first becoming owner) ----
  let messageStore: MessageStore | null = null;
  let rateLimiter: RateLimiter | null = null;
  let wa: WhatsAppManager | null = null;
  let ipcServer: net.Server | null = null;
  const conns = new Map<number, ConnRec>();
  let nextConnId = 1;
  let ownerSelfSubscribed = false;
  // Subscription is owner-scoped; remember this session's intent so it
  // survives owner handoff (re-applied when we re-elect / reconnect).
  let localWantsSubscribe = false;

  // ---- proxy state ----
  let pxSock: net.Socket | null = null;
  let ownerPid: number | null = null;
  const pending = new Map<
    number,
    { resolve: (r: ApiResponse) => void; timer: ReturnType<typeof setTimeout> }
  >();
  let nextReqId = 1;
  let electing: Promise<void> | null = null;

  const daemonInfo = () => ({
    pid: process.pid,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  });

  // ---- owner: tool dispatch ----
  const dispatchOwned = async (
    name: string,
    args: Record<string, any>,
    conn: ConnRec | null
  ): Promise<ApiResponse> => {
    if (name === "subscribe") {
      if (conn) conn.subscribed = true;
      else ownerSelfSubscribed = true;
      return { ok: true, subscribed: true };
    }
    if (name === "unsubscribe") {
      if (conn) conn.subscribed = false;
      else ownerSelfSubscribed = false;
      return { ok: true, subscribed: false };
    }
    if (name === "__test_inject" && process.env.WHATSUP_TEST_INJECT) {
      const msg = args?.msg as StoredMessage;
      if (msg && msg.id) onInbound(msg);
      return { ok: true };
    }
    const effective = conn ? conn.effective : config;
    const ctx: ToolCtx = {
      wa: wa!,
      config: effective,
      messageStore: messageStore!,
      rateLimiter: rateLimiter!,
      daemonInfo,
    };
    try {
      return await callTool(ctx, name, args);
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message ?? String(err),
        code: ErrorCode.SEND_FAILED,
      };
    }
  };

  const dropConn = (c: ConnRec) => {
    conns.delete(c.id);
    try {
      c.socket.destroy();
    } catch {
      /* ignore */
    }
  };

  const onInbound = (msg: StoredMessage) => {
    appendHistoryMessage(config.historyFile, msg);
    if (ownerSelfSubscribed) pushIncoming(mcp, msg, config);
    for (const c of conns.values()) {
      if (!c.subscribed) continue;
      if (!writeFrame(c.socket, { t: "push", kind: "message", payload: msg }))
        dropConn(c);
    }
  };

  const onSystem = (content: string) => {
    if (ownerSelfSubscribed) pushSystem(mcp, content);
    for (const c of conns.values()) {
      if (!c.subscribed) continue;
      if (!writeFrame(c.socket, { t: "push", kind: "system", payload: { content } }))
        dropConn(c);
    }
  };

  const handleProxyFrame = async (c: ConnRec, f: ProxyFrame) => {
    if (f.t === "hello") {
      c.effective = mergeEffectiveConfig(config, f.cfg);
      c.helloDone = true;
      return;
    }
    if (!c.helloDone) {
      writeFrame(c.socket, {
        t: "result",
        id: f.id,
        result: { ok: false, error: "hello required", code: ErrorCode.INVALID_ARGUMENT },
      });
      return;
    }
    const result = await dispatchOwned(f.name, f.args, c);
    writeFrame(c.socket, { t: "result", id: f.id, result });
  };

  const initOwner = async (server: net.Server): Promise<void> => {
    messageStore = new MessageStore(config.messageBufferSize);
    try {
      const pr = pruneOld(config.historyFile, config.historyRetentionDays);
      if (pr.dropped > 0) logger.info("Pruned stale history entries", pr);
      const recent = loadRecentMessages(config.historyFile, config.historyLoadLimit);
      for (const m of recent) messageStore.add(m);
      if (recent.length > 0)
        logger.info("Hydrated message buffer from history", { loaded: recent.length });
    } catch (err: any) {
      logger.warn("History hydration failed", { error: err?.message ?? String(err) });
    }
    rateLimiter = new RateLimiter(config);
    wa = new WhatsAppManager(config, messageStore);

    server.on("error", (err: any) =>
      logger.error("IPC server error (kept alive)", {
        error: err?.message ?? String(err),
      })
    );
    server.on("connection", (socket) => {
      const c: ConnRec = {
        id: nextConnId++,
        socket,
        decoder: new LineDecoder(),
        effective: config,
        helloDone: false,
        subscribed: false,
      };
      conns.set(c.id, c);
      writeFrame(socket, {
        t: "welcome",
        protocol: PROTOCOL_VERSION,
        ownerPid: process.pid,
      });
      socket.on("data", (chunk) => {
        let frames: unknown[];
        try {
          frames = c.decoder.push(chunk);
        } catch {
          dropConn(c);
          return;
        }
        for (const f of frames) {
          if (isProxyFrame(f))
            handleProxyFrame(c, f).catch((err: any) =>
              logger.error("handleProxyFrame failed", {
                error: err?.message ?? String(err),
              })
            );
        }
      });
      socket.on("error", () => dropConn(c));
      socket.on("close", () => dropConn(c));
    });
    ipcServer = server;

    let announcedReady = false;
    const readyTimer = setInterval(() => {
      if (announcedReady || !wa) return;
      if (wa.isReady()) {
        announcedReady = true;
        onSystem(`WhatsApp connected as ${wa.getStatus().phone ?? "unknown"}. Ready.`);
      }
    }, 2000);
    readyTimer.unref();

    wa.connect({
      onQr: () =>
        onSystem(
          [
            `WhatsApp pairing required. QR written to:`,
            `  ${config.qrCodeFile}`,
            ``,
            `Scan: WhatsApp → Settings → Linked Devices → Link a Device.`,
            `On macOS: \`open ${config.qrCodeFile}\``,
          ].join("\n")
        ),
      onMessage: (msg) => onInbound(msg),
    }).catch((err) =>
      logger.error("Initial WhatsApp connect failed", {
        error: err instanceof Error ? err.message : String(err),
      })
    );

    // Carry this session's subscribe intent across an owner handoff.
    ownerSelfSubscribed = localWantsSubscribe;
    role = "owner";
    logger.info("Became socket owner", { pid: process.pid, sockPath });
    audit("owner_start", { pid: process.pid });
  };

  // ---- proxy side ----
  const failAllPending = (reason: string) => {
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: reason, code: ErrorCode.DAEMON_UNREACHABLE });
    }
    pending.clear();
  };

  const setupProxy = (sock: net.Socket): void => {
    pxSock = sock;
    role = "proxy";
    const decoder = new LineDecoder();
    sock.on("data", (chunk) => {
      let frames: unknown[];
      try {
        frames = decoder.push(chunk);
      } catch {
        sock.destroy();
        return;
      }
      for (const f of frames) {
        if (!isOwnerFrame(f)) continue;
        if (f.t === "welcome") {
          ownerPid = f.ownerPid;
        } else if (f.t === "result") {
          const p = pending.get(f.id);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(f.id);
            p.resolve(f.result);
          }
        } else if (f.t === "push") {
          if (f.kind === "message") pushIncoming(mcp, f.payload, config);
          else pushSystem(mcp, f.payload.content);
        }
      }
    });
    sock.on("error", () => {});
    sock.on("close", () => {
      if (pxSock === sock) {
        pxSock = null;
        role = "none";
      }
      failAllPending("owner connection closed");
    });
    writeFrame(sock, {
      t: "hello",
      protocol: PROTOCOL_VERSION,
      clientPid: process.pid,
      cfg: cfgSubset(config),
    });
    // Re-assert subscription on the new owner (owner-scoped state).
    if (localWantsSubscribe) {
      writeFrame(sock, {
        t: "call",
        id: nextReqId++,
        name: "subscribe",
        args: {},
      });
    }
  };

  const proxySend = (
    name: string,
    args: Record<string, any>
  ): Promise<ApiResponse> => {
    if (!pxSock || pxSock.destroyed) {
      return Promise.resolve({
        ok: false,
        error: "WhatsApp owner unreachable",
        code: ErrorCode.DAEMON_UNREACHABLE,
      });
    }
    const id = nextReqId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({
          ok: false,
          error: `Owner request timed out after ${REQ_TIMEOUT_MS / 1000}s`,
          code: ErrorCode.DAEMON_UNREACHABLE,
        });
      }, REQ_TIMEOUT_MS);
      timer.unref();
      pending.set(id, { resolve, timer });
      if (!writeFrame(pxSock!, { t: "call", id, name, args })) {
        clearTimeout(timer);
        pending.delete(id);
        resolve({
          ok: false,
          error: "Failed to write to owner",
          code: ErrorCode.DAEMON_UNREACHABLE,
        });
      }
    });
  };

  // ---- election ----
  const tryListen = (
    server: net.Server
  ): Promise<{ ok: true } | { ok: false; code: string }> =>
    new Promise((resolve) => {
      const onErr = (err: any) => {
        server.removeListener("listening", onOk);
        resolve({ ok: false, code: err?.code ?? "UNKNOWN" });
      };
      const onOk = () => {
        server.removeListener("error", onErr);
        try {
          chmodSync(sockPath, 0o600);
        } catch {
          /* best effort */
        }
        resolve({ ok: true });
      };
      server.once("error", onErr);
      server.once("listening", onOk);
      server.listen(sockPath);
    });

  const tryConnect = (): Promise<net.Socket | null> =>
    new Promise((resolve) => {
      const s = net.connect(sockPath);
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        if (ok) resolve(s);
        else {
          s.destroy();
          resolve(null);
        }
      };
      s.once("connect", () => finish(true));
      s.once("error", () => finish(false));
      setTimeout(() => finish(false), CONNECT_TIMEOUT_MS);
    });

  const elect = async (): Promise<void> => {
    if (electing) return electing;
    electing = (async () => {
      const deadline = Date.now() + ELECT_MAX_MS;
      for (;;) {
        mkdirSync(dirname(sockPath), { recursive: true, mode: 0o700 });
        const server = net.createServer();
        const lr = await tryListen(server);
        if (lr.ok) {
          await initOwner(server);
          return;
        }
        if (lr.code !== "EADDRINUSE" && lr.code !== "EEXIST") {
          logger.error("Socket listen failed", { code: lr.code });
          role = "none";
          return;
        }
        // Path occupied — live owner, or stale file from a dead owner.
        const s = await tryConnect();
        if (s) {
          setupProxy(s);
          return;
        }
        // No one accepting → stale socket file. Remove and retry listen.
        try {
          if (existsSync(sockPath)) unlinkSync(sockPath);
        } catch {
          /* another contender already cleared it */
        }
        if (Date.now() > deadline) {
          logger.error("Could not acquire or reach the WhatsApp owner");
          role = "none";
          return;
        }
        await sleep(80);
      }
    })();
    try {
      return await electing;
    } finally {
      electing = null;
    }
  };

  const ensureRoute = async (): Promise<void> => {
    if (role === "owner") return;
    if (role === "proxy" && pxSock && !pxSock.destroyed) return;
    await elect();
  };

  const withStatusMeta = (
    name: string,
    resp: ApiResponse
  ): ApiResponse => {
    if (name !== "status" || !resp || resp.ok === false) return resp;
    return {
      ...resp,
      role,
      ownerPid: role === "owner" ? process.pid : ownerPid,
    };
  };

  const handleToolCall = async (
    name: string,
    args: Record<string, any>
  ): Promise<ApiResponse> => {
    if (name === "subscribe") localWantsSubscribe = true;
    else if (name === "unsubscribe") localWantsSubscribe = false;
    await ensureRoute();
    if (role === "owner") {
      return withStatusMeta(name, await dispatchOwned(name, args, null));
    }
    if (role === "proxy") {
      let r = await proxySend(name, args);
      if (r.code === ErrorCode.DAEMON_UNREACHABLE) {
        // Owner vanished mid-call — re-elect (we may become the new owner)
        // and try once more. Cast defeats control-flow narrowing: elect()
        // can have changed `role` at runtime.
        await elect();
        const after = role as Role;
        if (after === "owner")
          return withStatusMeta(name, await dispatchOwned(name, args, null));
        if (after === "proxy") r = await proxySend(name, args);
      }
      return withStatusMeta(name, r);
    }
    return {
      ok: false,
      error: "WhatsApp owner unreachable",
      code: ErrorCode.DAEMON_UNREACHABLE,
      hint: "No process could acquire or reach the shared WhatsApp socket. Check the whatsup log.",
    };
  };

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    failAllPending("shutting down");
    try {
      pxSock?.destroy();
    } catch {
      /* ignore */
    }
    if (role === "owner") {
      try {
        await wa?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        ipcServer?.close();
      } catch {
        /* ignore */
      }
      try {
        if (existsSync(sockPath)) unlinkSync(sockPath);
      } catch {
        /* ignore */
      }
    }
  };

  // Establish role at startup so the owner's WhatsApp socket comes up and
  // pushes flow even before the first tool call.
  await elect();

  return { handleToolCall, shutdown };
}
