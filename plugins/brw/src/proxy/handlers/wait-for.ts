import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';
import { checkUrlPolicy } from '../../shared/config.js';
import { audit } from '../logger.js';

export async function handleWaitFor(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    selector?: string;
    text?: string;
    url?: string;
    js?: string;
    networkIdle?: boolean;
    timeout?: number;
    tab?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const timeout = Math.min(Math.max(params.timeout || 10, 1), 60) * 1000;
  const start = Date.now();
  let matched = false;

  while (Date.now() - start < timeout) {
    if (params.selector) {
      const result = await client.Runtime.evaluate({
        expression: `!!document.querySelector(${JSON.stringify(params.selector)})`,
        returnByValue: true,
      });
      if (result.result?.value === true) {
        matched = true;
        break;
      }
    } else if (params.text) {
      const result = await client.Runtime.evaluate({
        expression: `document.body.innerText.includes(${JSON.stringify(params.text)})`,
        returnByValue: true,
      });
      if (result.result?.value === true) {
        matched = true;
        break;
      }
    } else if (params.url) {
      const result = await client.Runtime.evaluate({
        expression: 'location.href',
        returnByValue: true,
      });
      const currentUrl = result.result?.value || '';
      if (globMatch(currentUrl, params.url)) {
        matched = true;
        break;
      }
    } else if (params.js) {
      const result = await client.Runtime.evaluate({
        expression: params.js,
        returnByValue: true,
        awaitPromise: true,
        timeout: 1000,
      });
      // Post-exec URL check
      const needsUrlCheck = !(config.allowedUrls.length === 1 && config.allowedUrls[0] === '*' && config.blockedUrls.length === 0);
      if (needsUrlCheck) {
        try {
          const jsPage = await cdp.getPageInfo(tabId);
          if (!checkUrlPolicy(jsPage.url, config.allowedUrls, config.blockedUrls)) {
            audit('js', { expression: params.js.substring(0, 200), urlAfter: jsPage.url, blocked: true, source: 'wait-for' });
            await client.Page.navigate({ url: 'about:blank' });
            const page = await cdp.getPageInfo(tabId);
            return {
              ok: false,
              error: `wait-for --js navigated to blocked URL: ${jsPage.url}`,
              code: 'URL_BLOCKED',
              page,
            };
          }
        } catch {
          // best effort URL check
        }
      }
      if (result.result?.value) {
        matched = true;
        break;
      }
    } else if (params.networkIdle) {
      // Check if there are pending network requests
      // Use a simple heuristic: wait for 500ms of no requests
      const networkBuffer = cdp.getNetworkBuffer(tabId);
      const recentRequests = networkBuffer.filter((r) => Date.now() - r.duration < 500);
      if (recentRequests.length === 0 && Date.now() - start > 500) {
        matched = true;
        break;
      }
    } else {
      return { ok: false, error: 'Must specify --selector, --text, --url, --js, or --network-idle', code: 'INVALID_ARGUMENT' };
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  const elapsed = Date.now() - start;
  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page, matched, elapsed };
}

function globMatch(str: string, pattern: string): boolean {
  const regexStr =
    '^' +
    pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*') +
    '$';
  try {
    return new RegExp(regexStr).test(str);
  } catch {
    return false;
  }
}
