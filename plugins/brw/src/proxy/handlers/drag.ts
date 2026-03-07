import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';
import { resolveTargetCoords } from './resolve-target.js';

export async function handleDrag(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    fromRef?: string;
    toRef?: string;
    fromText?: string;
    toText?: string;
    fromLabel?: string;
    toLabel?: string;
    tab?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  // Resolve start coordinates
  const startResolved = await resolveTargetCoords(cdp, {
    ref: params.fromRef, text: params.fromText, label: params.fromLabel,
    x: params.x1, y: params.y1, tab: tabId,
  });
  if (!startResolved.ok) return startResolved;
  const { x: startX, y: startY } = startResolved.target!;

  // Resolve end coordinates
  const endResolved = await resolveTargetCoords(cdp, {
    ref: params.toRef, text: params.toText, label: params.toLabel,
    x: params.x2, y: params.y2, tab: tabId,
  });
  if (!endResolved.ok) return endResolved;
  const { x: endX, y: endY } = endResolved.target!;

  // Pointer/mouse event options — ensure PointerEvent fields are set for apps like Excalidraw
  const pointerOpts = { pointerType: 'mouse' as const };

  // Move to start
  await client.Input.dispatchMouseEvent({
    type: 'mouseMoved',
    x: startX,
    y: startY,
    ...pointerOpts,
  });
  await new Promise((r) => setTimeout(r, 50));

  // Press
  await client.Input.dispatchMouseEvent({
    type: 'mousePressed',
    x: startX,
    y: startY,
    button: 'left',
    clickCount: 1,
    ...pointerOpts,
  });
  await new Promise((r) => setTimeout(r, 50));

  // Interpolate movement (10 steps)
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = startX + (endX - startX) * t;
    const y = startY + (endY - startY) * t;
    await client.Input.dispatchMouseEvent({
      type: 'mouseMoved',
      x: Math.round(x),
      y: Math.round(y),
      button: 'left',
      ...pointerOpts,
    });
    await new Promise((r) => setTimeout(r, 20));
  }

  // Release
  await client.Input.dispatchMouseEvent({
    type: 'mouseReleased',
    x: endX,
    y: endY,
    button: 'left',
    clickCount: 1,
    ...pointerOpts,
  });

  await new Promise((r) => setTimeout(r, 150));

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}
