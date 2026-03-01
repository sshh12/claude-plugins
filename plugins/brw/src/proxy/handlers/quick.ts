import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';
import { handleClick } from './click.js';
import { handleType } from './type.js';
import { handleKey } from './key.js';
import { handleNavigate } from './navigate.js';
import { handleListTabs, handleNewTab, handleSwitchTab } from './tabs.js';
import { handleReadPage } from './read-page.js';
import { handleFormInput } from './form-input.js';
import { handleWaitFor } from './wait-for.js';
import { checkUrlPolicy } from '../../shared/config.js';
import { audit } from '../logger.js';

interface QuickCommand {
  cmd: string;
  args: string;
}

function parseQuickCommands(input: string): QuickCommand[] {
  if (!input || input.trim() === '') return [];

  const lines = input.split('\n');
  const commands: QuickCommand[] = [];
  let currentCmd: QuickCommand | null = null;
  const multiLineCommands = new Set(['T', 'J']);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Check if this line starts a new command
    const match = trimmed.match(/^([A-Z]{1,2})\s*(.*)/);
    if (match) {
      const [, cmd, args] = match;
      // Check if it's a recognized command letter
      if (isValidCommand(cmd)) {
        if (currentCmd) {
          commands.push(currentCmd);
        }
        currentCmd = { cmd, args: args.trim() };
        continue;
      }
    }

    // Continuation line for multi-line commands (T, J)
    if (currentCmd && multiLineCommands.has(currentCmd.cmd)) {
      currentCmd.args += '\n' + trimmed;
    }
  }

  if (currentCmd) {
    commands.push(currentCmd);
  }

  return commands;
}

function isValidCommand(cmd: string): boolean {
  return [
    'C', 'RC', 'DC', 'TC', 'H', 'T', 'K', 'S', 'D', 'Z',
    'N', 'J', 'W', 'ST', 'NT', 'LT',
    'CR', 'FR', 'R', 'WF',
  ].includes(cmd);
}

export async function handleQuick(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    tab?: string;
    commands: string;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const commands = parseQuickCommands(params.commands);
  const tabId = params.tab;
  const results: Array<{ command: string; [key: string]: unknown }> = [];

  for (const { cmd, args } of commands) {
    try {
      switch (cmd) {
        case 'C':
        case 'RC':
        case 'DC':
        case 'TC': {
          const parts = args.split(/\s+/);
          if (parts.length < 2) {
            return { ok: false, error: `${cmd} requires 2 coordinates (x y), got ${parts.length}`, code: 'INVALID_ARGUMENT' };
          }
          const x = parseInt(parts[0], 10);
          const y = parseInt(parts[1], 10);
          if (isNaN(x) || isNaN(y)) {
            return { ok: false, error: `${cmd} requires numeric coordinates`, code: 'INVALID_ARGUMENT' };
          }
          await handleClick(cdp, config, {
            tab: tabId,
            x,
            y,
            right: cmd === 'RC',
            double: cmd === 'DC',
            triple: cmd === 'TC',
            noScreenshot: true,
          });
          break;
        }

        case 'H': {
          const parts = args.split(/\s+/);
          if (parts.length < 2) {
            return { ok: false, error: `H requires 2 coordinates (x y), got ${parts.length}`, code: 'INVALID_ARGUMENT' };
          }
          const x = parseInt(parts[0], 10);
          const y = parseInt(parts[1], 10);
          const client = cdp.getClient(tabId);
          await client.Input.dispatchMouseEvent({
            type: 'mouseMoved',
            x,
            y,
          });
          break;
        }

        case 'T': {
          if (!args) {
            return { ok: false, error: 'T requires text argument', code: 'INVALID_ARGUMENT' };
          }
          await handleType(cdp, config, {
            tab: tabId,
            text: args,
            noScreenshot: true,
          });
          break;
        }

        case 'K': {
          if (!args) {
            return { ok: false, error: 'K requires key argument', code: 'INVALID_ARGUMENT' };
          }
          await handleKey(cdp, config, {
            tab: tabId,
            keys: args,
            noScreenshot: true,
          });
          break;
        }

        case 'S': {
          const parts = args.split(/\s+/);
          if (parts.length < 4) {
            return { ok: false, error: 'S requires direction, amount, x, y', code: 'INVALID_ARGUMENT' };
          }
          const [direction, amountStr, xStr, yStr] = parts;
          const amount = parseInt(amountStr, 10);
          const x = parseInt(xStr, 10);
          const y = parseInt(yStr, 10);
          if (isNaN(amount) || isNaN(x) || isNaN(y)) {
            return { ok: false, error: 'S requires numeric amount, x, y', code: 'INVALID_ARGUMENT' };
          }
          const client = cdp.getClient(tabId);
          const deltaX = direction === 'left' ? -100 * amount : direction === 'right' ? 100 * amount : 0;
          const deltaY = direction === 'up' ? -100 * amount : direction === 'down' ? 100 * amount : 0;
          await client.Input.dispatchMouseEvent({
            type: 'mouseWheel',
            x,
            y,
            deltaX,
            deltaY,
          });
          break;
        }

        case 'D': {
          const parts = args.split(/\s+/);
          if (parts.length < 4) {
            return { ok: false, error: 'D requires 4 coordinates (x1 y1 x2 y2)', code: 'INVALID_ARGUMENT' };
          }
          const [x1s, y1s, x2s, y2s] = parts;
          const x1 = parseInt(x1s, 10);
          const y1 = parseInt(y1s, 10);
          const x2 = parseInt(x2s, 10);
          const y2 = parseInt(y2s, 10);
          if ([x1, y1, x2, y2].some(isNaN)) {
            return { ok: false, error: 'D requires numeric coordinates', code: 'INVALID_ARGUMENT' };
          }
          const client2 = cdp.getClient(tabId);
          await client2.Input.dispatchMouseEvent({ type: 'mouseMoved', x: x1, y: y1 });
          await client2.Input.dispatchMouseEvent({ type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 });
          await client2.Input.dispatchMouseEvent({ type: 'mouseMoved', x: x2, y: y2 });
          await client2.Input.dispatchMouseEvent({ type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 });
          break;
        }

        case 'Z': {
          const parts = args.split(/\s+/);
          if (parts.length < 4) {
            return { ok: false, error: 'Z requires 4 coordinates (x1 y1 x2 y2)', code: 'INVALID_ARGUMENT' };
          }
          const [x1s, y1s, x2s, y2s] = parts;
          const region = `${x1s},${y1s},${x2s},${y2s}`;
          const zoomResult = await handleScreenshot(cdp, config, {
            tab: tabId,
            region,
          });
          results.push({ command: 'Z', screenshot: zoomResult.screenshot });
          break;
        }

        case 'N': {
          if (!args) {
            return { ok: false, error: 'N requires URL argument', code: 'INVALID_ARGUMENT' };
          }
          await handleNavigate(cdp, config, {
            tab: tabId,
            url: args,
            noScreenshot: true,
          });
          break;
        }

        case 'J': {
          if (!args) {
            return { ok: false, error: 'J requires expression argument', code: 'INVALID_ARGUMENT' };
          }
          const client3 = cdp.getClient(tabId);
          const evalResult = await client3.Runtime.evaluate({
            expression: args,
            returnByValue: true,
            awaitPromise: true,
          });
          if (evalResult.exceptionDetails) {
            results.push({
              command: 'J',
              error: evalResult.exceptionDetails.text || 'JS error',
            });
          } else {
            // Post-exec URL check
            const needsUrlCheck = !(config.allowedUrls.length === 1 && config.allowedUrls[0] === '*' && config.blockedUrls.length === 0);
            if (needsUrlCheck) {
              const jPage = await cdp.getPageInfo(tabId);
              if (!checkUrlPolicy(jPage.url, config.allowedUrls, config.blockedUrls)) {
                audit('js', { expression: args.substring(0, 200), urlAfter: jPage.url, blocked: true, source: 'quick' });
                const jClient = cdp.getClient(tabId);
                await jClient.Page.navigate({ url: 'about:blank' });
                return {
                  ok: false,
                  error: `JS execution navigated to blocked URL: ${jPage.url}`,
                  code: 'URL_BLOCKED',
                };
              }
            }
            results.push({
              command: 'J',
              result: evalResult.result?.value,
            });
          }
          break;
        }

        case 'W': {
          // Wait for page to settle (short pause + check network)
          await new Promise((resolve) => setTimeout(resolve, 500));
          break;
        }

        case 'ST': {
          if (!args) {
            return { ok: false, error: 'ST requires tab ID argument', code: 'INVALID_ARGUMENT' };
          }
          await handleSwitchTab(cdp, config, {
            tabId: args.trim(),
            noScreenshot: true,
          });
          break;
        }

        case 'NT': {
          const newTabResult = await handleNewTab(cdp, config, { url: args || undefined });
          results.push({ command: 'NT', tabId: newTabResult.tabId, url: newTabResult.url });
          break;
        }

        case 'LT': {
          const tabsResult = await handleListTabs(cdp);
          results.push({ command: 'LT', tabs: tabsResult.tabs, activeTab: tabsResult.activeTab });
          break;
        }

        case 'CR': {
          if (!args) {
            return { ok: false, error: 'CR requires ref_id argument', code: 'INVALID_ARGUMENT' };
          }
          await handleClick(cdp, config, {
            tab: tabId,
            ref: args.trim(),
            noScreenshot: true,
          });
          break;
        }

        case 'FR': {
          if (!args) {
            return { ok: false, error: 'FR requires ref_id and value arguments', code: 'INVALID_ARGUMENT' };
          }
          const spaceIdx = args.indexOf(' ');
          if (spaceIdx === -1) {
            return { ok: false, error: 'FR requires ref_id and value (FR ref_id value)', code: 'INVALID_ARGUMENT' };
          }
          const frRef = args.substring(0, spaceIdx).trim();
          const frValue = args.substring(spaceIdx + 1).trim();
          await handleFormInput(cdp, config, {
            tab: tabId,
            ref: frRef,
            value: frValue,
            noScreenshot: true,
          });
          break;
        }

        case 'R': {
          const rParams: Record<string, unknown> = { tab: tabId };
          // Parse --search, --filter, --scope, --limit flags
          const rArgs = args;
          const searchMatch = rArgs.match(/--search\s+(\S+)/);
          if (searchMatch) rParams.search = searchMatch[1];
          const filterMatch = rArgs.match(/--filter\s+(\S+)/);
          if (filterMatch) rParams.filter = filterMatch[1];
          const scopeMatch = rArgs.match(/--scope\s+(\S+)/);
          if (scopeMatch) rParams.scope = scopeMatch[1];
          const limitMatch = rArgs.match(/--limit\s+(\d+)/);
          if (limitMatch) rParams.limit = parseInt(limitMatch[1], 10);
          const readResult = await handleReadPage(cdp, rParams);
          results.push({ command: 'R', tree: readResult.tree, refCount: readResult.refCount });
          break;
        }

        case 'WF': {
          if (!args) {
            return { ok: false, error: 'WF requires a condition flag (--selector, --text, --js)', code: 'INVALID_ARGUMENT' };
          }
          const wfParams: Record<string, unknown> = { tab: tabId, noScreenshot: true };
          const selectorMatch = args.match(/--selector\s+(\S+)/);
          if (selectorMatch) wfParams.selector = selectorMatch[1];
          const textMatch = args.match(/--text\s+"([^"]+)"/);
          if (textMatch) wfParams.text = textMatch[1];
          else {
            const textMatch2 = args.match(/--text\s+(\S+)/);
            if (textMatch2) wfParams.text = textMatch2[1];
          }
          const jsMatch = args.match(/--js\s+"([^"]+)"/);
          if (jsMatch) wfParams.js = jsMatch[1];
          else {
            const jsMatch2 = args.match(/--js\s+(\S+)/);
            if (jsMatch2) wfParams.js = jsMatch2[1];
          }
          const timeoutMatch = args.match(/--timeout\s+(\d+)/);
          if (timeoutMatch) wfParams.timeout = parseInt(timeoutMatch[1], 10);
          const wfResult = await handleWaitFor(cdp, config, wfParams as any);
          results.push({ command: 'WF', matched: wfResult.ok });
          break;
        }

        default:
          return { ok: false, error: `Unknown command "${cmd}"`, code: 'INVALID_ARGUMENT' };
      }
    } catch (err: any) {
      return {
        ok: false,
        error: `Quick mode command "${cmd} ${args}" failed: ${err?.message || 'Unknown error'}`,
        code: 'CDP_ERROR',
      };
    }
  }

  // Take final screenshot
  const page = await cdp.getPageInfo(tabId);
  const { ok: _ok, ...screenshotData } = await handleScreenshot(cdp, config, {
    tab: tabId,
    noScreenshot: params.noScreenshot,
  });

  return {
    ok: true,
    ...screenshotData,
    page,
    results: results.length > 0 ? results : undefined,
  };
}
