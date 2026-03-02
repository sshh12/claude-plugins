import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';

export async function handleDialog(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    action?: string;
    text?: string;
    tab?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const action = params.action || 'check';

  const pending = cdp.getPendingDialog(tabId);

  if (action === 'check') {
    if (!pending) {
      return { ok: true, pending: false };
    }
    return {
      ok: true,
      pending: true,
      dialogType: pending.type,
      message: pending.message,
    };
  }

  if (action === 'accept') {
    if (!pending) {
      return { ok: false, error: 'No pending dialog to accept', code: 'DIALOG_NOT_FOUND', hint: 'Dialogs auto-dismiss after 5 seconds. Use "dialog check" first to verify a dialog is pending.' };
    }
    await client.Page.handleJavaScriptDialog({
      accept: true,
      promptText: params.text,
    });
    const page = await cdp.getPageInfo(tabId);
    const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
    return {
      ok: true,
      screenshot: screenshotResult.screenshot,
      page,
      dialogType: pending.type,
      message: pending.message,
      action: 'accept',
    };
  }

  if (action === 'dismiss') {
    if (!pending) {
      return { ok: false, error: 'No pending dialog to dismiss', code: 'DIALOG_NOT_FOUND', hint: 'Dialogs auto-dismiss after 5 seconds. Use "dialog check" first to verify a dialog is pending.' };
    }
    await client.Page.handleJavaScriptDialog({ accept: false });
    const page = await cdp.getPageInfo(tabId);
    const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
    return {
      ok: true,
      screenshot: screenshotResult.screenshot,
      page,
      dialogType: pending.type,
      message: pending.message,
      action: 'dismiss',
    };
  }

  return { ok: false, error: `Unknown dialog action: ${action}. Use accept, dismiss, or check.`, code: 'INVALID_ARGUMENT' };
}
