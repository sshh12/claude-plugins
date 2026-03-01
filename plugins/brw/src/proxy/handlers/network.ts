import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

export async function handleNetwork(
  cdp: CDPManager,
  params: {
    tab?: string;
    urlPattern?: string;
    limit?: number;
    clear?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  let requests = cdp.getNetworkBuffer(tabId);

  if (params.urlPattern) {
    requests = requests.filter((r) => r.url.includes(params.urlPattern!));
  }

  if (params.limit && params.limit > 0) {
    requests = requests.slice(-params.limit);
  }

  if (params.clear) {
    cdp.clearNetworkBuffer(tabId);
  }

  return { ok: true, requests };
}

export async function handleNetworkBody(
  cdp: CDPManager,
  params: {
    tab?: string;
    requestId: string;
  }
): Promise<ApiResponse> {
  if (!params.requestId) {
    return { ok: false, error: 'requestId is required', code: 'INVALID_ARGUMENT' };
  }

  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  try {
    const result = await client.Network.getResponseBody({ requestId: params.requestId });
    return {
      ok: true,
      body: result.body,
      base64: result.base64Encoded || false,
      mimeType: 'application/octet-stream',
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to get response body: ${err?.message || 'Unknown error'}`,
      code: 'NETWORK_REQUEST_NOT_FOUND',
      hint: 'Use "brw network" to list captured requests and their IDs.',
    };
  }
}
