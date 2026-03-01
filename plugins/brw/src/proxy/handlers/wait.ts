import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';

export async function handleWait(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    duration?: number;
    tab?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const duration = Math.min(Math.max(params.duration || 2, 0), 30) * 1000;

  // Wait for a combination of time and network/rendering settle
  const client = cdp.getClient(tabId);

  await Promise.race([
    waitForSettle(client, duration),
    new Promise((r) => setTimeout(r, duration)),
  ]);

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}

async function waitForSettle(client: any, maxWait: number): Promise<void> {
  const start = Date.now();

  // Wait for network idle (no requests for 500ms)
  let lastActivity = Date.now();
  const onRequest = () => {
    lastActivity = Date.now();
  };
  client.on('Network.requestWillBeSent', onRequest);

  while (Date.now() - start < maxWait) {
    if (Date.now() - lastActivity > 500) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Also wait for rAF settle
  try {
    await client.Runtime.evaluate({
      expression: 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))',
      awaitPromise: true,
      timeout: Math.max(1000, maxWait - (Date.now() - start)),
    });
  } catch {
    // timeout or error - ok
  }
}
