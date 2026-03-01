import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

export async function handleJs(
  cdp: CDPManager,
  params: {
    expression: string;
    tab?: string;
    frame?: string;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  const evalOptions: any = {
    expression: params.expression,
    returnByValue: true,
    awaitPromise: true,
    timeout: 30000,
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
    const errorText =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'JavaScript evaluation error';
    return {
      ok: false,
      error: errorText,
      code: 'JS_ERROR',
      hint: 'Check your JavaScript expression syntax.',
    };
  }

  // Serialize the result
  let resultValue: any;
  const remoteObj = result.result;

  if (remoteObj.type === 'undefined') {
    resultValue = undefined;
  } else if (remoteObj.value !== undefined) {
    resultValue = remoteObj.value;
  } else if (remoteObj.description) {
    resultValue = remoteObj.description;
  } else {
    resultValue = null;
  }

  return { ok: true, result: resultValue };
}
