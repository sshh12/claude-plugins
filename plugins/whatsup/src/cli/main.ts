import { Command } from "commander";
import { getConfig, resolveConfig } from "../shared/config.js";
import { ErrorCode, ExitCode } from "../shared/types.js";
import { proxyRequest, ensureProxy, formatOutput } from "./http.js";
import { startProxy, stopProxy, getProxyStatus } from "./proxy-launcher.js";
import { readLogTail } from "../proxy/logger.js";

const program = new Command();

program
  .name("whatsup")
  .description("WhatsApp messaging for Claude Code")
  .version("0.1.0")
  .option("--plain", "Plain text output", false)
  .option("--debug", "Debug mode", false)
  .option("--port <port>", "Proxy port", "9226")
  .option("--http-timeout <seconds>", "HTTP timeout", "30");

// ---- Helpers ----

function getGlobalOpts(): {
  port: number;
  plain: boolean;
  httpTimeout: number;
  debug: boolean;
} {
  const opts = program.opts();
  return {
    port: parseInt(opts.port, 10),
    plain: opts.plain,
    httpTimeout: parseInt(opts.httpTimeout, 10) || 30,
    debug: opts.debug,
  };
}

function mapExitCode(code?: string): number {
  switch (code) {
    case ErrorCode.CONTACT_NOT_ALLOWLISTED:
    case ErrorCode.GROUP_NOT_ALLOWLISTED:
      return ExitCode.ALLOWLIST_BLOCKED;
    case ErrorCode.NOT_AUTHENTICATED:
    case ErrorCode.SEND_FAILED:
    case ErrorCode.SOCKET_ERROR:
      return ExitCode.SOCKET_ERROR;
    case ErrorCode.PROXY_NOT_RUNNING:
    case ErrorCode.PROXY_START_FAILED:
      return ExitCode.PROXY_ERROR;
    default:
      return ExitCode.USAGE_ERROR;
  }
}

/**
 * Central run function: ensure proxy, send request, format output, exit.
 */
async function run(
  cmdName: string,
  path: string,
  method: "GET" | "POST",
  body: Record<string, any> | null,
  opts: { port: number; plain: boolean; httpTimeout: number; debug: boolean }
): Promise<void> {
  // 1. Ensure proxy is running
  const proxyOk = await ensureProxy({ port: opts.port, debug: opts.debug });
  if (!proxyOk) {
    process.stderr.write(
      'Failed to start proxy. Check "whatsup log" for details.\n'
    );
    process.exit(ExitCode.PROXY_ERROR);
  }

  // 2. Send request to proxy
  try {
    const response = await proxyRequest({
      port: opts.port,
      path,
      method,
      body: body || undefined,
      timeout: opts.httpTimeout,
      debug: opts.debug,
    });

    // 3. Format and output
    const output = formatOutput(response, opts.plain);
    process.stdout.write(output + "\n");

    // 4. Exit code mapping
    if (!response.ok) {
      const exitCode = mapExitCode(response.code);
      process.exit(exitCode);
    }
  } catch (err: any) {
    const msg = err?.message || "Request failed";
    const result = { ok: false as const, error: msg, code: "PROXY_ERROR" as any };
    process.stdout.write(formatOutput(result, opts.plain) + "\n");
    process.exit(ExitCode.PROXY_ERROR);
  }
}

// ---- Messaging Commands ----

program
  .command("send")
  .description("Send a text message")
  .argument("<to>", "Phone number or JID")
  .argument("<message>", "Message text")
  .option("--quote <messageId>", "Reply to message")
  .option("--mentions <jids>", "Comma-separated JIDs to mention")
  .allowUnknownOption()
  .action(async (to: string, message: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("send", "/api/send", "POST", {
      to,
      message,
      quote: cmdOpts.quote,
      mentions: cmdOpts.mentions?.split(","),
    }, opts);
  });

program
  .command("send-media")
  .description("Send media file")
  .argument("<to>", "Phone number or JID")
  .argument("<path>", "File path")
  .option("--caption <text>", "Caption")
  .option("--type <type>", "Media type (image/video/audio/document)")
  .option("--quote <messageId>", "Reply to message")
  .option("--view-once", "View once")
  .option("--file-name <name>", "File name for documents")
  .allowUnknownOption()
  .action(async (to: string, filePath: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("send-media", "/api/send-media", "POST", {
      to,
      path: filePath,
      caption: cmdOpts.caption,
      type: cmdOpts.type,
      quote: cmdOpts.quote,
      viewOnce: cmdOpts.viewOnce || false,
      fileName: cmdOpts.fileName,
    }, opts);
  });

program
  .command("send-location")
  .description("Send location")
  .argument("<to>", "Phone number or JID")
  .argument("<lat>", "Latitude")
  .argument("<lng>", "Longitude")
  .option("--name <name>", "Location name")
  .allowUnknownOption()
  .action(async (to: string, lat: string, lng: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("send-location", "/api/send-location", "POST", {
      to,
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
      name: cmdOpts.name,
    }, opts);
  });

program
  .command("send-contact")
  .description("Send contact card")
  .argument("<to>", "Phone number or JID")
  .argument("<vcard>", "vCard string")
  .allowUnknownOption()
  .action(async (to: string, vcard: string) => {
    const opts = getGlobalOpts();
    await run("send-contact", "/api/send-contact", "POST", { to, vcard }, opts);
  });

program
  .command("send-poll")
  .description("Send poll")
  .argument("<to>", "Phone number or JID")
  .argument("<question>", "Poll question")
  .option("--options <choices>", "Comma-separated options")
  .option("--multi", "Allow multiple selections")
  .allowUnknownOption()
  .action(async (to: string, question: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("send-poll", "/api/send-poll", "POST", {
      to,
      question,
      options: cmdOpts.options?.split(",") || [],
      multiSelect: cmdOpts.multi || false,
    }, opts);
  });

// ---- Reaction Commands ----

program
  .command("react")
  .description("React to a message")
  .argument("<messageId>", "Message ID")
  .argument("<emoji>", 'Emoji (empty to remove)')
  .option("--chat <chatId>", "Chat ID")
  .allowUnknownOption()
  .action(async (messageId: string, emoji: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("react", "/api/react", "POST", {
      messageId,
      emoji,
      chatId: cmdOpts.chat,
    }, opts);
  });

program
  .command("forward")
  .description("Forward a message")
  .argument("<to>", "Destination phone or JID")
  .argument("<messageId>", "Message ID to forward")
  .option("--chat <chatId>", "Source chat ID")
  .allowUnknownOption()
  .action(async (to: string, messageId: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("forward", "/api/forward", "POST", {
      to,
      messageId,
      chatId: cmdOpts.chat,
    }, opts);
  });

program
  .command("edit")
  .description("Edit a sent message")
  .argument("<messageId>", "Message ID")
  .argument("<newText>", "New text")
  .option("--chat <chatId>", "Chat ID")
  .allowUnknownOption()
  .action(async (messageId: string, newText: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("edit", "/api/edit", "POST", {
      messageId,
      newText,
      chatId: cmdOpts.chat,
    }, opts);
  });

program
  .command("delete")
  .description("Delete a message")
  .argument("<messageId>", "Message ID")
  .option("--chat <chatId>", "Chat ID")
  .option("--for-me", "Delete for me only")
  .allowUnknownOption()
  .action(async (messageId: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("delete", "/api/delete", "POST", {
      messageId,
      chatId: cmdOpts.chat,
      forMe: cmdOpts.forMe || false,
    }, opts);
  });

program
  .command("mark-read")
  .description("Mark chat as read")
  .argument("<chatId>", "Chat ID")
  .allowUnknownOption()
  .action(async (chatId: string) => {
    const opts = getGlobalOpts();
    await run("mark-read", "/api/mark-read", "POST", { chatId }, opts);
  });

// ---- Indicators ----

program
  .command("typing")
  .description("Show typing indicator")
  .argument("<to>", "Phone number or JID")
  .option("--stop", "Stop typing")
  .option("--recording", "Show recording indicator")
  .allowUnknownOption()
  .action(async (to: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("typing", "/api/typing", "POST", {
      to,
      stop: cmdOpts.stop || false,
      recording: cmdOpts.recording || false,
    }, opts);
  });

program
  .command("presence")
  .description("Set online/offline presence")
  .option("--available", "Set available")
  .option("--unavailable", "Set unavailable")
  .allowUnknownOption()
  .action(async (cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("presence", "/api/presence", "POST", {
      available: cmdOpts.available || false,
      unavailable: cmdOpts.unavailable || false,
    }, opts);
  });

// ---- Reading Commands ----

program
  .command("poll")
  .description("Long-poll for incoming messages")
  .option("--timeout <seconds>", "Poll timeout")
  .option("--from <phone>", "Filter by sender")
  .option("--chat <chatId>", "Filter by chat")
  .option("--since <timestamp>", "Messages after timestamp")
  .option("--limit <n>", "Max messages")
  .allowUnknownOption()
  .action(async (cmdOpts: any) => {
    const opts = getGlobalOpts();
    // Extend HTTP timeout to cover the poll timeout
    if (cmdOpts.timeout) {
      opts.httpTimeout = Math.max(
        opts.httpTimeout,
        parseInt(cmdOpts.timeout) + 10
      );
    }
    await run("poll", "/api/poll", "POST", {
      timeout: cmdOpts.timeout ? parseInt(cmdOpts.timeout) : undefined,
      from: cmdOpts.from,
      chat: cmdOpts.chat,
      since: cmdOpts.since ? parseInt(cmdOpts.since) : undefined,
      limit: cmdOpts.limit ? parseInt(cmdOpts.limit) : undefined,
    }, opts);
  });

program
  .command("list-chats")
  .description("List recent chats")
  .option("--limit <n>", "Max chats")
  .option("--unread-only", "Only unread chats")
  .allowUnknownOption()
  .action(async (cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("list-chats", "/api/chats", "GET", {
      limit: cmdOpts.limit ? parseInt(cmdOpts.limit) : undefined,
      unreadOnly: cmdOpts.unreadOnly || false,
    }, opts);
  });

program
  .command("read-chat")
  .description("Read messages from a chat")
  .argument("<chatId>", "Chat ID")
  .option("--limit <n>", "Max messages")
  .option("--before <messageId>", "Messages before this ID")
  .allowUnknownOption()
  .action(async (chatId: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("read-chat", "/api/chat/read", "POST", {
      chatId,
      limit: cmdOpts.limit ? parseInt(cmdOpts.limit) : undefined,
      before: cmdOpts.before,
    }, opts);
  });

program
  .command("contacts")
  .description("List/search contacts")
  .option("--search <query>", "Search contacts")
  .option("--limit <n>", "Max results")
  .allowUnknownOption()
  .action(async (cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("contacts", "/api/contacts", "POST", {
      search: cmdOpts.search,
      limit: cmdOpts.limit ? parseInt(cmdOpts.limit) : undefined,
    }, opts);
  });

program
  .command("search")
  .description("Search messages")
  .argument("<query>", "Search text")
  .option("--chat <chatId>", "Filter by chat")
  .option("--from <phone>", "Filter by sender")
  .option("--limit <n>", "Max results")
  .allowUnknownOption()
  .action(async (query: string, cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("search", "/api/search", "POST", {
      query,
      chat: cmdOpts.chat,
      from: cmdOpts.from,
      limit: cmdOpts.limit ? parseInt(cmdOpts.limit) : undefined,
    }, opts);
  });

// ---- Profile ----

program
  .command("status")
  .description("Set WhatsApp about/status text")
  .argument("<text>", "Status text")
  .allowUnknownOption()
  .action(async (text: string) => {
    const opts = getGlobalOpts();
    await run("status", "/api/status", "POST", { text }, opts);
  });

program
  .command("profile")
  .description("View/update profile")
  .option("--name <name>", "Update display name")
  .option("--picture <path>", "Update profile picture")
  .allowUnknownOption()
  .action(async (cmdOpts: any) => {
    const opts = getGlobalOpts();
    await run("profile", "/api/profile", "POST", {
      name: cmdOpts.name,
      picture: cmdOpts.picture,
    }, opts);
  });

// ---- Auth ----

program
  .command("auth")
  .description("Auth management")
  .argument("<action>", "status|login|logout")
  .allowUnknownOption()
  .action(async (action: string) => {
    const opts = getGlobalOpts();
    await run("auth", "/api/auth", "POST", { action }, opts);
  });

// ---- Server Management ----

program
  .command("server")
  .description("Proxy lifecycle management")
  .argument("<action>", "start|stop|restart|status")
  .allowUnknownOption()
  .action(async (action: string) => {
    const opts = getGlobalOpts();

    switch (action) {
      case "start": {
        const result = await startProxy({
          port: opts.port,
          debug: opts.debug,
        });
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        if (!result.ok) process.exit(ExitCode.PROXY_ERROR);
        break;
      }
      case "stop": {
        const result = await stopProxy(opts.port);
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        break;
      }
      case "restart": {
        await stopProxy(opts.port);
        const result = await startProxy({
          port: opts.port,
          debug: opts.debug,
        });
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        if (!result.ok) process.exit(ExitCode.PROXY_ERROR);
        break;
      }
      case "status": {
        const status = await getProxyStatus(opts.port);
        process.stdout.write(JSON.stringify(status, null, 2) + "\n");
        break;
      }
      default:
        process.stderr.write(
          `Unknown server action: ${action}. Use start|stop|restart|status.\n`
        );
        process.exit(ExitCode.USAGE_ERROR);
    }
  });

// ---- Local Commands (no proxy needed) ----

program
  .command("config")
  .description("Show resolved config")
  .allowUnknownOption()
  .action(async () => {
    const resolved = resolveConfig();
    const opts = program.opts();
    if (opts.plain) {
      for (const [key, entry] of Object.entries(resolved)) {
        const e = entry as { value: unknown; source: string };
        process.stdout.write(
          `${key}: ${JSON.stringify(e.value)} (${e.source})\n`
        );
      }
    } else {
      process.stdout.write(JSON.stringify(resolved, null, 2) + "\n");
    }
  });

program
  .command("log")
  .description("Show proxy log")
  .option("--lines <n>", "Number of lines", "50")
  .allowUnknownOption()
  .action(async (cmdOpts: any) => {
    const config = getConfig();
    const lines = readLogTail(config.logFile, parseInt(cmdOpts.lines));
    process.stdout.write(lines + "\n");
  });

// ---- Auto-create /tmp/whatsup symlink ----

(function autoSetupSymlink() {
  const symlinkPath = "/tmp/whatsup";
  const targetPath = __filename;
  try {
    const fs = require("fs");
    let needsCreate = true;
    if (fs.existsSync(symlinkPath)) {
      try {
        const current = fs.readlinkSync(symlinkPath);
        if (current === targetPath) needsCreate = false;
        else fs.unlinkSync(symlinkPath);
      } catch {
        try { fs.unlinkSync(symlinkPath); } catch { /* ignore */ }
      }
    }
    if (needsCreate) {
      fs.symlinkSync(targetPath, symlinkPath);
    }
  } catch {
    // Best-effort — don't fail if symlink creation fails
  }
})();

// ---- Parse ----

program.parse(process.argv);
