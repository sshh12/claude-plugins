import { readFileSync, existsSync } from 'fs';
import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';
import { checkAllowedPath } from '../../shared/config.js';
import type { BrwConfig } from '../../shared/types.js';
import { getGlobalLogger, audit } from '../logger.js';

interface InterceptRule {
  id: string;
  pattern: string;
  statusCode?: number;
  body?: string;
  headers?: Record<string, string>;
  block: boolean;
}

// Global intercept state per tab
const interceptRules = new Map<string, InterceptRule[]>();
// Track which clients already have a Fetch.requestPaused listener registered
const registeredListeners = new Set<string>();
let ruleCounter = 0;

export async function handleIntercept(
  cdp: CDPManager,
  params: {
    action?: string;
    pattern?: string;
    statusCode?: number;
    body?: string;
    bodyFile?: string;
    headers?: string[];
    block?: boolean;
    ruleId?: string;
    tab?: string;
  },
  config: BrwConfig
): Promise<ApiResponse> {
  const tabId = params.tab || cdp.getActiveTabId() || '';
  const client = cdp.getClient(tabId || undefined);
  const action = params.action || 'list';

  if (action === 'add') {
    if (!params.pattern) {
      return { ok: false, error: 'URL pattern is required', code: 'INVALID_ARGUMENT' };
    }

    ruleCounter++;
    const rule: InterceptRule = {
      id: `rule_${ruleCounter}`,
      pattern: params.pattern,
      statusCode: params.statusCode,
      body: params.body,
      block: params.block || false,
      headers: {},
    };

    // Read body from file if --body-file is specified
    if (params.bodyFile) {
      if (!checkAllowedPath(params.bodyFile, config.allowedPaths)) {
        return {
          ok: false,
          error: `File path ${params.bodyFile} is not in the allowed paths`,
          code: 'PATH_BLOCKED',
        };
      }
      if (!existsSync(params.bodyFile)) {
        return { ok: false, error: `Body file not found: ${params.bodyFile}`, code: 'FILE_NOT_FOUND' };
      }
      try {
        rule.body = readFileSync(params.bodyFile, 'utf-8');
      } catch (err: any) {
        return { ok: false, error: `Failed to read body file: ${err?.message || 'Unknown error'}`, code: 'FILE_NOT_FOUND' };
      }
    }

    // Parse headers from array of "Key: Value" strings
    if (params.headers) {
      for (const h of params.headers) {
        const colonIdx = h.indexOf(':');
        if (colonIdx > 0) {
          rule.headers![h.substring(0, colonIdx).trim()] = h.substring(colonIdx + 1).trim();
        }
      }
    }

    if (!interceptRules.has(tabId)) {
      interceptRules.set(tabId, []);
    }
    interceptRules.get(tabId)!.push(rule);

    // Enable Fetch domain with the pattern
    await updateFetchPatterns(client, tabId);

    const logger = getGlobalLogger();
    logger.info('intercept add', { ruleId: rule.id, pattern: rule.pattern, ruleCount: interceptRules.get(tabId)!.length });
    audit('intercept', { action: 'add', pattern: rule.pattern, ruleId: rule.id });

    return { ok: true, ruleId: rule.id };
  }

  if (action === 'list') {
    const rules = interceptRules.get(tabId) || [];
    return {
      ok: true,
      rules: rules.map((r) => ({
        id: r.id,
        pattern: r.pattern,
        action: r.block ? 'block' : 'modify',
        statusCode: r.statusCode,
        body: r.body ? `${r.body.substring(0, 100)}${r.body.length > 100 ? '...' : ''}` : undefined,
      })),
    };
  }

  if (action === 'remove') {
    if (!params.ruleId) {
      return { ok: false, error: 'Rule ID is required', code: 'INVALID_ARGUMENT' };
    }
    const rules = interceptRules.get(tabId) || [];
    const idx = rules.findIndex((r) => r.id === params.ruleId);
    if (idx === -1) {
      return { ok: false, error: `Rule ${params.ruleId} not found`, code: 'INVALID_ARGUMENT' };
    }
    rules.splice(idx, 1);

    const logger = getGlobalLogger();
    logger.info('intercept remove', { ruleId: params.ruleId, remaining: rules.length });
    audit('intercept', { action: 'remove', ruleId: params.ruleId });

    if (rules.length === 0) {
      interceptRules.delete(tabId);
      registeredListeners.delete(tabId);
      try {
        await client.Fetch.disable();
      } catch {
        // ignore
      }
    } else {
      await updateFetchPatterns(client, tabId);
    }

    return { ok: true };
  }

  if (action === 'clear') {
    const logger = getGlobalLogger();
    logger.info('intercept clear', { tabId });
    audit('intercept', { action: 'clear' });
    interceptRules.delete(tabId);
    registeredListeners.delete(tabId);
    try {
      await client.Fetch.disable();
    } catch {
      // ignore
    }
    return { ok: true };
  }

  return { ok: false, error: `Unknown intercept action: ${action}`, code: 'INVALID_ARGUMENT' };
}

async function updateFetchPatterns(client: any, tabId: string): Promise<void> {
  const rules = interceptRules.get(tabId) || [];
  if (rules.length === 0) {
    try {
      await client.Fetch.disable();
    } catch {
      // ignore
    }
    registeredListeners.delete(tabId);
    return;
  }

  const patterns = rules.map((r) => ({
    urlPattern: r.pattern,
    requestStage: 'Response' as const,
  }));

  await client.Fetch.enable({ patterns });

  // Only register a single Fetch.requestPaused listener per tab.
  // The listener reads from the shared interceptRules map each time,
  // so it always sees the latest rules without needing to re-register.
  if (!registeredListeners.has(tabId)) {
    registeredListeners.add(tabId);

    client.on('Fetch.requestPaused', async (event: any) => {
      const currentRules = interceptRules.get(tabId) || [];
      const matchingRule = currentRules.find((r) => {
        const regex = new RegExp(
          '^' + r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'
        );
        return regex.test(event.request.url);
      });

      if (!matchingRule) {
        try {
          await client.Fetch.continueRequest({ requestId: event.requestId });
        } catch {
          // ignore
        }
        return;
      }

      if (matchingRule.block) {
        try {
          await client.Fetch.failRequest({ requestId: event.requestId, reason: 'BlockedByClient' });
        } catch {
          // ignore
        }
        return;
      }

      // Modify response
      const responseHeaders = event.responseHeaders || [];
      if (matchingRule.headers) {
        for (const [name, value] of Object.entries(matchingRule.headers)) {
          const existingIdx = responseHeaders.findIndex((h: any) => h.name.toLowerCase() === name.toLowerCase());
          if (existingIdx >= 0) {
            responseHeaders[existingIdx].value = value;
          } else {
            responseHeaders.push({ name, value });
          }
        }
      }

      try {
        await client.Fetch.fulfillRequest({
          requestId: event.requestId,
          responseCode: matchingRule.statusCode || event.responseStatusCode || 200,
          responseHeaders,
          body: matchingRule.body ? Buffer.from(matchingRule.body).toString('base64') : undefined,
        });
      } catch {
        // ignore
      }
    });
  }
}
