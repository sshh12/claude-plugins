import type { CDPManager } from '../cdp.js';
import type { ApiResponse, NetworkRequest } from '../../shared/types.js';

/**
 * Normalize a urlPattern parameter — accept either a single string (possibly
 * comma-separated for OR), an array, or undefined. Each pattern is a plain
 * substring match.
 */
/**
 * Match a status code against filters like "401", "4xx", "2xx", "5xx".
 */
function matchesAnyStatus(status: number, filters: string[]): boolean {
  for (const f of filters) {
    const lower = f.toLowerCase().trim();
    const cls = /^([1-5])xx$/.exec(lower);
    if (cls) {
      const base = parseInt(cls[1], 10) * 100;
      if (status >= base && status < base + 100) return true;
      continue;
    }
    const exact = parseInt(lower, 10);
    if (Number.isFinite(exact) && status === exact) return true;
  }
  return false;
}

function normalizePatterns(input: string | string[] | undefined): string[] {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  for (const p of list) {
    if (!p) continue;
    for (const piece of String(p).split(',')) {
      const t = piece.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * Strip request headers/body for slim network listing. Use full flag to include them.
 */
function slim(r: NetworkRequest): NetworkRequest {
  const { requestHeaders, requestBody, ...rest } = r;
  // Suppress unused warnings — we intentionally drop these fields
  void requestHeaders;
  void requestBody;
  return rest;
}

/**
 * If the request body looks like JSON or form-encoded JSON (e.g. `f.req=<URL-encoded JSON>`),
 * parse it and attach as a structured field. Lets callers skim payloads without manually
 * unescaping and JSON-parsing.
 */
function attachParsedBody(r: NetworkRequest): NetworkRequest {
  if (!r.requestBody) return r;
  const trimmed = r.requestBody.trim();
  const result: NetworkRequest & { requestBodyJson?: unknown; requestBodyForm?: Record<string, unknown> } = { ...r };

  // Direct JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      result.requestBodyJson = JSON.parse(trimmed);
      return result;
    } catch { /* fall through */ }
  }

  // Form-encoded with JSON values (Google's f.req=..., classic GWT/RPC patterns)
  if (trimmed.includes('=') && trimmed.includes('%')) {
    try {
      const form: Record<string, unknown> = {};
      const params = new URLSearchParams(trimmed);
      let anyJson = false;
      for (const [k, v] of params) {
        const t = v.trim();
        if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
          try { form[k] = JSON.parse(t); anyJson = true; continue; } catch { /* fall through */ }
        }
        form[k] = v;
      }
      if (anyJson) {
        result.requestBodyForm = form;
        return result;
      }
    } catch { /* fall through */ }
  }

  return result;
}

export async function handleNetwork(
  cdp: CDPManager,
  params: {
    tab?: string;
    urlPattern?: string | string[];
    limit?: number;
    clear?: boolean;
    full?: boolean;
    withBodyPreview?: number;
    status?: string | string[];
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  let requests = cdp.getNetworkBuffer(tabId);

  const patterns = normalizePatterns(params.urlPattern);
  if (patterns.length > 0) {
    requests = requests.filter((r) => patterns.some((p) => r.url.includes(p)));
  }

  const statusFilters = normalizePatterns(params.status);
  if (statusFilters.length > 0) {
    requests = requests.filter((r) => matchesAnyStatus(r.status, statusFilters));
  }

  if (params.limit && params.limit > 0) {
    requests = requests.slice(-params.limit);
  }

  let output: any[] = params.full ? requests.map(attachParsedBody) : requests.map(slim);

  // Optionally fetch a slice of each response body. On-demand because we don't
  // cache bodies at capture time. Capped at 2000 chars to keep responses small.
  if (params.withBodyPreview && params.withBodyPreview > 0) {
    const cap = Math.min(params.withBodyPreview, 2000);
    const client = cdp.getClient(tabId);
    output = await Promise.all(output.map(async (r: any) => {
      try {
        const { body, base64Encoded } = await client.Network.getResponseBody({ requestId: r.id });
        if (base64Encoded) {
          return { ...r, bodyPreview: '[binary; use brw network-body for raw]', bodyTruncated: true };
        }
        const truncated = body.length > cap;
        const preview = truncated ? body.substring(0, cap) : body;
        // Strip Google's XSSI prefix for readability
        const cleaned = preview.replace(/^\)\]\}'\s*\n?/, '');
        return { ...r, bodyPreview: cleaned, bodyTruncated: truncated, bodyTotalSize: body.length };
      } catch {
        return { ...r, bodyPreview: null, bodyError: 'unavailable' };
      }
    }));
  }

  if (params.clear) {
    cdp.clearNetworkBuffer(tabId);
  }

  return { ok: true, requests: output };
}

export async function handleNetworkRequest(
  cdp: CDPManager,
  params: {
    tab?: string;
    requestId: string;
  }
): Promise<ApiResponse> {
  if (!params.requestId) {
    return { ok: false, error: 'requestId is required', code: 'INVALID_ARGUMENT' };
  }

  const tabId = params.tab;
  const buffer = cdp.getNetworkBuffer(tabId);
  const match = buffer.find((r) => r.id === params.requestId);

  if (!match) {
    return {
      ok: false,
      error: `Request ${params.requestId} not found in buffer`,
      code: 'NETWORK_REQUEST_NOT_FOUND',
      hint: 'Use "brw network" to list captured requests and their IDs.',
    };
  }

  return { ok: true, request: attachParsedBody(match) };
}

export async function handleNetworkBody(
  cdp: CDPManager,
  params: {
    tab?: string;
    requestId: string;
  }
): Promise<ApiResponse> {
  if (!params.requestId) {
    return { ok: false, error: 'requestId is required', code: 'INVALID_ARGUMENT' };
  }

  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  try {
    const result = await client.Network.getResponseBody({ requestId: params.requestId });
    return {
      ok: true,
      body: result.body,
      base64: result.base64Encoded || false,
      mimeType: 'application/octet-stream',
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `Failed to get response body: ${err?.message || 'Unknown error'}`,
      code: 'NETWORK_REQUEST_NOT_FOUND',
      hint: 'Use "brw network" to list captured requests and their IDs.',
    };
  }
}
