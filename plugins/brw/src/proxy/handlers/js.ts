import type { CDPManager } from '../cdp.js';
import type { ApiResponse, BrwConfig } from '../../shared/types.js';
import { checkUrlPolicy, checkProtocol } from '../../shared/config.js';
import { ErrorCode } from '../../shared/types.js';
import { audit } from '../logger.js';

// Serializer function injected into the page to handle DOMRect, DOMPoint, etc.
const DOM_SERIALIZER = `function(obj) {
  function serialize(v) {
    if (v === null || v === undefined) return v;
    if (typeof v !== 'object') return v;
    if (v instanceof DOMRect || v instanceof DOMRectReadOnly) {
      return { x: v.x, y: v.y, width: v.width, height: v.height, top: v.top, right: v.right, bottom: v.bottom, left: v.left };
    }
    if (typeof DOMPoint !== 'undefined' && (v instanceof DOMPoint || v instanceof DOMPointReadOnly)) {
      return { x: v.x, y: v.y, z: v.z, w: v.w };
    }
    if (typeof DOMMatrix !== 'undefined' && v instanceof DOMMatrix) {
      return { a: v.a, b: v.b, c: v.c, d: v.d, e: v.e, f: v.f };
    }
    if (typeof CSSStyleDeclaration !== 'undefined' && v instanceof CSSStyleDeclaration) {
      var o = {}; for (var i = 0; i < v.length; i++) { var p = v[i]; o[p] = v.getPropertyValue(p); } return o;
    }
    if (Array.isArray(v)) return v.map(serialize);
    if (v.constructor === Object || Object.getPrototypeOf(v) === Object.prototype) {
      var result = {};
      for (var key in v) { if (v.hasOwnProperty(key)) result[key] = serialize(v[key]); }
      return result;
    }
    try { return JSON.parse(JSON.stringify(v)); } catch(e) { return String(v); }
  }
  return serialize(obj);
}`;

export async function handleJs(
  cdp: CDPManager,
  params: {
    expression: string;
    tab?: string;
    frame?: string;
  },
  config: BrwConfig
): Promise<ApiResponse> {
  // Capture URL before execution for post-exec check
  let urlBefore: string | undefined;
  const needsUrlCheck = !(config.allowedUrls.length === 1 && config.allowedUrls[0] === '*' && config.blockedUrls.length === 0) || config.blockedProtocols.length > 0;
  if (needsUrlCheck) {
    try {
      const pageInfo = await cdp.getPageInfo(params.tab);
      urlBefore = pageInfo.url;
    } catch {
      // best effort
    }
  }

  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  // Auto-wrap await expressions in async IIFE
  let expression = params.expression;
  if (/\bawait\s/.test(expression)) {
    const trimmed = expression.trim();
    const lines = trimmed.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 1 && !trimmed.endsWith(';')) {
      expression = `(async () => { return ${expression}; })()`;
    } else {
      expression = `(async () => { ${expression} })()`;
    }
  }

  // Step 1: Evaluate with returnByValue: false to get a RemoteObject reference
  const evalOptions: any = {
    expression,
    returnByValue: false,
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

  const remoteObj = result.result;

  // Step 2: For primitives, use value directly
  if (remoteObj.type === 'undefined') {
    const urlCheck = await postExecUrlCheck(cdp, config, params.tab, params.expression, urlBefore);
    if (urlCheck) return urlCheck;
    return { ok: true, result: undefined };
  }

  if (remoteObj.type !== 'object' || remoteObj.subtype === 'null') {
    const resultValue = remoteObj.value !== undefined ? remoteObj.value : remoteObj.description ?? null;
    const urlCheck = await postExecUrlCheck(cdp, config, params.tab, params.expression, urlBefore);
    if (urlCheck) return urlCheck;
    return { ok: true, result: resultValue };
  }

  // Step 3: For objects, use callFunctionOn with serializer to handle DOMRect etc.
  if (remoteObj.objectId) {
    try {
      const serialized = await client.Runtime.callFunctionOn({
        objectId: remoteObj.objectId,
        functionDeclaration: DOM_SERIALIZER,
        arguments: [{ objectId: remoteObj.objectId }],
        returnByValue: true,
      });

      // Release the RemoteObject
      try { await client.Runtime.releaseObject({ objectId: remoteObj.objectId }); } catch { /* ignore */ }

      if (serialized.exceptionDetails) {
        // Serializer failed — fall back to returnByValue
        return await handleJsFallback(client, params, evalOptions);
      }

      const urlCheck = await postExecUrlCheck(cdp, config, params.tab, params.expression, urlBefore);
      if (urlCheck) return urlCheck;
      return { ok: true, result: serialized.result?.value ?? null };
    } catch {
      // callFunctionOn failed — fall back
      try { await client.Runtime.releaseObject({ objectId: remoteObj.objectId }); } catch { /* ignore */ }
      return await handleJsFallback(client, params, evalOptions);
    }
  }

  // No objectId — use value or description
  const resultValue = remoteObj.value !== undefined ? remoteObj.value : remoteObj.description ?? null;
  const urlCheck = await postExecUrlCheck(cdp, config, params.tab, params.expression, urlBefore);
  if (urlCheck) return urlCheck;
  return { ok: true, result: resultValue };
}

async function postExecUrlCheck(
  cdp: CDPManager,
  config: BrwConfig,
  tabId: string | undefined,
  expression: string,
  urlBefore: string | undefined
): Promise<ApiResponse | null> {
  const needsCheck = !(config.allowedUrls.length === 1 && config.allowedUrls[0] === '*' && config.blockedUrls.length === 0) || config.blockedProtocols.length > 0;
  if (!needsCheck) return null;

  try {
    const page = await cdp.getPageInfo(tabId);

    // Check protocol blocklist first
    const blockedProto = checkProtocol(page.url, config.blockedProtocols);
    if (blockedProto) {
      audit('js', {
        expression: expression.substring(0, 200),
        urlBefore: urlBefore || 'unknown',
        urlAfter: page.url,
        blocked: true,
        reason: 'protocol_blocked',
        protocol: blockedProto,
      });
      const client = cdp.getClient(tabId);
      await client.Page.navigate({ url: 'about:blank' });
      return {
        ok: false,
        error: `JS execution navigated to blocked protocol: ${blockedProto}://`,
        code: ErrorCode.PROTOCOL_BLOCKED,
        hint: `${blockedProto}:// is blocked by default. Set BRW_BLOCKED_PROTOCOLS to override.`,
      };
    }

    if (!checkUrlPolicy(page.url, config.allowedUrls, config.blockedUrls)) {
      audit('js', {
        expression: expression.substring(0, 200),
        urlBefore: urlBefore || 'unknown',
        urlAfter: page.url,
        blocked: true,
      });
      // Navigate back to about:blank
      const client = cdp.getClient(tabId);
      await client.Page.navigate({ url: 'about:blank' });
      return {
        ok: false,
        error: `JS execution navigated to blocked URL: ${page.url}`,
        code: 'URL_BLOCKED',
      };
    }
    audit('js', {
      expression: expression.substring(0, 200),
      urlBefore: urlBefore || 'unknown',
      urlAfter: page.url,
      blocked: false,
    });
  } catch {
    // best effort
  }
  return null;
}

async function handleJsFallback(
  client: any,
  params: { expression: string; frame?: string },
  baseOptions: any
): Promise<ApiResponse> {
  const fallbackResult = await client.Runtime.evaluate({
    ...baseOptions,
    returnByValue: true,
  });

  if (fallbackResult.exceptionDetails) {
    return {
      ok: false,
      error: fallbackResult.exceptionDetails.exception?.description || 'JavaScript evaluation error',
      code: 'JS_ERROR',
    };
  }

  const obj = fallbackResult.result;
  const value = obj.type === 'undefined' ? undefined : (obj.value !== undefined ? obj.value : obj.description ?? null);
  return { ok: true, result: value };
}
