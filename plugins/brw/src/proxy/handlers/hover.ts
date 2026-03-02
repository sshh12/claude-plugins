import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';

export async function handleHover(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    x?: number;
    y?: number;
    ref?: string;
    selector?: string;
    tab?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  let x: number;
  let y: number;

  if (params.ref) {
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        const el = window.__brwElementMap?.get(${JSON.stringify(params.ref)})?.deref();
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return JSON.stringify({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2});
      })()`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `Ref ${params.ref} not found`, code: 'REF_NOT_FOUND', hint: 'Refs expire after navigation or DOM mutations. Run "brw read-page" to get fresh refs.' };
    }
    const coords = JSON.parse(result.result.value);
    x = coords.x;
    y = coords.y;
  } else if (params.selector) {
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        const el = document.querySelector(${JSON.stringify(params.selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return JSON.stringify({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2});
      })()`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `Selector "${params.selector}" not found`, code: 'SELECTOR_NOT_FOUND' };
    }
    const coords = JSON.parse(result.result.value);
    x = coords.x;
    y = coords.y;
  } else if (params.x !== undefined && params.y !== undefined) {
    x = params.x;
    y = params.y;
  } else {
    return { ok: false, error: 'Must specify x,y coordinates, --ref, or --selector', code: 'INVALID_ARGUMENT' };
  }

  await client.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x,
    y,
    pointerType: 'mouse',
  });

  // Small delay for hover effects
  await new Promise((r) => setTimeout(r, 200));

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}
