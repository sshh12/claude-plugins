import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

export async function handleArrange(
  cdp: CDPManager,
  params: { screen?: string; padding?: number }
): Promise<ApiResponse> {
  const tabs = await cdp.listTabs();
  if (tabs.length === 0) {
    return { ok: false, error: 'No tabs open', code: 'CDP_ERROR' };
  }

  const padding = params.padding ?? 0;

  // Get windowId for each tab, deduplicate by windowId
  const windowMap = new Map<number, { tabId: string; client: any }>();
  for (const tab of tabs) {
    const client = cdp.getClient(tab.id);
    try {
      const { windowId } = await client.Browser.getWindowForTarget({ targetId: tab.id });
      if (!windowMap.has(windowId)) {
        windowMap.set(windowId, { tabId: tab.id, client });
      }
    } catch {
      // Skip tabs where we can't get window info
    }
  }

  const windows = Array.from(windowMap.entries());
  const n = windows.length;
  if (n === 0) {
    return { ok: false, error: 'Could not get window info for any tab', code: 'CDP_ERROR' };
  }

  // Detect screen size or use override
  let screenW: number;
  let screenH: number;
  if (params.screen) {
    const parts = params.screen.split('x').map(Number);
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      return { ok: false, error: 'Invalid screen format. Use WxH (e.g. 1920x1080)', code: 'INVALID_ARGUMENT' };
    }
    [screenW, screenH] = parts;
  } else {
    // Auto-detect via any available client
    const anyClient = windows[0][1].client;
    try {
      const result = await anyClient.Runtime.evaluate({
        expression: 'JSON.stringify({w:screen.availWidth||screen.width,h:screen.availHeight||screen.height})',
        returnByValue: true,
      });
      const info = JSON.parse(result.result?.value || '{}');
      screenW = info.w || 1920;
      screenH = info.h || 1080;
    } catch {
      screenW = 1920;
      screenH = 1080;
    }
  }

  // Calculate grid layout
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const cellW = Math.floor((screenW - padding * (cols + 1)) / cols);
  const cellH = Math.floor((screenH - padding * (rows + 1)) / rows);

  const arranged: Array<{ windowId: number; tabId: string; left: number; top: number; width: number; height: number }> = [];

  for (let i = 0; i < windows.length; i++) {
    const [windowId, { tabId, client }] = windows[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = padding + col * (cellW + padding);
    const top = padding + row * (cellH + padding);

    try {
      // First set to normal state to allow repositioning
      await client.Browser.setWindowBounds({
        windowId,
        bounds: { windowState: 'normal' },
      });
      await client.Browser.setWindowBounds({
        windowId,
        bounds: { left, top, width: cellW, height: cellH },
      });
      arranged.push({ windowId, tabId, left, top, width: cellW, height: cellH });
    } catch {
      // Skip windows that can't be repositioned
    }
  }

  return {
    ok: true,
    arranged: arranged.length,
    grid: `${cols}x${rows}`,
    screen: `${screenW}x${screenH}`,
    windows: arranged,
  };
}
