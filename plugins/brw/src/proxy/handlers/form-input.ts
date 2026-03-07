import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';
import { resolveTargetElement } from './resolve-target.js';

export async function handleFormInput(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    ref?: string;
    selector?: string;
    text?: string;
    label?: string;
    wait?: number;
    value: string;
    tab?: string;
    frame?: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  // Resolve element expression — supports ref, selector, text, label
  let resolveExpr: string;
  if (params.ref || params.selector || params.text || params.label) {
    const resolved = await resolveTargetElement(cdp, {
      ref: params.ref, selector: params.selector,
      text: params.text, label: params.label,
      tab: tabId, wait: params.wait, frame: params.frame,
    });
    if (!resolved.ok) return resolved;
    resolveExpr = resolved.resolveExpr!;
  } else {
    return { ok: false, error: 'Must specify --ref, --selector, --text, or --label', code: 'INVALID_ARGUMENT' };
  }

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
    const target = params.ref || params.selector || params.text || params.label;
    return {
      ok: false,
      error: `Element ${target} not found`,
      code: params.ref ? 'REF_NOT_FOUND' : params.selector ? 'SELECTOR_NOT_FOUND' : params.text ? 'TEXT_NOT_FOUND' : 'LABEL_NOT_FOUND',
    };
  }

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}
