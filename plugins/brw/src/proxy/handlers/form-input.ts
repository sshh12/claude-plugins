import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';

export async function handleFormInput(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    ref?: string;
    selector?: string;
    value: string;
    tab?: string;
    frame?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  if (!params.ref && !params.selector) {
    return { ok: false, error: 'Must specify --ref or --selector', code: 'INVALID_ARGUMENT' };
  }

  const resolveExpr = params.ref
    ? `window.__brwElementMap?.get(${JSON.stringify(params.ref)})?.deref()`
    : `document.querySelector(${JSON.stringify(params.selector)})`;

  // Build evaluate options, adding frame context if --frame is specified
  const evalOptions: any = {
    expression: `(function() {
      const el = ${resolveExpr};
      if (!el) return JSON.stringify({error: 'not_found'});

      // Scroll into view
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const tag = el.tagName.toLowerCase();
      const type = (el.type || '').toLowerCase();
      const value = ${JSON.stringify(params.value)};

      // Set value based on element type
      if (tag === 'select') {
        el.value = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (tag === 'input' && (type === 'checkbox' || type === 'radio')) {
        const shouldCheck = value === 'true' || value === '1' || value === 'on';
        if (el.checked !== shouldCheck) {
          el.checked = shouldCheck;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else if (el.contentEditable === 'true') {
        el.focus();
        el.textContent = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // Standard input/textarea
        el.focus();
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, value);
        } else {
          el.value = value;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      return JSON.stringify({ok: true});
    })()`,
    returnByValue: true,
    awaitPromise: false,
  };

  // Resolve frame execution context if --frame is specified
  if (params.frame) {
    const contextId = await cdp.resolveFrameContext(params.frame, tabId);
    if (contextId === null) {
      return { ok: false, error: `Frame "${params.frame}" not found`, code: 'FRAME_NOT_FOUND' };
    }
    evalOptions.contextId = contextId;
  }

  const result = await client.Runtime.evaluate(evalOptions);

  if (result.exceptionDetails) {
    return { ok: false, error: `form-input failed: ${result.exceptionDetails.text}`, code: 'CDP_ERROR' };
  }

  const data = JSON.parse(result.result?.value || '{}');
  if (data.error === 'not_found') {
    const target = params.ref || params.selector;
    return {
      ok: false,
      error: `Element ${target} not found`,
      code: params.ref ? 'REF_NOT_FOUND' : 'SELECTOR_NOT_FOUND',
    };
  }

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}
