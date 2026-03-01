import Fastify from 'fastify';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConfig } from '../shared/config.js';
import { ErrorCode } from '../shared/types.js';
import type { BrwConfig, ApiResponse } from '../shared/types.js';
import { launchChrome, writePidFile, removePidFile, detectChromePath, getChromeVersion } from './chrome.js';
import { CDPManager } from './cdp.js';
import { handleScreenshot } from './handlers/screenshot.js';
import { handleNavigate } from './handlers/navigate.js';
import { handleClick } from './handlers/click.js';
import { handleType } from './handlers/type.js';
import { handleKey } from './handlers/key.js';
import { handleListTabs, handleNewTab, handleSwitchTab, handleCloseTab } from './handlers/tabs.js';
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

let config: BrwConfig;
let cdp: CDPManager;
let chromeProcess: Awaited<ReturnType<typeof launchChrome>> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let lastActivity = Date.now();
let chromeCrashed = false;
let isRelaunching = false;

function resetIdleTimer() {
  lastActivity = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.error(`[brw-proxy] Idle timeout (${config.idleTimeout}s), shutting down`);
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
    const tabId = cdpMgr.getActiveTabId();
    const client = cdpMgr.getClient(tabId);

    // Set viewport to configured dimensions
    await client.Emulation.setDeviceMetricsOverride({
      width: cfg.windowWidth,
      height: cfg.windowHeight,
      deviceScaleFactor: 0,
      mobile: false,
    });

    // Navigate away from Chrome's New Tab Page to a blank page
    await client.Page.navigate({ url: 'about:blank' });
    await client.Page.loadEventFired();
  } catch (err) {
    console.error('[brw-proxy] Warning: failed to set initial viewport/blank page:', err);
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
    console.error('[brw-proxy] Relaunching Chrome...');
    await cdp.closeAll();
    chromeProcess = await launchChrome(config);
    setupChromeExitHandler();
    const downloadDir = join(config.screenshotDir, 'downloads');
    cdp = new CDPManager(config.cdpPort, downloadDir);
    await cdp.connect();

    // Set viewport and clear NTP on relaunched Chrome
    await setupInitialTab(cdp, config);

    chromeCrashed = false;
    console.error('[brw-proxy] Chrome relaunched and connected');
  } catch (err) {
    console.error('[brw-proxy] Chrome relaunch failed:', err);
    throw err;
  } finally {
    isRelaunching = false;
  }
}

function setupChromeExitHandler() {
  chromeProcess?.on('exit', (code) => {
    console.error(`[brw-proxy] Chrome exited with code ${code}`);
    // Don't set crashed flag if we're shutting down
    if (!chromeProcess?.killed) {
      console.error('[brw-proxy] Chrome crashed, will relaunch on next command');
      chromeCrashed = true;
    }
  });
}

async function shutdown() {
  console.error('[brw-proxy] Shutting down...');
  try {
    await cdp?.closeAll();
  } catch {
    // ignore
  }
  if (chromeProcess && !chromeProcess.killed) {
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
  handler: (body: any) => Promise<ApiResponse>
): (request: any, reply: any) => Promise<void> {
  return async (request, reply) => {
    resetIdleTimer();

    // Chrome crash recovery: relaunch if crashed
    if (chromeCrashed) {
      try {
        await relaunchChrome();
      } catch (err: any) {
        reply.send({
          ok: false,
          error: `Chrome crashed and relaunch failed: ${err?.message || 'Unknown error'}`,
          code: 'CDP_ERROR',
        });
        return;
      }
    }

    const body = (request.body as any) || {};
    const tabId = body.tab || cdp.getActiveTabId();

    let release: (() => void) | undefined;
    try {
      release = await cdp.acquireMutex(tabId ?? undefined);
      const result = await handler(body);

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

      reply.send(result);
    } catch (err: any) {
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
  handler: (body: any) => Promise<ApiResponse>
): (request: any, reply: any) => Promise<void> {
  return async (request, reply) => {
    resetIdleTimer();

    // Chrome crash recovery: relaunch if crashed
    if (chromeCrashed) {
      try {
        await relaunchChrome();
      } catch (err: any) {
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
      reply.send(result);
    } catch (err: any) {
      reply.send(errorResponse(err));
    }
  };
}

function errorResponse(err: any): ApiResponse {
  const message = err?.message || 'Unknown error';
  let code: string = ErrorCode.CDP_ERROR;

  if (message.includes('not found')) code = ErrorCode.TAB_NOT_FOUND;
  if (message.includes('Ref')) code = ErrorCode.REF_NOT_FOUND;
  if (message.includes('Selector')) code = ErrorCode.SELECTOR_NOT_FOUND;

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
      return 'Refs expire after page navigation. Run "brw read-page" to get fresh refs.';
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
    default:
      return '';
  }
}

async function main() {
  config = getConfig();

  // Create download directory
  const downloadDir = join(config.screenshotDir, 'downloads');
  mkdirSync(downloadDir, { recursive: true });

  // Launch Chrome
  console.error(`[brw-proxy] Launching Chrome on CDP port ${config.cdpPort}...`);
  chromeProcess = await launchChrome(config);
  setupChromeExitHandler();

  // Connect to Chrome via CDP
  console.error('[brw-proxy] Connecting to Chrome CDP...');
  cdp = new CDPManager(config.cdpPort, downloadDir);
  await cdp.connect();
  console.error('[brw-proxy] Connected to Chrome CDP');

  // Set initial viewport on the default tab and clear the NTP
  await setupInitialTab(cdp, config);

  // Create Fastify server
  const server = Fastify({ logger: false });

  // Health check
  server.get('/health', async () => {
    const chromePath = config.chromePath || detectChromePath();
    return {
      ok: true,
      pid: process.pid,
      port: config.proxyPort,
      chromeVersion: chromePath ? getChromeVersion(chromePath) : null,
      uptime: Math.round((Date.now() - lastActivity) / 1000),
    };
  });

  // Shutdown
  server.post('/shutdown', async (_, reply) => {
    reply.send({ ok: true });
    setTimeout(shutdown, 100);
  });

  // --- Mutation endpoints (with per-tab mutex) ---

  server.post(
    '/api/screenshot',
    mutationHandler(async (body) => handleScreenshot(cdp, config, body))
  );

  server.post(
    '/api/navigate',
    mutationHandler(async (body) => handleNavigate(cdp, config, body))
  );

  server.post(
    '/api/click',
    mutationHandler(async (body) => handleClick(cdp, config, body))
  );

  server.post(
    '/api/type',
    mutationHandler(async (body) => handleType(cdp, config, body))
  );

  server.post(
    '/api/key',
    mutationHandler(async (body) => handleKey(cdp, config, body))
  );

  server.post(
    '/api/wait',
    mutationHandler(async (body) => handleWait(cdp, config, body))
  );

  // --- Tab endpoints ---

  server.get(
    '/api/tabs',
    readHandler(async () => handleListTabs(cdp))
  );

  server.post(
    '/api/tabs/new',
    readHandler(async (body) => handleNewTab(cdp, config, body))
  );

  server.post(
    '/api/tabs/switch',
    mutationHandler(async (body) => handleSwitchTab(cdp, config, body))
  );

  server.post(
    '/api/tabs/close',
    readHandler(async (body) => handleCloseTab(cdp, body))
  );

  // --- Phase 2: Page reading and interaction ---

  server.post(
    '/api/hover',
    mutationHandler(async (body) => handleHover(cdp, config, body))
  );

  server.post(
    '/api/scroll',
    mutationHandler(async (body) => handleScroll(cdp, config, body))
  );

  server.post(
    '/api/scroll-to',
    mutationHandler(async (body) => handleScrollTo(cdp, config, body))
  );

  server.post(
    '/api/drag',
    mutationHandler(async (body) => handleDrag(cdp, config, body))
  );

  server.post(
    '/api/read-page',
    readHandler(async (body) => handleReadPage(cdp, body))
  );

  server.post(
    '/api/form-input',
    mutationHandler(async (body) => handleFormInput(cdp, config, body))
  );

  server.post(
    '/api/get-text',
    readHandler(async (body) => handleGetText(cdp, body))
  );

  server.post(
    '/api/js',
    readHandler(async (body) => handleJs(cdp, body))
  );
  server.post(
    '/api/console',
    readHandler(async (body) => handleConsole(cdp, body))
  );

  server.post(
    '/api/network',
    readHandler(async (body) => handleNetwork(cdp, body))
  );

  server.post(
    '/api/network-body',
    readHandler(async (body) => handleNetworkBody(cdp, body))
  );

  server.post(
    '/api/resize',
    mutationHandler(async (body) => handleResize(cdp, config, body))
  );

  server.post(
    '/api/file-upload',
    mutationHandler(async (body) => handleFileUpload(cdp, config, body))
  );
  server.post(
    '/api/wait-for',
    mutationHandler(async (body) => handleWaitFor(cdp, config, body))
  );

  server.post(
    '/api/dialog',
    mutationHandler(async (body) => handleDialog(cdp, config, body))
  );

  // --- Phase 4: Advanced browser features ---

  server.post(
    '/api/cookies',
    readHandler(async (body) => handleCookies(cdp, body))
  );

  server.post(
    '/api/storage',
    readHandler(async (body) => handleStorage(cdp, body))
  );

  server.post(
    '/api/intercept',
    readHandler(async (body) => handleIntercept(cdp, body))
  );

  server.post(
    '/api/pdf',
    readHandler(async (body) => handlePdf(cdp, config, body))
  );

  server.post(
    '/api/emulate',
    mutationHandler(async (body) => handleEmulate(cdp, body))
  );

  server.get(
    '/api/perf',
    readHandler(async (body) => handlePerf(cdp, body))
  );
  server.post(
    '/api/quick',
    mutationHandler(async (body) => handleQuick(cdp, config, body))
  );

  server.post(
    '/api/gif/start',
    readHandler(async (body) => handleGifStart(cdp, body))
  );

  server.post(
    '/api/gif/stop',
    readHandler(async (body) => handleGifStop(cdp, body))
  );

  server.post(
    '/api/gif/export',
    readHandler(async (body) => handleGifExport(cdp, config, body))
  );

  server.post(
    '/api/gif/clear',
    readHandler(async (body) => handleGifClear(cdp, body))
  );

  // Start the server
  writePidFile(process.pid, config.proxyPort, chromeProcess?.pid);
  resetIdleTimer();

  // Periodic screenshot cleanup (every 10 minutes)
  setInterval(cleanupScreenshots, 10 * 60 * 1000);
  cleanupScreenshots();

  try {
    await server.listen({ port: config.proxyPort, host: '127.0.0.1' });
    console.error(`[brw-proxy] Listening on http://127.0.0.1:${config.proxyPort}`);
  } catch (err) {
    console.error(`[brw-proxy] Failed to start server:`, err);
    removePidFile();
    process.exit(1);
  }

  // Handle signals
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[brw-proxy] Fatal error:', err);
  removePidFile();
  process.exit(1);
});
