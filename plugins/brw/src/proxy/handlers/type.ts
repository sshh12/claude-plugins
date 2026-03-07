import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';
import { resolveTargetCoords } from './resolve-target.js';

export async function handleType(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    text: string;
    ref?: string;
    selector?: string;
    targetText?: string;
    targetLabel?: string;
    wait?: number;
    tab?: string;
    clear?: boolean;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  // If targeting specified, click element to focus it first
  const hasTarget = params.ref || params.selector || params.targetText || params.targetLabel;
  if (hasTarget) {
    const resolved = await resolveTargetCoords(cdp, {
      ref: params.ref, selector: params.selector,
      text: params.targetText, label: params.targetLabel,
      tab: tabId, wait: params.wait,
    });
    if (!resolved.ok) return resolved;
    const { x, y } = resolved.target!;
    await client.Input.dispatchMouseEvent({ type: 'mouseMoved', x, y, pointerType: 'mouse' });
    await new Promise((r) => setTimeout(r, 50));
    await client.Input.dispatchMouseEvent({ type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await client.Input.dispatchMouseEvent({ type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await new Promise((r) => setTimeout(r, 100));
  }

  // Clear existing content if requested
  if (params.clear) {
    // Select all
    await client.Input.dispatchKeyEvent({
      type: 'keyDown',
      modifiers: process.platform === 'darwin' ? 4 : 2, // cmd on mac, ctrl on others
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
    });
    await client.Input.dispatchKeyEvent({
      type: 'keyUp',
      modifiers: process.platform === 'darwin' ? 4 : 2,
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
    });
    // Delete
    await client.Input.dispatchKeyEvent({
      type: 'keyDown',
      key: 'Delete',
      code: 'Delete',
      windowsVirtualKeyCode: 46,
    });
    await client.Input.dispatchKeyEvent({
      type: 'keyUp',
      key: 'Delete',
      code: 'Delete',
      windowsVirtualKeyCode: 46,
    });
  }

  // Type character by character
  for (const char of params.text) {
    if (char === '\n') {
      await client.Input.dispatchKeyEvent({
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
      await client.Input.dispatchKeyEvent({
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      });
    } else {
      await client.Input.insertText({ text: char });
    }
  }

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}
