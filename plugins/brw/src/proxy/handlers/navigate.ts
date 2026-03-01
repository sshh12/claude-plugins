import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { checkAllowedUrl } from '../../shared/config.js';
import { handleScreenshot } from './screenshot.js';

export async function handleNavigate(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    url: string;
    tab?: string;
    wait?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const target = params.url;
  const waitStrategy = params.wait || 'dom';

  // Handle back/forward
  if (target === 'back' || target === 'forward') {
    const history = await client.Page.getNavigationHistory();
    const idx = target === 'back' ? history.currentIndex - 1 : history.currentIndex + 1;
    if (idx < 0 || idx >= history.entries.length) {
      return {
        ok: false,
        error: `Cannot go ${target}: no ${target} history entry`,
        code: 'INVALID_ARGUMENT',
      };
    }
    await client.Page.navigateToHistoryEntry({ entryId: history.entries[idx].id });
    await waitForPage(client, waitStrategy);
    const page = await cdp.getPageInfo(tabId);
    const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
    return { ok: true, screenshot: screenshotResult.screenshot, page };
  }

  // Auto-prepend https:// if no protocol
  let url = target;
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

  // Navigate
  const result = await client.Page.navigate({ url });
  if (result.errorText) {
    return {
      ok: false,
      error: `Navigation failed: ${result.errorText}`,
      code: 'CDP_ERROR',
    };
  }

  await waitForPage(client, waitStrategy);
  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}

async function waitForPage(client: any, strategy: string): Promise<void> {
  if (strategy === 'none') return;

  if (strategy === 'dom') {
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          const handler = () => resolve();
          client.on('Page.domContentEventFired', handler);
          // Clean up after timeout
          setTimeout(() => {
            resolve();
          }, 10000);
        }),
        // Also check if already loaded
        client.Runtime.evaluate({
          expression: 'document.readyState',
          returnByValue: true,
        }).then((r: any) => {
          if (r.result?.value === 'interactive' || r.result?.value === 'complete') {
            return;
          }
          // Wait for it
          return new Promise<void>((resolve) => setTimeout(resolve, 10000));
        }),
      ]);
    } catch {
      // Best effort
    }
    return;
  }

  if (strategy === 'network') {
    // Wait for network idle (no requests for 500ms)
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const resetTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(resolve, 500);
      };
      resetTimer();
      client.on('Network.requestWillBeSent', resetTimer);
      // Safety timeout
      setTimeout(resolve, 15000);
    });
  }
}
