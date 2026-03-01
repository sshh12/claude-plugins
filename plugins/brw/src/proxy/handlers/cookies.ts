import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

export async function handleCookies(
  cdp: CDPManager,
  params: {
    action?: string;
    name?: string;
    value?: string;
    domain?: string;
    path?: string;
    expires?: number;
    secure?: boolean;
    httponly?: boolean;
    tab?: string;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const action = params.action || 'list';

  if (action === 'list') {
    const { cookies } = await client.Network.getCookies();
    return { ok: true, cookies };
  }

  if (action === 'get') {
    if (!params.name) {
      return { ok: false, error: 'Cookie name is required', code: 'INVALID_ARGUMENT' };
    }
    const { cookies } = await client.Network.getCookies();
    const cookie = cookies.find((c: any) => c.name === params.name);
    if (!cookie) {
      return { ok: false, error: `Cookie "${params.name}" not found`, code: 'INVALID_ARGUMENT' };
    }
    return { ok: true, cookie };
  }

  if (action === 'set') {
    if (!params.name || params.value === undefined) {
      return { ok: false, error: 'Cookie name and value are required', code: 'INVALID_ARGUMENT' };
    }

    // Get current page URL for default domain
    const pageInfo = await cdp.getPageInfo(tabId);
    let domain = params.domain;
    if (!domain) {
      try {
        const url = new URL(pageInfo.url);
        domain = url.hostname;
      } catch {
        domain = 'localhost';
      }
    }

    await client.Network.setCookie({
      name: params.name,
      value: params.value,
      domain,
      path: params.path || '/',
      expires: params.expires,
      secure: params.secure,
      httpOnly: params.httponly,
      url: pageInfo.url,
    });

    return { ok: true };
  }

  if (action === 'delete') {
    if (!params.name) {
      return { ok: false, error: 'Cookie name is required', code: 'INVALID_ARGUMENT' };
    }

    const pageInfo = await cdp.getPageInfo(tabId);
    let domain = params.domain;
    if (!domain) {
      try {
        const url = new URL(pageInfo.url);
        domain = url.hostname;
      } catch {
        domain = 'localhost';
      }
    }

    await client.Network.deleteCookies({
      name: params.name,
      domain,
      url: pageInfo.url,
    });

    return { ok: true };
  }

  if (action === 'clear') {
    const pageInfo = await cdp.getPageInfo(tabId);
    const { cookies } = await client.Network.getCookies();
    for (const cookie of cookies) {
      await client.Network.deleteCookies({
        name: cookie.name,
        domain: cookie.domain,
        url: pageInfo.url,
      });
    }
    return { ok: true };
  }

  return { ok: false, error: `Unknown cookies action: ${action}`, code: 'INVALID_ARGUMENT' };
}
