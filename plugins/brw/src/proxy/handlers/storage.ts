import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';
import { audit } from '../logger.js';

export async function handleStorage(
  cdp: CDPManager,
  params: {
    action?: string;
    key?: string;
    value?: string;
    session?: boolean;
    tab?: string;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const action = params.action || 'list';
  const storageType = params.session ? 'sessionStorage' : 'localStorage';

  if (action === 'get') {
    if (!params.key) {
      return { ok: false, error: 'Storage key is required', code: 'INVALID_ARGUMENT' };
    }
    const result = await client.Runtime.evaluate({
      expression: `${storageType}.getItem(${JSON.stringify(params.key)})`,
      returnByValue: true,
    });
    return { ok: true, value: result.result?.value ?? null };
  }

  if (action === 'set') {
    if (!params.key || params.value === undefined) {
      return { ok: false, error: 'Storage key and value are required', code: 'INVALID_ARGUMENT' };
    }
    await client.Runtime.evaluate({
      expression: `${storageType}.setItem(${JSON.stringify(params.key)}, ${JSON.stringify(params.value)})`,
      returnByValue: true,
    });
    audit('storage', { action: 'set', key: params.key, storageType });
    return { ok: true };
  }

  if (action === 'delete') {
    if (!params.key) {
      return { ok: false, error: 'Storage key is required', code: 'INVALID_ARGUMENT' };
    }
    await client.Runtime.evaluate({
      expression: `${storageType}.removeItem(${JSON.stringify(params.key)})`,
      returnByValue: true,
    });
    audit('storage', { action: 'delete', key: params.key, storageType });
    return { ok: true };
  }

  if (action === 'list') {
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        const s = ${storageType};
        const entries = {};
        for (let i = 0; i < s.length; i++) {
          const key = s.key(i);
          entries[key] = s.getItem(key);
        }
        return JSON.stringify(entries);
      })()`,
      returnByValue: true,
    });
    const entries = JSON.parse(result.result?.value || '{}');
    return { ok: true, entries };
  }

  if (action === 'clear') {
    await client.Runtime.evaluate({
      expression: `${storageType}.clear()`,
      returnByValue: true,
    });
    audit('storage', { action: 'clear', storageType });
    return { ok: true };
  }

  return { ok: false, error: `Unknown storage action: ${action}`, code: 'INVALID_ARGUMENT' };
}
