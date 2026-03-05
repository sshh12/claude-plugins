import CDP from 'chrome-remote-interface';
import Fastify from 'fastify';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConfig, getSecurityWarnings } from '../shared/config.js';
import { ErrorCode } from '../shared/types.js';
import type { BrwConfig, ApiResponse } from '../shared/types.js';
import { launchChrome, writePidFile, removePidFile, detectChromePath, getChromeVersion } from './chrome.js';
import { CDPManager } from './cdp.js';
import { handleScreenshot } from './handlers/screenshot.js';
import { handleNavigate } from './handlers/navigate.js';
import { handleClick } from './handlers/click.js';
import { handleType } from './handlers/type.js';
import { handleKey } from './handlers/key.js';
import { handleListTabs, handleNewTab, handleSwitchTab, handleCloseTab, handleNameTab } from './handlers/tabs.js';
import { handleWait } from './handlers/wait.js';
import { handleReadPage } from './handlers/read-page.js';
import { handleFormInput } from './handlers/form-input.js';
import { handleGetText } from './handlers/get-text.js';
import { handleJs } from './handlers/js.js';
import { handleHover } from './handlers/hover.js';
import { handleScroll, handleScrollTo } from './handlers/scroll.js';
import { handleDrag } from './handlers/drag.js';
import { handleWaitFor } from './handlers/wait-for.js';
import { handleDialog } from './handlers/dialog.js';
import { handleConsole } from './handlers/console.js';
import { handleNetwork, handleNetworkBody } from './handlers/network.js';
import { handleResize } from './handlers/resize.js';
import { handleFileUpload } from './handlers/file-upload.js';
import { handleQuick } from './handlers/quick.js';
import { handleGifStart, handleGifStop, handleGifExport, handleGifClear, isRecording, addFrame } from './handlers/gif.js';
import { handleCookies } from './handlers/cookies.js';
import { handleStorage } from './handlers/storage.js';
import { handleIntercept } from './handlers/intercept.js';
import { handlePdf } from './handlers/pdf.js';
import { handleEmulate } from './handlers/emulate.js';
import { handlePerf } from './handlers/perf.js';
import { handleProfileList, handleProfileShow } from './handlers/profile.js';
import { handleRunAction } from './handlers/run-action.js';
import { createLogger, setGlobalLogger, readLogTail, audit, setAuditLog } from './logger.js';
import type { Logger } from './logger.js';

let config: BrwConfig;
let cdp: CDPManager;
let logger: Logger;
let chromeProcess: Awaited<ReturnType<typeof launchChrome>> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivity = Date.now();
let chromeCrashed = false;
let isRelaunching = false;
let lastCrashTime: number | null = null;

function resetIdleTimer() {
  lastActivity = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    logger.info(`Idle timeout (${config.idleTimeout}s), shutting down`);
    shutdown();
  }, config.idleTimeout * 1000);
}

/**
 * Cleanup screenshots older than 1 hour.
 */
function cleanupScreenshots() {
  try {
    const dir = config.screenshotDir;
    const files = readdirSync(dir);
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour

    for (const file of files) {
      const filepath = join(dir, file);
      try {
        const stat = statSync(filepath);
        if (now - stat.mtimeMs > maxAge) {
          unlinkSync(filepath);
        }
      } catch {
        // ignore individual file errors
      }
    }
  } catch {
    // ignore if dir doesn't exist yet
  }
}

/**
 * Set initial viewport size and clear the New Tab Page on the default tab.
 */
async function setupInitialTab(cdpMgr: CDPManager, cfg: BrwConfig): Promise<void> {
  try {
    const tabId = cdpMgr.getActiveTabId() ?? undefined;
    const client = cdpMgr.getClient(tabId);

    // Navigate away from Chrome's New Tab Page to a blank page
    // (viewport already set by attachToTarget in connect())
    await client.Page.navigate({ url: 'about:blank' });
    await client.Page.loadEventFired();

    // Refresh tab list — navigation to about:blank can change target IDs
    await cdpMgr.listTabs();

    // Re-acquire client for the (possibly new) active tab and cleanly
    // reset viewport emulation to clear any NTP layout artifacts
    const finalTabId = cdpMgr.getActiveTabId() ?? undefined;
    const finalClient = cdpMgr.getClient(finalTabId);

    await finalClient.Emulation.clearDeviceMetricsOverride();
    if (cfg.headless) {
      await finalClient.Emulation.setDeviceMetricsOverride({
        width: cfg.windowWidth,
        height: cfg.windowHeight,
        deviceScaleFactor: 1,
        mobile: false,
      });
    }

    // Reset scroll position — NTP can leave a non-zero scroll offset
    await finalClient.Runtime.evaluate({
      expression: 'window.scrollTo(0, 0)',
      returnByValue: true,
    });
  } catch (err) {
    logger.warn(`Failed to set initial viewport/blank page: ${err}`);
  }
}

/**
 * Relaunch Chrome after a crash. Called on next CLI command.
 */
async function relaunchChrome(): Promise<void> {
  if (isRelaunching) {
    // Wait for in-progress relaunch
    while (isRelaunching) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return;
  }
  isRelaunching = true;
  try {
    logger.info('Relaunching Chrome...');
    await cdp.closeAll();

    // Try reconnecting to existing Chrome first
    let reconnected = false;
    try {
      const targets = await CDP.List({ port: config.cdpPort });
      const pageTargets = targets.filter((t: any) => t.type === 'page');
      if (pageTargets.length > 0) {
        logger.info(`Found existing Chrome on CDP port ${config.cdpPort} (${pageTargets.length} tabs)`);
        chromeProcess = null;
        reconnected = true;
      }
    } catch {
      // No existing Chrome
    }

    if (!reconnected) {
      if (!config.chromeLaunch) {
        throw new Error(`No existing Chrome found on CDP port ${config.cdpPort} and chromeLaunch is disabled. Start Chrome manually with: google-chrome --remote-debugging-port=${config.cdpPort}`);
      }
      chromeProcess = await launchChrome(config);
      setupChromeExitHandler();
    }

    const downloadDir = join(config.screenshotDir, 'downloads');
    cdp = new CDPManager(config.cdpPort, downloadDir, config.headless);
    cdp.setViewport(config.windowWidth, config.windowHeight);
    await cdp.connect();

    // Set viewport and clear NTP on fresh Chrome only
    if (!reconnected) {
      await setupInitialTab(cdp, config);
    }

    chromeCrashed = false;
    logger.info('Chrome relaunched and connected');
  } catch (err) {
    logger.error(`Chrome relaunch failed: ${err}`);
    throw err;
  } finally {
    isRelaunching = false;
  }
}

function setupChromeExitHandler() {
  chromeProcess?.on('exit', (code) => {
    logger.warn(`Chrome exited with code ${code}`);
    // Don't set crashed flag if we're shutting down
    if (!chromeProcess?.killed) {
      logger.error('Chrome crashed, will relaunch on next command');
      chromeCrashed = true;
      lastCrashTime = Date.now();
    }
  });
}

async function shutdown() {
  await shutdownProxy(false);
}

async function shutdownProxy(keepChrome = false) {
  audit('proxy_stop', { keepChrome });
  logger.info(`Shutting down...${keepChrome ? ' (keeping Chrome alive)' : ''}`);
  try {
    await cdp?.closeAll();
  } catch {
    // ignore
  }
  if (!keepChrome && chromeProcess && !chromeProcess.killed) {
    chromeProcess.kill('SIGTERM');
    // Force kill after 3s
    setTimeout(() => {
      if (chromeProcess && !chromeProcess.killed) {
        chromeProcess.kill('SIGKILL');
      }
    }, 3000);
  }
  removePidFile();
  process.exit(0);
}

/**
 * Wrap a mutation handler with per-tab mutex, GIF frame capture,
 * download tracking, dialog warning propagation, and error handling.
 */
function mutationHandler(
  commandName: string,
  handler: (body: any) => Promise<ApiResponse>,
  options?: { skipAutoScreenshotOverride?: boolean }
): (request: any, reply: any) => Promise<void> {
  return async (request, reply) => {
    // Command disable check
    if (config.disabledCommands.includes(commandName)) {
      audit('command_disabled', { command: commandName });
      reply.send({
        ok: false,
        error: `Command "${commandName}" is disabled by security policy`,
        code: 'COMMAND_DISABLED',
      });
      return;
    }
    const reqStart = Date.now();
    const reqUrl = (request.url as string) || '';
    resetIdleTimer();

    // Chrome crash recovery: relaunch if crashed
    if (chromeCrashed) {
      try {
        await relaunchChrome();
      } catch (err: any) {
        logger.error(`${reqUrl} crashed Chrome relaunch failed`, { error: err?.message });
        reply.send({
          ok: false,
          error: `Chrome crashed and relaunch failed: ${err?.message || 'Unknown error'}`,
          code: 'CDP_ERROR',
        });
        return;
      }
    }

    const body = (request.body as any) || {};
    if (config.autoScreenshot === false && body.noScreenshot === undefined && !options?.skipAutoScreenshotOverride) {
      body.noScreenshot = true;
    }
    const tabId = body.tab || cdp.getActiveTabId();

    const HANDLER_TIMEOUT = 60_000; // 60s hard limit to prevent indefinite mutex hold
    let release: (() => void) | undefined;
    try {
      if (tabId) {
        release = await cdp.acquireMutex(tabId);
      }
      const result = await Promise.race([
        handler(body),
        new Promise<ApiResponse>((_, reject) =>
          setTimeout(() => reject(new Error('Handler timeout exceeded (60s)')), HANDLER_TIMEOUT)
        ),
      ]);

      // GIF frame capture: after successful mutation, capture a frame if recording
      if (result.ok && result.screenshot && tabId && isRecording(tabId)) {
        try {
          const client = cdp.getClient(tabId);
          const { data } = await client.Page.captureScreenshot({ format: 'png' });
          const screenshotBuffer = Buffer.from(data, 'base64');
          // Determine action name from the request URL
          const actionUrl = (request.url as string) || '';
          const actionName = actionUrl.replace('/api/', '').replace(/\//g, '-');
          addFrame(tabId, screenshotBuffer, actionName);
        } catch {
          // GIF frame capture is best-effort, don't fail the request
        }
      }

      // Dialog warning propagation: include auto-dismissed dialog warnings
      if (result.ok && tabId) {
        try {
          const autoDismissed = cdp.consumeAutoDismissedDialogs(tabId);
          if (autoDismissed.length > 0) {
            result.dialogWarnings = autoDismissed.map((d) => ({
              type: d.type,
              message: d.message,
              action: d.action,
              note: 'Dialog was auto-dismissed after 5 seconds',
            }));
          }
        } catch {
          // best-effort
        }
      }

      // Download tracking: include download info if a download was triggered
      if (result.ok && tabId) {
        try {
          const download = cdp.consumePendingDownload(tabId);
          if (download && download.state === 'completed') {
            result.download = {
              path: download.path,
              filename: download.filename,
              size: download.size,
            };
          }
        } catch {
          // best-effort
        }
      }

      logger.info(`${reqUrl} ${Date.now() - reqStart}ms`, { ok: result.ok, tab: tabId || 'active' });
      reply.send(result);
    } catch (err: any) {
      logger.error(`${reqUrl} ${Date.now() - reqStart}ms`, { error: err?.message, tab: tabId || 'active' });
      reply.send(errorResponse(err));
    } finally {
      release?.();
    }
  };
}

/**
 * Wrap a read-only handler (no mutex needed).
 */
function readHandler(
  commandName: string,
  handler: (body: any) => Promise<ApiResponse>
): (request: any, reply: any) => Promise<void> {
  return async (request, reply) => {
    // Command disable check
    if (config.disabledCommands.includes(commandName)) {
      audit('command_disabled', { command: commandName });
      reply.send({
        ok: false,
        error: `Command "${commandName}" is disabled by security policy`,
        code: 'COMMAND_DISABLED',
      });
      return;
    }
    const reqStart = Date.now();
    const reqUrl = (request.url as string) || '';
    resetIdleTimer();

    // Chrome crash recovery: relaunch if crashed
    if (chromeCrashed) {
      try {
        await relaunchChrome();
      } catch (err: any) {
        logger.error(`${reqUrl} crashed Chrome relaunch failed`, { error: err?.message });
        reply.send({
          ok: false,
          error: `Chrome crashed and relaunch failed: ${err?.message || 'Unknown error'}`,
          code: 'CDP_ERROR',
        });
        return;
      }
    }

    const body = (request.body as any) || (request.query as any) || {};
    try {
      const result = await handler(body);
      logger.info(`${reqUrl} ${Date.now() - reqStart}ms`, { ok: result.ok });
      reply.send(result);
    } catch (err: any) {
      logger.error(`${reqUrl} ${Date.now() - reqStart}ms`, { error: err?.message });
      reply.send(errorResponse(err));
    }
  };
}

function errorResponse(err: any): ApiResponse {
  const message = err?.message || 'Unknown error';
  let code: string = ErrorCode.CDP_ERROR;

  if (message.includes('not found') && !message.includes('Ref') && !message.includes('Selector')) code = ErrorCode.TAB_NOT_FOUND;
  if (message.includes('Ref') && message.includes('not found')) code = ErrorCode.REF_NOT_FOUND;
  if (message.includes('Selector') && message.includes('not found')) code = ErrorCode.SELECTOR_NOT_FOUND;
  if (message.includes('Handler timeout exceeded')) code = ErrorCode.TIMEOUT;
  if (message.includes('protocol') && message.includes('blocked')) code = ErrorCode.PROTOCOL_BLOCKED;
  if (message.includes('Could not handle dialog') || message.includes('No dialog')) code = ErrorCode.DIALOG_NOT_FOUND;

  return {
    ok: false,
    error: message,
    code,
    hint: getErrorHint(code),
  };
}

function getErrorHint(code: string): string {
  switch (code) {
    case ErrorCode.TAB_NOT_FOUND:
      return 'Use "brw tabs" to list available tabs';
    case ErrorCode.REF_NOT_FOUND:
      return 'Refs expire after page navigation or DOM mutations (SPA re-renders). Run "brw read-page" to get fresh refs.';
    case ErrorCode.SELECTOR_NOT_FOUND:
      return 'Check the selector with "brw js document.querySelector(...)". Try "brw read-page --search <text>" to find elements.';
    case ErrorCode.URL_BLOCKED:
      return 'Check allowedUrls in .claude/brw.json or BRW_ALLOWED_URLS env var';
    case ErrorCode.CDP_ERROR:
      return 'Chrome may have crashed. Try: brw server stop && brw server start';
    case ErrorCode.PROXY_NOT_RUNNING:
      return 'Is the proxy running? Check: brw server status';
    case ErrorCode.PROXY_START_FAILED:
      return 'Check if the proxy port is already in use, or try a different port with BRW_PORT';
    case ErrorCode.TIMEOUT:
      return 'Increase timeout with --timeout flag';
    case ErrorCode.FILE_NOT_FOUND:
      return 'Check the file path exists and is readable';
    case ErrorCode.FRAME_NOT_FOUND:
      return 'Use brw read-page to see available frames, or try --frame by index (0, 1, ...)';
    case ErrorCode.CHROME_NOT_FOUND:
      return 'Install Chrome/Chromium or set BRW_CHROME_PATH to the browser binary path';
    case ErrorCode.CHROME_LAUNCH_FAILED:
      return 'Chrome failed to launch. Check BRW_CHROME_PATH and ensure the binary is executable. Try: brw server stop first.';
    case ErrorCode.INVALID_ARGUMENT:
      return 'Check the command usage with brw <command> --help';
    case ErrorCode.DIALOG_NOT_FOUND:
      return 'No dialog is currently open. Dialogs must be handled within 5 seconds before they are auto-dismissed.';
    case ErrorCode.NETWORK_REQUEST_NOT_FOUND:
      return 'The network request may have already completed. Use "brw network" to list recent requests.';
    case ErrorCode.JS_ERROR:
      return 'Check the JavaScript expression for syntax errors. Use "brw js" to run expressions.';
    case ErrorCode.INTERCEPT_ERROR:
      return 'Check intercept rule pattern and ensure Fetch domain is enabled. Use "brw intercept list" to see active rules.';
    case ErrorCode.PROFILE_NOT_FOUND:
      return 'Use "brw profile list" to see available profiles. Profiles are discovered from .claude/brw/profiles/ and ~/.config/brw/profiles/.';
    case ErrorCode.COMMAND_DISABLED:
      return 'Check disabledCommands in brw config or BRW_DISABLED_COMMANDS env var';
    case ErrorCode.PATH_BLOCKED:
      return 'Check allowedPaths in brw config or BRW_ALLOWED_PATHS env var';
    case ErrorCode.PROTOCOL_BLOCKED:
      return 'Set BRW_BLOCKED_PROTOCOLS to override blocked protocols (comma-separated), or use empty string to allow all.';
    default:
      return '';
  }
}

async function main() {
  // Ignore SIGPIPE immediately — the CLI launcher pipes stderr during startup
  // then destroys the read end; without this handler the default action kills us.
  // Must be registered before any async work to avoid a race with the launcher.
  process.on('SIGPIPE', () => {});

  config = getConfig();
  logger = createLogger(config.logFile);
  setGlobalLogger(logger);
  logger.info(`Config: port=${config.proxyPort} cdp=${config.cdpPort} idle=${config.idleTimeout}s viewport=${config.windowWidth}x${config.windowHeight} headless=${config.headless}`);

  // Set up audit log
  if (config.auditLog) {
    setAuditLog(config.auditLog);
  }

  // Log security policy
  logger.info('Security policy', {
    allowedUrls: config.allowedUrls,
    blockedUrls: config.blockedUrls,
    blockedProtocols: config.blockedProtocols,
    disabledCommands: config.disabledCommands,
    cookieScope: config.cookieScope,
    auditLog: config.auditLog || 'disabled',
    allowedPaths: config.allowedPaths || 'unrestricted',
  });

  // Log security warnings from config resolution
  const warnings = getSecurityWarnings();
  for (const w of warnings) {
    logger.warn(w);
    audit('config_override_blocked', { warning: w });
  }

  audit('proxy_start', { port: config.proxyPort, cdpPort: config.cdpPort });

  // Create download directory
  const downloadDir = join(config.screenshotDir, 'downloads');
  mkdirSync(downloadDir, { recursive: true, mode: process.platform === 'linux' ? 0o700 : undefined });

  // Try connecting to existing Chrome before launching a new one
  let existingChrome = false;
  try {
    const targets = await CDP.List({ port: config.cdpPort });
    const pageTargets = targets.filter((t: any) => t.type === 'page');
    if (pageTargets.length > 0) {
      logger.info(`Found existing Chrome on CDP port ${config.cdpPort} (${pageTargets.length} tabs)`);
      existingChrome = true;
      chromeProcess = null;
    }
  } catch {
    // No existing Chrome — launch one
  }

  if (!existingChrome) {
    if (!config.chromeLaunch) {
      throw new Error(`No existing Chrome found on CDP port ${config.cdpPort} and chromeLaunch is disabled. Start Chrome manually with: google-chrome --remote-debugging-port=${config.cdpPort}`);
    }
    logger.info(`Launching Chrome on CDP port ${config.cdpPort}...`);
    chromeProcess = await launchChrome(config);
    setupChromeExitHandler();
  }

  // Connect to Chrome via CDP
  logger.info('Connecting to Chrome CDP...');
  cdp = new CDPManager(config.cdpPort, downloadDir, config.headless);
  cdp.setViewport(config.windowWidth, config.windowHeight);
  await cdp.connect();
  logger.info('Connected to Chrome CDP');

  // Set initial viewport on the default tab and clear the NTP (only for fresh Chrome)
  if (!existingChrome) {
    await setupInitialTab(cdp, config);
  }

  // Create Fastify server
  const server = Fastify({ logger: false });

  // Health check — lightweight, non-blocking CDP ping
  server.get('/health', async () => {
    const chromePath = config.chromePath || detectChromePath();
    let cdpOk = false;
    try {
      const tabId = cdp.getActiveTabId();
      if (tabId) {
        const client = cdp.getClient(tabId);
        await client.Runtime.evaluate({ expression: '1', returnByValue: true, timeout: 2000 });
        cdpOk = true;
      }
    } catch {
      cdpOk = false;
    }
    // Schedule tab list refresh in background (don't await — avoids blocking health check)
    cdp.listTabs().catch(() => {});
    return {
      ok: cdpOk && !chromeCrashed,
      pid: process.pid,
      port: config.proxyPort,
      chromeVersion: chromePath ? getChromeVersion(chromePath) : null,
      uptime: Math.round((Date.now() - lastActivity) / 1000),
      cdpConnected: cdpOk,
      chromeCrashed,
      lastCrashTime,
      // Resolved security config
      blockedProtocols: config.blockedProtocols,
      blockedUrls: config.blockedUrls,
      allowedUrls: config.allowedUrls,
      disabledCommands: config.disabledCommands,
      cookieScope: config.cookieScope,
      auditLog: config.auditLog,
      allowedPaths: config.allowedPaths,
      headless: config.headless,
      autoScreenshot: config.autoScreenshot,
    };
  });

  // Shutdown — start shutdown after response is fully flushed
  server.post('/shutdown', async (request, reply) => {
    const body = (request.body as any) || {};
    const keepChrome = !!body.keepChrome;
    reply.raw.on('finish', () => {
      process.nextTick(() => shutdownProxy(keepChrome));
    });
    return { ok: true };
  });

  // Log endpoint — returns last N lines of the proxy log
  server.get('/api/log', async (request) => {
    const query = (request.query as any) || {};
    const lines = parseInt(query.lines, 10) || 50;
    const tail = readLogTail(config.logFile, lines);
    return { ok: true, log: tail };
  });

  // --- Mutation endpoints (with per-tab mutex) ---

  server.post('/api/screenshot', mutationHandler('screenshot', async (body) => handleScreenshot(cdp, config, body), { skipAutoScreenshotOverride: true }));
  server.post('/api/navigate', mutationHandler('navigate', async (body) => handleNavigate(cdp, config, body)));
  server.post('/api/click', mutationHandler('click', async (body) => handleClick(cdp, config, body)));
  server.post('/api/type', mutationHandler('type', async (body) => handleType(cdp, config, body)));
  server.post('/api/key', mutationHandler('key', async (body) => handleKey(cdp, config, body)));
  server.post('/api/wait', mutationHandler('wait', async (body) => handleWait(cdp, config, body)));
  server.post('/api/tabs/switch', mutationHandler('tabs-switch', async (body) => handleSwitchTab(cdp, config, body)));
  server.post('/api/hover', mutationHandler('hover', async (body) => handleHover(cdp, config, body)));
  server.post('/api/scroll', mutationHandler('scroll', async (body) => handleScroll(cdp, config, body)));
  server.post('/api/scroll-to', mutationHandler('scroll-to', async (body) => handleScrollTo(cdp, config, body)));
  server.post('/api/drag', mutationHandler('drag', async (body) => handleDrag(cdp, config, body)));
  server.post('/api/form-input', mutationHandler('form-input', async (body) => handleFormInput(cdp, config, body)));
  server.post('/api/resize', mutationHandler('resize', async (body) => handleResize(cdp, config, body)));
  server.post('/api/file-upload', mutationHandler('file-upload', async (body) => handleFileUpload(cdp, config, body)));
  server.post('/api/wait-for', mutationHandler('wait-for', async (body) => handleWaitFor(cdp, config, body)));
  server.post('/api/dialog', mutationHandler('dialog', async (body) => handleDialog(cdp, config, body)));
  server.post('/api/emulate', mutationHandler('emulate', async (body) => handleEmulate(cdp, body)));
  server.post('/api/quick', mutationHandler('quick', async (body) => handleQuick(cdp, config, body)));
  server.post('/api/run', mutationHandler('run', async (body) => handleRunAction(cdp, config, body)));

  // --- Read endpoints ---

  server.get('/api/tabs', readHandler('tabs', async () => handleListTabs(cdp)));
  server.post('/api/tabs/new', mutationHandler('tabs-new', async (body) => handleNewTab(cdp, config, body)));
  server.post('/api/tabs/close', mutationHandler('tabs-close', async (body) => handleCloseTab(cdp, body)));
  server.post('/api/tabs/name', readHandler('tabs-name', async (body) => handleNameTab(cdp, body)));
  server.post('/api/read-page', readHandler('read-page', async (body) => handleReadPage(cdp, body)));
  server.post('/api/get-text', readHandler('get-text', async (body) => handleGetText(cdp, body)));
  server.post('/api/js', readHandler('js', async (body) => handleJs(cdp, body, config)));
  server.post('/api/console', readHandler('console', async (body) => handleConsole(cdp, body)));
  server.post('/api/network', readHandler('network', async (body) => handleNetwork(cdp, body)));
  server.post('/api/network-body', readHandler('network-body', async (body) => handleNetworkBody(cdp, body)));
  server.post('/api/cookies', readHandler('cookies', async (body) => handleCookies(cdp, body, config)));
  server.post('/api/storage', readHandler('storage', async (body) => handleStorage(cdp, body)));
  server.post('/api/intercept', readHandler('intercept', async (body) => handleIntercept(cdp, body, config)));
  server.post('/api/pdf', readHandler('pdf', async (body) => handlePdf(cdp, config, body)));
  server.get('/api/perf', readHandler('perf', async (body) => handlePerf(cdp, body)));
  server.post('/api/gif/start', readHandler('gif-start', async (body) => handleGifStart(cdp, body)));
  server.post('/api/gif/stop', readHandler('gif-stop', async (body) => handleGifStop(cdp, body)));
  server.post('/api/gif/export', readHandler('gif-export', async (body) => handleGifExport(cdp, config, body)));
  server.post('/api/gif/clear', readHandler('gif-clear', async (body) => handleGifClear(cdp, body)));
  server.post('/api/profiles', readHandler('profiles', async (body) => handleProfileList(body)));
  server.post('/api/profiles/show', readHandler('profiles-show', async (body) => handleProfileShow(body)));

  // Start the server
  writePidFile(process.pid, config.proxyPort, chromeProcess?.pid);
  resetIdleTimer();

  // Periodic screenshot cleanup (every 10 minutes)
  setInterval(cleanupScreenshots, 10 * 60 * 1000);
  cleanupScreenshots();

  try {
    await server.listen({ port: config.proxyPort, host: '127.0.0.1' });
    logger.info(`Listening on http://127.0.0.1:${config.proxyPort}`);
  } catch (err) {
    logger.error(`Failed to start server: ${err}`);
    removePidFile();
    process.exit(1);
  }

  // Handle signals
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[brw-proxy] Fatal error:', err); // logger may not be initialized yet
  removePidFile();
  process.exit(1);
});
