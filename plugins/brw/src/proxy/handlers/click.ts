import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';
import { resolveTargetCoords } from './resolve-target.js';

export async function handleClick(
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
    right?: boolean;
    double?: boolean;
    triple?: boolean;
    modifiers?: string;
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

  const button = params.right ? 'right' : 'left';
  const clickCount = params.triple ? 3 : params.double ? 2 : 1;

  // Parse modifiers
  let modifiers = 0;
  if (params.modifiers) {
    const mods = params.modifiers.toLowerCase().split('+');
    if (mods.includes('alt')) modifiers |= 1;
    if (mods.includes('ctrl') || mods.includes('control')) modifiers |= 2;
    if (mods.includes('meta') || mods.includes('cmd') || mods.includes('command')) modifiers |= 4;
    if (mods.includes('shift')) modifiers |= 8;
  }

  // Move to position first (100ms delay for visual targeting)
  await client.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x,
    y,
    modifiers,
    pointerType: 'mouse',
  });
  await new Promise((r) => setTimeout(r, 100));

  // Perform click(s)
  for (let i = 0; i < clickCount; i++) {
    await client.Input.dispatchMouseEvent({
      type: 'mousePressed',
      x,
      y,
      button,
      clickCount: i + 1,
      modifiers,
      pointerType: 'mouse',
    });
    await client.Input.dispatchMouseEvent({
      type: 'mouseReleased',
      x,
      y,
      button,
      clickCount: i + 1,
      modifiers,
      pointerType: 'mouse',
    });
  }

  // Small delay for page to react
  await new Promise((r) => setTimeout(r, 150));

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}
