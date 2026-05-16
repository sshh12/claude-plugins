import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { checkUrlPolicy } from '../../shared/config.js';
import { handleScreenshot } from './screenshot.js';
import { waitForPage } from './navigate.js';
import { getGlobalLogger } from '../logger.js';

export async function handleListTabs(cdp: CDPManager): Promise<ApiResponse> {
  const tabs = await cdp.listTabs();
  const activeTab = cdp.getActiveTabId();
  return { ok: true, tabs, activeTab };
}

export async function handleNewTab(
  cdp: CDPManager,
  config: BrwConfig,
  params: { url?: string; wait?: string; alias?: string; noScreenshot?: boolean; window?: boolean; viewport?: string }
): Promise<ApiResponse> {
  const logger = getGlobalLogger();
  let url = params.url;

  if (url) {
    // Auto-prepend https://
    if (!/^https?:\/\//i.test(url) && !url.startsWith('about:') && !url.startsWith('file:')) {
      url = 'https://' + url;
    }
    // Check URL policy
    if (!checkUrlPolicy(url, config.allowedUrls, config.blockedUrls)) {
      return {
        ok: false,
        error: `URL ${url} is blocked by security policy`,
        code: 'URL_BLOCKED',
      };
    }
  }

  const result = await cdp.createTab(url, params.window);
  logger.info('new-tab', { tabId: result.tabId, url: url || 'about:blank', newWindow: !!params.window });

  // Atomically assign alias if provided (avoids race with other agents)
  let alias: string | undefined;
  if (params.alias) {
    cdp.nameTab(params.alias, result.tabId);
    alias = params.alias;
  }

  // Apply per-tab viewport override BEFORE any wait, so first paint uses the
  // requested size. Useful for virtualized lists (Gmail, Slack, etc.) where
  // a small initial viewport mounts very few rows.
  let viewportApplied: { width: number; height: number } | undefined;
  if (params.viewport) {
    const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(params.viewport);
    if (!m) {
      return {
        ok: false,
        error: `Invalid --viewport: ${params.viewport}. Expected WxH (e.g. 1600x4000)`,
        code: 'INVALID_ARGUMENT',
      };
    }
    const width = parseInt(m[1], 10);
    const height = parseInt(m[2], 10);
    try {
      const client = cdp.getClient(result.tabId);
      await client.Emulation.setDeviceMetricsOverride({
        width, height, deviceScaleFactor: 1, mobile: false,
      });
      viewportApplied = { width, height };
    } catch (err: any) {
      logger.warn(`new-tab --viewport failed: ${err?.message}`);
    }
  }

  // If --wait is specified and a URL was provided, wait for the page to load
  if (params.wait && url) {
    const client = cdp.getClient(result.tabId);
    await waitForPage(client, params.wait);
    const page = await cdp.getPageInfo(result.tabId);
    const screenshotResult = await handleScreenshot(cdp, config, {
      tab: result.tabId,
      noScreenshot: params.noScreenshot,
    });
    const redirectInfo = describeRedirect(url, page.url);
    return {
      ok: true,
      tabId: result.tabId,
      url: page.url || result.url,
      alias,
      viewport: viewportApplied,
      ...(redirectInfo ? { redirect: redirectInfo } : {}),
      screenshot: screenshotResult.screenshot,
      page,
    };
  }

  return { ok: true, tabId: result.tabId, url: url || result.url, alias, viewport: viewportApplied };
}

/**
 * Describe how the final URL differs from the requested URL. Surfaces a
 * loginPageHeuristic when the final path looks like an auth screen — useful
 * for early-exit when an app silently kicks you to /login.
 */
function describeRedirect(requestedUrl: string, finalUrl: string | undefined): { from: string; to: string; loginPageHeuristic: boolean } | null {
  if (!finalUrl) return null;
  if (finalUrl === requestedUrl) return null;
  let toPath = finalUrl;
  try { toPath = new URL(finalUrl).pathname; } catch { /* ignore */ }
  let fromPath = requestedUrl;
  try { fromPath = new URL(requestedUrl).pathname; } catch { /* ignore */ }
  if (toPath === fromPath) return null;
  const loginPageHeuristic = /\/(login|signin|sign-in|auth|sso|oauth|account\/login)\b/i.test(toPath);
  return { from: requestedUrl, to: finalUrl, loginPageHeuristic };
}

export async function handleSwitchTab(
  cdp: CDPManager,
  config: BrwConfig,
  params: { tabId: string; noScreenshot?: boolean }
): Promise<ApiResponse> {
  const logger = getGlobalLogger();
  logger.info('switch-tab', { tabId: params.tabId });
  await cdp.activateTab(params.tabId);
  const page = await cdp.getPageInfo(params.tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: params.tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page, tabId: params.tabId };
}

export async function handleNameTab(
  cdp: CDPManager,
  params: { alias: string; tabId?: string }
): Promise<ApiResponse> {
  if (!params.alias) {
    return { ok: false, error: 'alias is required', code: 'INVALID_ARGUMENT' };
  }
  const result = cdp.nameTab(params.alias, params.tabId);
  return { ok: true, alias: result.alias, tabId: result.tabId };
}

export async function handleCloseTab(
  cdp: CDPManager,
  params: { tabId: string }
): Promise<ApiResponse> {
  const logger = getGlobalLogger();
  logger.info('close-tab', { tabId: params.tabId });
  const tabs = await cdp.closeTab(params.tabId);
  return { ok: true, tabs };
}
