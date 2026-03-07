import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';
import { resolveTargetCoords } from './resolve-target.js';

export async function handleHover(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    x?: number;
    y?: number;
    ref?: string;
    selector?: string;
    text?: string;
    label?: string;
    wait?: number;
    tab?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  const resolved = await resolveTargetCoords(cdp, {
    ref: params.ref, selector: params.selector,
    text: params.text, label: params.label,
    x: params.x, y: params.y, tab: tabId, wait: params.wait,
  });
  if (!resolved.ok) return resolved;
  const { x, y } = resolved.target!;

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
