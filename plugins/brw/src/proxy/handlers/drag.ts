import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';

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
    tab?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  let startX: number;
  let startY: number;
  let endX: number;
  let endY: number;

  // Resolve start coordinates
  if (params.fromRef) {
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        const el = window.__brwElementMap?.get(${JSON.stringify(params.fromRef)})?.deref();
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return JSON.stringify({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2});
      })()`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `Ref ${params.fromRef} not found`, code: 'REF_NOT_FOUND', hint: 'Refs expire after navigation or DOM mutations. Run "brw read-page" to get fresh refs.' };
    }
    const coords = JSON.parse(result.result.value);
    startX = coords.x;
    startY = coords.y;
  } else if (params.x1 !== undefined && params.y1 !== undefined) {
    startX = params.x1;
    startY = params.y1;
  } else {
    return { ok: false, error: 'Must specify start coordinates or --from-ref', code: 'INVALID_ARGUMENT' };
  }

  // Resolve end coordinates
  if (params.toRef) {
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        const el = window.__brwElementMap?.get(${JSON.stringify(params.toRef)})?.deref();
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return JSON.stringify({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2});
      })()`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `Ref ${params.toRef} not found`, code: 'REF_NOT_FOUND', hint: 'Refs expire after navigation or DOM mutations. Run "brw read-page" to get fresh refs.' };
    }
    const coords = JSON.parse(result.result.value);
    endX = coords.x;
    endY = coords.y;
  } else if (params.x2 !== undefined && params.y2 !== undefined) {
    endX = params.x2;
    endY = params.y2;
  } else {
    return { ok: false, error: 'Must specify end coordinates or --to-ref', code: 'INVALID_ARGUMENT' };
  }

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
