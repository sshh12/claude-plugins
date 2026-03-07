import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

export async function handleWindowBounds(
  cdp: CDPManager,
  params: { tab?: string; left?: number; top?: number; width?: number; height?: number; state?: string }
): Promise<ApiResponse> {
  const client = cdp.getClient(params.tab);
  const tab = cdp.getTab(params.tab);
  const targetId = tab.targetId;

  const { windowId } = await client.Browser.getWindowForTarget({ targetId });

  const hasPosition = params.left !== undefined || params.top !== undefined ||
    params.width !== undefined || params.height !== undefined;
  const hasState = params.state !== undefined;

  if (hasState) {
    await client.Browser.setWindowBounds({
      windowId,
      bounds: { windowState: params.state },
    });
  }

  if (hasPosition) {
    // Ensure normal state before setting position/size
    if (!hasState) {
      await client.Browser.setWindowBounds({
        windowId,
        bounds: { windowState: 'normal' },
      });
    }
    const bounds: Record<string, number> = {};
    if (params.left !== undefined) bounds.left = params.left;
    if (params.top !== undefined) bounds.top = params.top;
    if (params.width !== undefined) bounds.width = params.width;
    if (params.height !== undefined) bounds.height = params.height;
    await client.Browser.setWindowBounds({ windowId, bounds });
  }

  // Return current bounds
  const { bounds } = await client.Browser.getWindowBounds({ windowId });
  return {
    ok: true,
    windowId,
    bounds: {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      state: bounds.windowState,
    },
  };
}
