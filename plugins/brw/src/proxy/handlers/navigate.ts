import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { checkUrlPolicy } from '../../shared/config.js';
import { handleScreenshot } from './screenshot.js';
import { getGlobalLogger, audit } from '../logger.js';

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

    // Check resulting URL against policy
    const histPage = await cdp.getPageInfo(tabId);
    if (!checkUrlPolicy(histPage.url, config.allowedUrls, config.blockedUrls)) {
      audit('navigate', { url: histPage.url, allowed: false, direction: target });
      await client.Page.navigate({ url: 'about:blank' });
      return {
        ok: false,
        error: `Navigation ${target} resulted in blocked URL: ${histPage.url}`,
        code: 'URL_BLOCKED',
      };
    }

    const page = await cdp.getPageInfo(tabId);
    const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
    return { ok: true, screenshot: screenshotResult.screenshot, page };
  }

  // Auto-prepend https:// if no protocol
  let url = target;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('about:') && !url.startsWith('file:')) {
    url = 'https://' + url;
  }

  // Check URL policy
  if (!checkUrlPolicy(url, config.allowedUrls, config.blockedUrls)) {
    audit('navigate', { url, allowed: false });
    return {
      ok: false,
      error: `URL ${url} is blocked by security policy`,
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
  audit('navigate', { url, allowed: true });
  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}

export async function waitForPage(client: any, strategy: string): Promise<void> {
  const start = Date.now();
  if (strategy === 'none') return;

  if (strategy === 'dom') {
    let domHandler: (() => void) | null = null;
    try {
      await Promise.race([
        new Promise<void>((resolve) => {
          domHandler = () => resolve();
          client.on('Page.domContentEventFired', domHandler);
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
    } finally {
      if (domHandler) client.removeListener('Page.domContentEventFired', domHandler);
    }
    return;
  }

  if (strategy === 'network') {
    // Wait for network idle (no requests for 500ms)
    let networkHandler: (() => void) | null = null;
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const resetTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(resolve, 500);
      };
      networkHandler = resetTimer;
      resetTimer();
      client.on('Network.requestWillBeSent', networkHandler);
      // Safety timeout
      setTimeout(resolve, 15000);
    });
    if (networkHandler) client.removeListener('Network.requestWillBeSent', networkHandler);
    return;
  }

  if (strategy === 'render') {
    // Full render wait for SPAs:
    // (a) readyState === 'complete'
    // (b) network idle 500ms
    // (c) LayoutCount stable for 500ms
    // (d) double-rAF for paint completion
    // (e) responsiveness ping
    const SAFETY_TIMEOUT = 15000;
    const renderStart = Date.now();
    const elapsed = () => Date.now() - renderStart;
    const remaining = () => Math.max(SAFETY_TIMEOUT - elapsed(), 0);

    const renderSteps = async () => {
      // (a) Wait for readyState === 'complete'
      if (remaining() > 0) {
        try {
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(resolve, remaining());
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
              if (remaining() > 0) setTimeout(poll, 100);
              else resolve();
            };
            poll();
          });
        } catch { /* best effort */ }
      }

      // (b) Network idle 500ms
      let networkHandler: (() => void) | null = null;
      if (remaining() > 0) {
        await new Promise<void>((resolve) => {
          const rem = remaining();
          let timer: ReturnType<typeof setTimeout>;
          const safetyTimer = setTimeout(resolve, rem);
          const resetTimer = () => {
            clearTimeout(timer);
            timer = setTimeout(() => { clearTimeout(safetyTimer); resolve(); }, 500);
          };
          networkHandler = resetTimer;
          resetTimer();
          client.on('Network.requestWillBeSent', networkHandler);
        });
        if (networkHandler) client.removeListener('Network.requestWillBeSent', networkHandler);
      }

      // (c) LayoutCount stable for 500ms via Performance.getMetrics
      if (remaining() > 0) {
        try {
          await client.Performance.enable();
          await new Promise<void>((resolve) => {
            const rem = remaining();
            const safetyTimer = setTimeout(resolve, rem);
            let lastLayoutCount = -1;
            let stableTimer: ReturnType<typeof setTimeout>;

            const checkLayout = async () => {
              try {
                const { metrics } = await client.Performance.getMetrics();
                const layoutMetric = metrics.find((m: any) => m.name === 'LayoutCount');
                const currentCount = layoutMetric?.value ?? 0;

                if (currentCount === lastLayoutCount) {
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
              if (remaining() > 0) setTimeout(checkLayout, 200);
            };
            checkLayout();
          });
        } catch { /* Performance domain may not be available */ }
        finally {
          try { await client.Performance.disable(); } catch { /* ignore */ }
        }
      }

      // (d) Double-rAF for paint completion
      if (remaining() > 0) {
        try {
          await client.Runtime.evaluate({
            expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
            awaitPromise: true,
            timeout: Math.min(2000, remaining()),
          });
        } catch { /* best effort */ }
      }

      // (e) Responsiveness ping — verify page is responsive after render
      try {
        await client.Runtime.evaluate({
          expression: '1',
          returnByValue: true,
          timeout: 2000,
        });
      } catch { /* best effort */ }
    };

    // Hard timeout: guarantee render wait completes within SAFETY_TIMEOUT + 2s
    try {
      await Promise.race([
        renderSteps(),
        new Promise<void>((resolve) => setTimeout(resolve, SAFETY_TIMEOUT + 2000)),
      ]);
    } catch (err) {
      getGlobalLogger().warn(`render wait failed: ${err}`);
    }
  }

  const logger = getGlobalLogger();
  logger.info(`waitForPage strategy=${strategy} took ${Date.now() - start}ms`);
}
