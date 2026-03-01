import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { checkAllowedUrl } from '../../shared/config.js';
import { handleScreenshot } from './screenshot.js';

export async function handleListTabs(cdp: CDPManager): Promise<ApiResponse> {
  const tabs = await cdp.listTabs();
  const activeTab = cdp.getActiveTabId();
  return { ok: true, tabs, activeTab };
}

export async function handleNewTab(
  cdp: CDPManager,
  config: BrwConfig,
  params: { url?: string }
): Promise<ApiResponse> {
  let url = params.url;

  if (url) {
    // Auto-prepend https://
    if (!/^https?:\/\//i.test(url) && !url.startsWith('about:') && !url.startsWith('file:')) {
      url = 'https://' + url;
    }
    // Check URL allowlist
    if (!checkAllowedUrl(url, config.allowedUrls)) {
      return {
        ok: false,
        error: `URL ${url} is not in the allowlist. Allowed: ${config.allowedUrls.join(', ')}`,
        code: 'URL_BLOCKED',
      };
    }
  }

  const result = await cdp.createTab(url);
  return { ok: true, tabId: result.tabId, url: result.url };
}

export async function handleSwitchTab(
  cdp: CDPManager,
  config: BrwConfig,
  params: { tabId: string; noScreenshot?: boolean }
): Promise<ApiResponse> {
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
  const tabs = await cdp.closeTab(params.tabId);
  return { ok: true, tabs };
}
