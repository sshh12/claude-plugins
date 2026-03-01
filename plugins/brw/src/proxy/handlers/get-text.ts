import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

export async function handleGetText(
  cdp: CDPManager,
  params: {
    tab?: string;
    maxChars?: number;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const maxChars = params.maxChars || 50000;

  const result = await client.Runtime.evaluate({
    expression: `(function() {
      const title = document.title;
      const url = location.href;

      // Priority-ordered content extraction
      const selectors = ['article', 'main', '[role="main"]', '.content', '#content', 'body'];
      let contentEl = null;
      for (const sel of selectors) {
        contentEl = document.querySelector(sel);
        if (contentEl) break;
      }
      if (!contentEl) contentEl = document.body;

      // Clone and strip nav/ads/sidebars
      const clone = contentEl.cloneNode(true);
      const stripSelectors = [
        'nav', 'header', 'footer', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
        '.nav', '.navbar', '.sidebar', '.footer', '.header', '.menu',
        '.ad', '.ads', '.advertisement', '[class*="cookie"]', '[class*="popup"]',
        'script', 'style', 'noscript', 'iframe',
      ];
      for (const sel of stripSelectors) {
        clone.querySelectorAll(sel).forEach(el => el.remove());
      }

      let text = clone.textContent || '';
      // Collapse whitespace
      text = text.replace(/\\s+/g, ' ').trim();

      return JSON.stringify({ title, url, text: text.substring(0, ${maxChars}) });
    })()`,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    return { ok: false, error: `get-text failed: ${result.exceptionDetails.text}`, code: 'CDP_ERROR' };
  }

  const data = JSON.parse(result.result?.value || '{}');
  return { ok: true, title: data.title, url: data.url, text: data.text };
}
