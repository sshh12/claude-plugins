import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

export async function handleConsole(
  cdp: CDPManager,
  params: {
    tab?: string;
    errorsOnly?: boolean;
    pattern?: string;
    limit?: number;
    clear?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  let messages = cdp.getConsoleBuffer(tabId);

  if (params.errorsOnly) {
    messages = messages.filter((m) => m.level === 'error' || m.level === 'warning');
  }

  if (params.pattern) {
    try {
      const regex = new RegExp(params.pattern);
      messages = messages.filter((m) => regex.test(m.text));
    } catch {
      return { ok: false, error: `Invalid regex pattern: ${params.pattern}`, code: 'INVALID_ARGUMENT' };
    }
  }

  if (params.limit && params.limit > 0) {
    messages = messages.slice(-params.limit);
  }

  if (params.clear) {
    cdp.clearConsoleBuffer(tabId);
  }

  return { ok: true, messages };
}
