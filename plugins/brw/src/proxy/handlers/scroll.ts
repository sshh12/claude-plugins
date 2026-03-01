import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';

export async function handleScroll(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    direction: string;
    amount?: number;
    atX?: number;
    atY?: number;
    tab?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const amount = Math.min(Math.max(params.amount || 3, 1), 10);
  const delta = amount * 100;

  // Default scroll position: center of viewport
  let x = params.atX ?? 640;
  let y = params.atY ?? 400;

  if (params.atX === undefined || params.atY === undefined) {
    // Get viewport center
    const result = await client.Runtime.evaluate({
      expression: 'JSON.stringify({w: window.innerWidth, h: window.innerHeight})',
      returnByValue: true,
    });
    const vp = JSON.parse(result.result?.value || '{}');
    x = params.atX ?? Math.round((vp.w || 1280) / 2);
    y = params.atY ?? Math.round((vp.h || 800) / 2);
  }

  let deltaX = 0;
  let deltaY = 0;

  switch (params.direction) {
    case 'down':
      deltaY = delta;
      break;
    case 'up':
      deltaY = -delta;
      break;
    case 'right':
      deltaX = delta;
      break;
    case 'left':
      deltaX = -delta;
      break;
    default:
      return { ok: false, error: `Invalid direction: ${params.direction}. Use up, down, left, right.`, code: 'INVALID_ARGUMENT' };
  }

  await client.Input.dispatchMouseEvent({
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
  });

  // Wait for scroll animation
  await new Promise((r) => setTimeout(r, 300));

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}

export async function handleScrollTo(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    ref?: string;
    selector?: string;
    tab?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  if (!params.ref && !params.selector) {
    return { ok: false, error: 'Must specify --ref or --selector', code: 'INVALID_ARGUMENT' };
  }

  const resolveExpr = params.ref
    ? `window.__brwElementMap?.get(${JSON.stringify(params.ref)})?.deref()`
    : `document.querySelector(${JSON.stringify(params.selector)})`;

  const result = await client.Runtime.evaluate({
    expression: `(function() {
      const el = ${resolveExpr};
      if (!el) return 'not_found';
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return 'ok';
    })()`,
    returnByValue: true,
  });

  if (result.result?.value === 'not_found') {
    const target = params.ref || params.selector;
    return {
      ok: false,
      error: `Element ${target} not found`,
      code: params.ref ? 'REF_NOT_FOUND' : 'SELECTOR_NOT_FOUND',
    };
  }

  // Wait for scroll animation
  await new Promise((r) => setTimeout(r, 500));

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}
