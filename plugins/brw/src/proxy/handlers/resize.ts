import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';

export async function handleResize(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    tab?: string;
    width: number;
    height: number;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  if (!params.width || !params.height) {
    return { ok: false, error: 'width and height are required', code: 'INVALID_ARGUMENT' };
  }

  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  await client.Emulation.setDeviceMetricsOverride({
    width: params.width,
    height: params.height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const page = await cdp.getPageInfo(tabId);
  const { ok: _ok, ...screenshotData } = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });

  return {
    ok: true,
    ...screenshotData,
    page,
    width: params.width,
    height: params.height,
  };
}
