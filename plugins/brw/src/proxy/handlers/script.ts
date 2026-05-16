import type { CDPManager } from '../cdp.js';
import type { ApiResponse, BrwConfig } from '../../shared/types.js';
import { checkUrlPolicy, checkProtocol } from '../../shared/config.js';
import { ErrorCode } from '../../shared/types.js';
import { audit } from '../logger.js';

/**
 * Wrap a user-supplied script body in an async IIFE that exposes
 * `args`, `log()`, and `sleep()` as locals, captures logs, and returns
 * a structured result envelope.
 *
 * The user script body runs inside its own async function — it may use
 * top-level `await` and `return <value>` to send a value back to the caller.
 */
function wrapScript(source: string, args: Record<string, unknown>): string {
  const argsJson = JSON.stringify(args ?? {});
  // The wrapper returns a JSON string. We parse it in the handler to safely
  // round-trip nested objects without relying on Runtime.evaluate object serialization.
  return `(async () => {
  const args = ${argsJson};
  const __logs = [];
  const log = (...__a) => {
    try {
      __logs.push(__a.map((x) => {
        if (typeof x === 'string') return x;
        try { return JSON.stringify(x); } catch (e) { return String(x); }
      }).join(' '));
    } catch (e) {
      __logs.push(String(e));
    }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Helper: strip the )]}' XSSI prefix used by Google/YouTube/Maps/Workspace.
  const xssiUnwrap = (text) => typeof text === 'string'
    ? text.replace(/^\\)\\]\\}'\\s*\\n?/, '')
    : text;

  // Helper: read a response body as JSON, transparently stripping XSSI prefix.
  // Pass either a Response (from fetch) or a string.
  const gjson = async (responseOrText) => {
    const text = typeof responseOrText === 'string'
      ? responseOrText
      : await responseOrText.text();
    return JSON.parse(xssiUnwrap(text));
  };

  // Helper: read csrf-token from a named cookie (Twitter ct0, LinkedIn JSESSIONID).
  const cookie = (name) => {
    const m = document.cookie.split(';').map((s) => s.trim()).find((c) => c.startsWith(name + '='));
    if (!m) return null;
    return decodeURIComponent(m.slice(name.length + 1).replace(/^"|"$/g, ''));
  };

  const __start = Date.now();
  let __res;
  try {
    const __body = async () => {
${source}
    };
    const __value = await __body();
    __res = { ok: true, result: __value, logs: __logs, durationMs: Date.now() - __start };
  } catch (err) {
    __res = {
      ok: false,
      error: (err && (err.message || String(err))) || 'Script error',
      stack: err && err.stack,
      logs: __logs,
      durationMs: Date.now() - __start,
    };
  }
  try { return JSON.stringify(__res); } catch (e) {
    return JSON.stringify({ ok: false, error: 'Script result could not be serialized to JSON: ' + (e && e.message), logs: __res.logs, durationMs: __res.durationMs });
  }
})()`;
}

export async function handleScriptRun(
  cdp: CDPManager,
  params: {
    source: string;
    args?: Record<string, unknown>;
    tab?: string;
    frame?: string;
    timeout?: number; // seconds
  },
  config: BrwConfig
): Promise<ApiResponse> {
  if (typeof params.source !== 'string' || params.source.trim().length === 0) {
    return { ok: false, error: 'source is required', code: ErrorCode.INVALID_ARGUMENT };
  }

  // Capture URL before for policy check
  let urlBefore: string | undefined;
  const needsUrlCheck =
    !(config.allowedUrls.length === 1 && config.allowedUrls[0] === '*' && config.blockedUrls.length === 0) ||
    config.blockedProtocols.length > 0;
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
  const timeoutMs = Math.max(1000, Math.min((params.timeout ?? 60) * 1000, 600_000));

  const expression = wrapScript(params.source, params.args ?? {});

  const evalOptions: any = {
    expression,
    returnByValue: true,
    awaitPromise: true,
    timeout: timeoutMs,
  };

  if (params.frame) {
    const contextId = await cdp.resolveFrameContext(params.frame, tabId);
    if (contextId === null) {
      return { ok: false, error: `Frame "${params.frame}" not found`, code: 'FRAME_NOT_FOUND' };
    }
    evalOptions.contextId = contextId;
  }

  const result = await client.Runtime.evaluate(evalOptions);

  // URL policy post-check
  if (needsUrlCheck) {
    try {
      const pageAfter = await cdp.getPageInfo(params.tab);
      const blockedProto = checkProtocol(pageAfter.url, config.blockedProtocols);
      if (blockedProto) {
        audit('script-run', {
          urlBefore: urlBefore || 'unknown',
          urlAfter: pageAfter.url,
          blocked: true,
          reason: 'protocol_blocked',
          protocol: blockedProto,
        });
        await client.Page.navigate({ url: 'about:blank' });
        return {
          ok: false,
          error: `Script navigated to blocked protocol: ${blockedProto}://`,
          code: ErrorCode.PROTOCOL_BLOCKED,
        };
      }
      if (!checkUrlPolicy(pageAfter.url, config.allowedUrls, config.blockedUrls)) {
        audit('script-run', {
          urlBefore: urlBefore || 'unknown',
          urlAfter: pageAfter.url,
          blocked: true,
        });
        await client.Page.navigate({ url: 'about:blank' });
        return {
          ok: false,
          error: `Script navigated to blocked URL: ${pageAfter.url}`,
          code: 'URL_BLOCKED',
        };
      }
      audit('script-run', {
        urlBefore: urlBefore || 'unknown',
        urlAfter: pageAfter.url,
        blocked: false,
      });
    } catch {
      // best-effort
    }
  }

  if (result.exceptionDetails) {
    const errorText =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'Script evaluation error';
    return {
      ok: false,
      error: errorText,
      code: 'JS_ERROR',
      hint: 'Check the script for syntax errors. Use `brw script run` with --timeout for long-running scripts.',
    };
  }

  const remote = result.result;
  // The wrapper returns a JSON string
  if (remote?.type === 'string' && typeof remote.value === 'string') {
    try {
      const parsed = JSON.parse(remote.value);
      if (parsed && parsed.ok === false) {
        return {
          ok: false,
          error: parsed.error || 'Script error',
          code: 'SCRIPT_ERROR',
          hint: 'The script threw an exception. Check `stack` for details.',
          stack: parsed.stack,
          logs: parsed.logs,
          durationMs: parsed.durationMs,
        };
      }
      return {
        ok: true,
        result: parsed?.result,
        logs: parsed?.logs ?? [],
        durationMs: parsed?.durationMs ?? 0,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: `Failed to parse script result envelope: ${err?.message || 'unknown'}`,
        code: 'JS_ERROR',
      };
    }
  }

  return {
    ok: false,
    error: 'Script wrapper did not return a JSON envelope',
    code: 'JS_ERROR',
  };
}
