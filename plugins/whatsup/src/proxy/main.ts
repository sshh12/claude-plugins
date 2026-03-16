import Fastify from "fastify";
import { writeFileSync, unlinkSync } from "fs";
import { getConfig, getSecurityWarnings } from "../shared/config.js";
import { ErrorCode } from "../shared/types.js";
import type { WhatsUpConfig, ApiResponse } from "../shared/types.js";
import { WhatsAppManager } from "./whatsapp.js";
import { MessageStore } from "./message-store.js";
import { RateLimiter } from "./rate-limiter.js";
import { enforceWriteAllowlist } from "./allowlist.js";
import { hasCredentials, clearCredentials } from "./auth.js";
import {
  createLogger,
  setGlobalLogger,
  audit,
  setAuditLog,
  readLogTail,
} from "./logger.js";
import type { Logger } from "./logger.js";

// ---- Handler imports ----
import { handleSend, handleSendLocation, handleSendContact, handleSendPoll } from "./handlers/send.js";
import { handleSendMedia } from "./handlers/send-media.js";
import { handleReact } from "./handlers/react.js";
import { handleForward } from "./handlers/forward.js";
import { handleEdit } from "./handlers/edit.js";
import { handleDelete } from "./handlers/delete.js";
import { handleMarkRead } from "./handlers/mark-read.js";
import { handleTyping } from "./handlers/typing.js";
import { handlePresence } from "./handlers/presence.js";
import { handleStatus, handleProfile } from "./handlers/status.js";
import { handlePoll } from "./handlers/poll.js";
import { handleListChats } from "./handlers/list-chats.js";
import { handleReadChat } from "./handlers/read-chat.js";
import { handleContacts } from "./handlers/contacts.js";
import { handleSearch } from "./handlers/search.js";

// ---- Module-level state ----

let config: WhatsUpConfig;
let wa: WhatsAppManager;
let messageStore: MessageStore;
let rateLimiter: RateLimiter;
let logger: Logger;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const PID_FILE = "/tmp/whatsup-proxy.pid";

// ---- Idle timer ----

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    logger.info(`Idle timeout (${config.idleTimeout}s), shutting down`);
    shutdown();
  }, config.idleTimeout * 1000);
}

// ---- Error helpers ----

function getErrorCode(message: string): ErrorCode {
  if (
    message.includes("not authenticated") ||
    message.includes("logged out") ||
    message.includes("not connected")
  ) {
    return ErrorCode.NOT_AUTHENTICATED;
  }
  if (
    message.includes("not allowlisted") ||
    message.includes("not in allowlist") ||
    message.includes("not in the allowlist")
  ) {
    return ErrorCode.CONTACT_NOT_ALLOWLISTED;
  }
  if (message.includes("rate limit")) return ErrorCode.RATE_LIMITED;
  if (message.includes("too large") || message.includes("exceeds max media"))
    return ErrorCode.MEDIA_TOO_LARGE;
  if (message.includes("File not found") || message.includes("not found"))
    return ErrorCode.MEDIA_NOT_FOUND;
  if (message.includes("path") && message.includes("blocked"))
    return ErrorCode.PATH_BLOCKED;
  if (message.includes("disabled")) return ErrorCode.COMMAND_DISABLED;
  return ErrorCode.SOCKET_ERROR;
}

function getErrorHint(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.NOT_AUTHENTICATED:
      return 'Run "whatsup auth login" to authenticate';
    case ErrorCode.CONTACT_NOT_ALLOWLISTED:
      return "Add the number to WHATSUP_ALLOWLIST";
    case ErrorCode.GROUP_NOT_ALLOWLISTED:
      return "Add the group JID to WHATSUP_ALLOWLIST_GROUPS";
    case ErrorCode.RATE_LIMITED:
      return "WhatsApp may ban accounts for excessive messaging. Wait before retrying.";
    case ErrorCode.PROXY_NOT_RUNNING:
      return 'Run "whatsup server start"';
    case ErrorCode.SEND_FAILED:
      return 'Check connection with "whatsup server status"';
    case ErrorCode.MEDIA_TOO_LARGE:
      return "WhatsApp limits files to 64MB";
    case ErrorCode.MEDIA_NOT_FOUND:
      return "Check the file path exists";
    case ErrorCode.PATH_BLOCKED:
      return "File path must be under current directory or media download dir";
    case ErrorCode.COMMAND_DISABLED:
      return "Check disabledCommands in whatsup config or WHATSUP_DISABLED_COMMANDS env var";
    default:
      return 'Try "whatsup server restart"';
  }
}

function errorResponse(err: unknown): ApiResponse {
  const message = err instanceof Error ? err.message : String(err);
  const code = getErrorCode(message);
  return { ok: false, error: message, code, hint: getErrorHint(code) };
}

// ---- Handler wrappers ----

/**
 * Wrap a write handler with connection check, allowlist enforcement,
 * rate limiting, audit logging, and error handling.
 */
function writeHandler(
  commandName: string,
  handler: (body: any) => Promise<ApiResponse>
): (request: any, reply: any) => Promise<void> {
  return async (request, reply) => {
    // 1. Check disabledCommands
    if (config.disabledCommands.includes(commandName)) {
      audit("command_disabled", { command: commandName });
      reply.send({
        ok: false,
        error: `Command "${commandName}" is disabled by security policy`,
        code: ErrorCode.COMMAND_DISABLED,
        hint: getErrorHint(ErrorCode.COMMAND_DISABLED),
      });
      return;
    }

    // 2. Reset idle timer
    resetIdleTimer();

    // 3. Check connection
    if (!wa.isReady()) {
      reply.send({
        ok: false,
        error: "Not connected to WhatsApp",
        code: ErrorCode.NOT_AUTHENTICATED,
        hint: 'Run "whatsup auth login"',
      });
      return;
    }

    const body = (request.body as any) || {};

    // 4. Allowlist check (extract 'to' or 'chatId' from body)
    const target: string | undefined = body.to || body.chatId;
    if (target) {
      const blocked = enforceWriteAllowlist(target, config);
      if (blocked) {
        reply.send(blocked);
        return;
      }
    }

    // 5. Rate limit check
    if (target) {
      const limited = rateLimiter.check(target);
      if (limited) {
        reply.send(limited);
        return;
      }
    }

    // 6. Execute handler
    const start = Date.now();
    try {
      const result = await handler(body);

      // 7. Record rate limit on success
      if (result.ok && target) {
        rateLimiter.record(target);
      }

      // 8. Audit log
      audit("command", {
        command: commandName,
        target,
        ok: result.ok,
        duration: Date.now() - start,
      });

      // 9. Log
      logger.info(
        `${commandName} -> ${result.ok ? "ok" : result.error}`,
        { duration: Date.now() - start }
      );

      reply.send(result);
    } catch (err) {
      logger.error(`${commandName} error`, {
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - start,
      });
      reply.send(errorResponse(err));
    }
  };
}

/**
 * Wrap a read-only handler (no allowlist/rate limit).
 */
function readHandler(
  commandName: string,
  handler: (body: any) => Promise<ApiResponse>
): (request: any, reply: any) => Promise<void> {
  return async (request, reply) => {
    // 1. Check disabledCommands
    if (config.disabledCommands.includes(commandName)) {
      audit("command_disabled", { command: commandName });
      reply.send({
        ok: false,
        error: `Command "${commandName}" is disabled by security policy`,
        code: ErrorCode.COMMAND_DISABLED,
        hint: getErrorHint(ErrorCode.COMMAND_DISABLED),
      });
      return;
    }

    // 2. Reset idle timer
    resetIdleTimer();

    // 3. Check connection
    if (!wa.isReady()) {
      reply.send({
        ok: false,
        error: "Not connected to WhatsApp",
        code: ErrorCode.NOT_AUTHENTICATED,
        hint: 'Run "whatsup auth login"',
      });
      return;
    }

    const body = (request.body as any) || (request.query as any) || {};
    const start = Date.now();

    try {
      const result = await handler(body);
      logger.info(`${commandName} -> ${result.ok ? "ok" : result.error}`, {
        duration: Date.now() - start,
      });
      reply.send(result);
    } catch (err) {
      logger.error(`${commandName} error`, {
        error: err instanceof Error ? err.message : String(err),
        duration: Date.now() - start,
      });
      reply.send(errorResponse(err));
    }
  };
}

// ---- Shutdown ----

async function shutdown(): Promise<void> {
  logger.info("Shutting down...");
  audit("proxy_stop", {});

  try {
    await wa.disconnect();
  } catch {
    // ignore disconnect errors
  }

  try {
    await server.close();
  } catch {
    // ignore close errors
  }

  // Remove PID file
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }

  process.exit(0);
}

// ---- Fastify server (module-level for shutdown access) ----

const server = Fastify({ logger: false });

// ---- Main ----

async function main(): Promise<void> {
  // Ignore SIGPIPE immediately -- the CLI launcher pipes stderr during startup
  // then destroys the read end; without this handler the default action kills us.
  process.on("SIGPIPE", () => {});

  // 1. Parse port from WHATSUP_PORT env var (default 9226)
  const port = parseInt(process.env.WHATSUP_PORT || "9226", 10);

  // 2. Load config
  config = getConfig();

  // 3. Create logger
  logger = createLogger(config.logFile);
  setGlobalLogger(logger);
  logger.info(
    `Config: port=${port} idle=${config.idleTimeout}s readMode=${config.readMode} autoReconnect=${config.autoReconnect}`
  );

  // 4. Set up audit log
  if (config.auditLog) {
    setAuditLog(config.auditLog);
  }

  // 5. Log security warnings from config resolution
  const warnings = getSecurityWarnings();
  for (const w of warnings) {
    logger.warn(`Config warning: ${w.field} - ${w.message}`);
    audit("config_override_blocked", { field: w.field, message: w.message });
  }

  // Log security policy
  logger.info("Security policy", {
    allowlist: config.allowlist,
    allowlistGroups: config.allowlistGroups,
    disabledCommands: config.disabledCommands,
    readMode: config.readMode,
    auditLog: config.auditLog || "disabled",
    rateLimitPerContact: config.rateLimitPerContact,
    rateLimitTotal: config.rateLimitTotal,
  });

  audit("proxy_start", { port });

  // 6. Create MessageStore
  messageStore = new MessageStore(config.messageBufferSize);

  // 7. Create RateLimiter
  rateLimiter = new RateLimiter(config);

  // 8. Create WhatsAppManager
  wa = new WhatsAppManager(config, messageStore);

  // 9. Connect WhatsApp (non-blocking -- connection events are async)
  try {
    await wa.connect();
    logger.info("WhatsApp socket created");
  } catch (err) {
    logger.warn("Initial WhatsApp connection attempt failed (will retry on demand)", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ---- Route registration ----

  // Health check
  server.get("/health", async () => ({
    ok: true,
    pid: process.pid,
    port,
    status: wa.getStatus(),
    uptime: process.uptime(),
    messageBuffer: messageStore.getStats(),
    rateLimits: rateLimiter.getStats(),
  }));

  // Shutdown
  server.post("/shutdown", async (_request, reply) => {
    reply.raw.on("finish", () => {
      process.nextTick(() => shutdown());
    });
    return { ok: true };
  });

  // Log endpoint
  server.get("/api/log", async (request) => {
    const query = (request.query as any) || {};
    const lines = parseInt(query.lines, 10) || 50;
    const tail = readLogTail(config.logFile, lines);
    return { ok: true, log: tail };
  });

  // ---- Auth routes (special -- no connection check needed) ----

  server.post("/api/auth", async (request, reply) => {
    resetIdleTimer();
    const body = (request.body as any) || {};
    const action = body.action as string;

    switch (action) {
      case "login": {
        // If already connected, return status
        if (wa.isReady()) {
          const status = wa.getStatus();
          reply.send({
            ok: true,
            message: "Already connected",
            status,
          });
          return;
        }

        // Start QR flow
        let qrPath: string | null = null;
        try {
          await wa.connect({
            onQr: (_qr: string) => {
              qrPath = config.qrCodeFile;
            },
          });

          // Give a moment for QR to be generated if not yet authenticated
          if (!wa.isReady() && !qrPath) {
            await new Promise((r) => setTimeout(r, 3000));
            qrPath = config.qrCodeFile;
          }

          const status = wa.getStatus();
          reply.send({
            ok: true,
            message: wa.isReady()
              ? "Connected and authenticated"
              : "QR code generated, scan to authenticate",
            qrCodeFile: qrPath,
            status,
          });
        } catch (err) {
          reply.send(errorResponse(err));
        }
        return;
      }

      case "logout": {
        try {
          await wa.disconnect();
          await clearCredentials(config.authDir);
          reply.send({ ok: true, message: "Logged out and credentials cleared" });
        } catch (err) {
          reply.send(errorResponse(err));
        }
        return;
      }

      case "status": {
        const status = wa.getStatus();
        const hasCreds = hasCredentials(config.authDir);
        reply.send({
          ok: true,
          status,
          hasCredentials: hasCreds,
        });
        return;
      }

      default:
        reply.send({
          ok: false,
          error: `Unknown auth action: ${action}. Use "login", "logout", or "status".`,
          code: ErrorCode.INVALID_ARGUMENT,
        });
    }
  });

  // ---- Write operations (allowlist + rate limit enforced) ----

  server.post(
    "/api/send",
    writeHandler("send", (body) => handleSend(wa, config, body))
  );
  server.post(
    "/api/send-media",
    writeHandler("send-media", (body) => handleSendMedia(wa, config, body))
  );
  server.post(
    "/api/send-location",
    writeHandler("send-location", (body) => handleSendLocation(wa, config, body))
  );
  server.post(
    "/api/send-contact",
    writeHandler("send-contact", (body) => handleSendContact(wa, config, body))
  );
  server.post(
    "/api/send-poll",
    writeHandler("send-poll", (body) => handleSendPoll(wa, config, body))
  );
  server.post(
    "/api/react",
    writeHandler("react", (body) => handleReact(wa, config, body))
  );
  server.post(
    "/api/forward",
    writeHandler("forward", (body) => handleForward(wa, config, body))
  );
  server.post(
    "/api/edit",
    writeHandler("edit", (body) => handleEdit(wa, config, body))
  );
  server.post(
    "/api/delete",
    writeHandler("delete", (body) => handleDelete(wa, config, body))
  );
  server.post(
    "/api/mark-read",
    writeHandler("mark-read", (body) => handleMarkRead(wa, config, body))
  );
  server.post(
    "/api/typing",
    writeHandler("typing", (body) => handleTyping(wa, config, body))
  );
  server.post(
    "/api/presence",
    writeHandler("presence", (body) => handlePresence(wa, config, body))
  );

  // ---- Read operations (no allowlist/rate limit) ----

  server.post(
    "/api/poll",
    readHandler("poll", (body) => handlePoll(wa, config, body, messageStore))
  );
  server.get(
    "/api/chats",
    readHandler("list-chats", (body) => handleListChats(wa, config, body))
  );
  server.post(
    "/api/chat/read",
    readHandler("read-chat", (body) => handleReadChat(wa, config, body, messageStore))
  );
  server.post(
    "/api/contacts",
    readHandler("contacts", (body) => handleContacts(wa, config, body))
  );
  server.post(
    "/api/search",
    readHandler("search", (body) =>
      handleSearch(wa, config, body, messageStore)
    )
  );

  // ---- Profile (no allowlist needed) ----

  server.post(
    "/api/status",
    readHandler("status", (body) => handleStatus(wa, config, body))
  );
  server.post(
    "/api/profile",
    readHandler("profile", (body) => handleProfile(wa, config, body))
  );

  // ---- Start the server ----

  // Write PID file
  try {
    writeFileSync(PID_FILE, String(process.pid));
  } catch {
    logger.warn("Could not write PID file");
  }

  resetIdleTimer();

  try {
    await server.listen({ port, host: "127.0.0.1" });
    logger.info(`Listening on http://127.0.0.1:${port}`);
  } catch (err) {
    logger.error(`Failed to start server: ${err}`);
    try {
      unlinkSync(PID_FILE);
    } catch {
      // ignore
    }
    process.exit(1);
  }

  // Handle signals
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("[whatsup-proxy] Fatal error:", err);
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
  process.exit(1);
});
