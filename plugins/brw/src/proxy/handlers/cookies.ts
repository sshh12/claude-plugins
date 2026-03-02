import type { CDPManager } from '../cdp.js';
import type { ApiResponse, BrwConfig } from '../../shared/types.js';
import { audit } from '../logger.js';

/**
 * Check if a cookie domain matches the given hostname.
 * Cookie domains may start with '.' (e.g., '.example.com') which matches subdomains.
 */
function cookieDomainMatches(cookieDomain: string, hostname: string): boolean {
  const cd = cookieDomain.startsWith('.') ? cookieDomain.substring(1) : cookieDomain;
  return hostname === cd || hostname.endsWith('.' + cd);
}

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
    allDomains?: boolean;
    tab?: string;
  },
  config?: BrwConfig
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const action = params.action || 'list';
  const scopeAll = params.allDomains || (config?.cookieScope === 'all');

  if (action === 'list') {
    if (scopeAll) {
      // Use getAllCookies for cross-domain access
      const { cookies } = await (client as any).Storage.getCookies();
      return { ok: true, cookies };
    }

    // Default: scope to current tab's domain
    const { cookies } = await client.Network.getCookies();
    let hostname = '';
    try {
      const pageInfo = await cdp.getPageInfo(tabId);
      hostname = new URL(pageInfo.url).hostname;
    } catch {
      // Can't determine domain — return page-scoped cookies
      return { ok: true, cookies };
    }

    const filtered = cookies.filter((c: any) => cookieDomainMatches(c.domain, hostname));
    return {
      ok: true,
      cookies: filtered,
      hint: `Showing cookies for ${hostname} only. Use --all-domains to see all cookies, or set cookieScope: "all" in config.`,
    };
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

    audit('cookies', { action: 'set', name: params.name, domain });
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

    audit('cookies', { action: 'delete', name: params.name, domain });
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
    audit('cookies', { action: 'clear' });
    return { ok: true };
  }

  return { ok: false, error: `Unknown cookies action: ${action}`, code: 'INVALID_ARGUMENT' };
}
