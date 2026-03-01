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
    return;
  }

  if (strategy === 'render') {
    // Full render wait for SPAs:
    // (a) readyState === 'complete'
    // (b) network idle 500ms
    // (c) LayoutCount stable for 500ms
    // (d) double-rAF for paint completion
    const SAFETY_TIMEOUT = 15000;
    const start = Date.now();
    const elapsed = () => Date.now() - start;

    // (a) Wait for readyState === 'complete'
    try {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, SAFETY_TIMEOUT);
        const poll = async () => {
          try {
            const r = await client.Runtime.evaluate({
              expression: 'document.readyState',
              returnByValue: true,
            });
            if (r.result?.value === 'complete') {
              clearTimeout(timeout);
              resolve();
              return;
            }
          } catch { /* ignore */ }
          if (elapsed() < SAFETY_TIMEOUT) setTimeout(poll, 100);
          else resolve();
        };
        poll();
      });
    } catch { /* best effort */ }

    // (b) Network idle 500ms
    if (elapsed() < SAFETY_TIMEOUT) {
      await new Promise<void>((resolve) => {
        const remaining = SAFETY_TIMEOUT - elapsed();
        let timer: ReturnType<typeof setTimeout>;
        const safetyTimer = setTimeout(resolve, remaining);
        const resetTimer = () => {
          clearTimeout(timer);
          timer = setTimeout(() => { clearTimeout(safetyTimer); resolve(); }, 500);
        };
        resetTimer();
        client.on('Network.requestWillBeSent', resetTimer);
      });
    }

    // (c) LayoutCount stable for 500ms via Performance.getMetrics
    if (elapsed() < SAFETY_TIMEOUT) {
      try {
        await client.Performance.enable();
        await new Promise<void>((resolve) => {
          const remaining = SAFETY_TIMEOUT - elapsed();
          const safetyTimer = setTimeout(resolve, remaining);
          let lastLayoutCount = -1;
          let stableTimer: ReturnType<typeof setTimeout>;

          const checkLayout = async () => {
            try {
              const { metrics } = await client.Performance.getMetrics();
              const layoutMetric = metrics.find((m: any) => m.name === 'LayoutCount');
              const currentCount = layoutMetric?.value ?? 0;

              if (currentCount === lastLayoutCount) {
                // Already stable from previous check — stableTimer will resolve
                return;
              }
              lastLayoutCount = currentCount;
              clearTimeout(stableTimer);
              stableTimer = setTimeout(() => { clearTimeout(safetyTimer); resolve(); }, 500);
            } catch {
              clearTimeout(safetyTimer);
              resolve();
              return;
            }
            if (elapsed() < SAFETY_TIMEOUT) setTimeout(checkLayout, 200);
          };
          checkLayout();
        });
        await client.Performance.disable();
      } catch { /* Performance domain may not be available */ }
    }

    // (d) Double-rAF for paint completion
    if (elapsed() < SAFETY_TIMEOUT) {
      try {
        await client.Runtime.evaluate({
          expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
          awaitPromise: true,
          timeout: Math.min(2000, SAFETY_TIMEOUT - elapsed()),
        });
      } catch { /* best effort */ }
    }
  }
}
