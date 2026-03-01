import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse, ActionStep } from '../../shared/types.js';
import { ErrorCode } from '../../shared/types.js';
import { getProfile, readProfileScript, substituteStep } from '../../shared/profiles.js';
import { handleScreenshot } from './screenshot.js';
import { handleClick } from './click.js';
import { handleType } from './type.js';
import { handleKey } from './key.js';
import { handleNavigate } from './navigate.js';
import { handleFormInput } from './form-input.js';
import { handleWait } from './wait.js';
import { handleWaitFor } from './wait-for.js';
import { handleScroll, handleScrollTo } from './scroll.js';
import { handleHover } from './hover.js';
import { handleReadPage } from './read-page.js';
import { handleJs } from './js.js';

export async function handleRunAction(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    target: string;
    params?: Record<string, string>;
    tab?: string;
    noScreenshot?: boolean;
    cwd?: string;
  }
): Promise<ApiResponse> {
  // Parse profile:action target
  const colonIdx = params.target.indexOf(':');
  if (colonIdx === -1) {
    return {
      ok: false,
      error: `Invalid target "${params.target}". Expected format: profile:action`,
      code: ErrorCode.INVALID_ARGUMENT,
    };
  }

  const profileName = params.target.substring(0, colonIdx);
  const actionName = params.target.substring(colonIdx + 1);

  // Resolve profile
  const profile = getProfile(profileName, params.cwd);
  if (!profile) {
    return {
      ok: false,
      error: `Profile "${profileName}" not found`,
      code: ErrorCode.PROFILE_NOT_FOUND,
      hint: 'Use "brw profile list" to see available profiles.',
    };
  }

  // Look up action
  const actionDef = profile.manifest.actions[actionName];
  if (!actionDef) {
    const available = Object.keys(profile.manifest.actions).join(', ');
    return {
      ok: false,
      error: `Action "${actionName}" not found in profile "${profileName}"`,
      code: ErrorCode.INVALID_ARGUMENT,
      hint: `Available actions: ${available}`,
    };
  }

  // Validate required params
  const actionParams = params.params || {};
  if (actionDef.params) {
    for (const paramName of Object.keys(actionDef.params)) {
      if (actionParams[paramName] === undefined) {
        return {
          ok: false,
          error: `Missing required parameter "${paramName}" for action "${actionName}"`,
          code: ErrorCode.INVALID_ARGUMENT,
          hint: `Required params: ${Object.entries(actionDef.params).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
        };
      }
    }
  }

  const selectors = profile.manifest.selectors || {};
  const tabId = params.tab;
  const stepResults: Array<{ step: number; action: string; data?: unknown }> = [];
  let lastData: unknown = undefined;

  // Execute steps sequentially (fail-fast)
  for (let i = 0; i < actionDef.steps.length; i++) {
    const rawStep = actionDef.steps[i];
    const step = substituteStep(rawStep as unknown as Record<string, unknown>, actionParams, selectors) as unknown as ActionStep;

    try {
      const result = await executeStep(cdp, config, profile.dir, step, tabId);
      if (!result.ok) {
        return {
          ...result,
          profile: profileName,
          action: actionName,
          failedStep: i,
        };
      }
      if (result.data !== undefined) {
        lastData = result.data;
        stepResults.push({ step: i, action: step.action, data: result.data });
      }
    } catch (err: any) {
      return {
        ok: false,
        error: `Step ${i} (${step.action}) failed: ${err?.message || 'Unknown error'}`,
        code: ErrorCode.CDP_ERROR,
        profile: profileName,
        action: actionName,
        failedStep: i,
      };
    }
  }

  // Determine noScreenshot: action definition OR CLI override
  const skipScreenshot = actionDef.noScreenshot || params.noScreenshot;

  // Final screenshot
  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, {
    tab: tabId,
    noScreenshot: skipScreenshot,
  });

  return {
    ok: true,
    screenshot: screenshotResult.screenshot,
    page,
    profile: profileName,
    action: actionName,
    data: lastData,
    stepResults: stepResults.length > 0 ? stepResults : undefined,
  };
}

async function executeStep(
  cdp: CDPManager,
  config: BrwConfig,
  profileDir: string,
  step: ActionStep,
  tabId?: string
): Promise<ApiResponse & { data?: unknown }> {
  switch (step.action) {
    case 'js': {
      if (step.file) {
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const filepath = join(profileDir, step.file);
        if (!existsSync(filepath)) {
          return {
            ok: false,
            error: `Script file "${step.file}" not found in profile directory`,
            code: ErrorCode.FILE_NOT_FOUND,
          };
        }
        const scriptContent = readFileSync(filepath, 'utf-8');

        // Collect all step properties as params for the IIFE
        const jsParams: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(step)) {
          if (key !== 'action' && key !== 'file' && key !== 'frame') {
            jsParams[key] = value;
          }
        }

        const expression = `(${scriptContent})(${JSON.stringify(jsParams)})`;
        const client = cdp.getClient(tabId);

        const evalOptions: any = {
          expression,
          returnByValue: true,
          awaitPromise: true,
          timeout: 30000,
        };

        if (step.frame) {
          const contextId = await cdp.resolveFrameContext(step.frame, tabId);
          if (contextId === null) {
            return { ok: false, error: `Frame "${step.frame}" not found`, code: ErrorCode.FRAME_NOT_FOUND };
          }
          evalOptions.contextId = contextId;
        }

        const result = await client.Runtime.evaluate(evalOptions);

        if (result.exceptionDetails) {
          const errorText =
            result.exceptionDetails.exception?.description ||
            result.exceptionDetails.text ||
            'JavaScript evaluation error';
          return { ok: false, error: errorText, code: ErrorCode.JS_ERROR };
        }

        const resultValue = result.result?.value ?? result.result?.description ?? null;
        return { ok: true, data: resultValue };
      }

      // Inline JS expression
      if (step.expression) {
        const jsResult = await handleJs(cdp, {
          expression: step.expression,
          tab: tabId,
          frame: step.frame,
        });
        if (!jsResult.ok) return jsResult;
        return { ok: true, data: jsResult.result };
      }

      return { ok: false, error: 'JS step requires "file" or "expression"', code: ErrorCode.INVALID_ARGUMENT };
    }

    case 'click': {
      return await handleClick(cdp, config, {
        tab: tabId,
        selector: step.selector,
        ref: step.ref,
        x: step.x as number | undefined,
        y: step.y as number | undefined,
        right: step.right as boolean | undefined,
        double: step.double as boolean | undefined,
        triple: step.triple as boolean | undefined,
        modifiers: step.modifiers as string | undefined,
        noScreenshot: true,
      });
    }

    case 'type': {
      const text = step.text || step.value || '';
      return await handleType(cdp, config, {
        tab: tabId,
        text,
        clear: step.clear as boolean | undefined,
        noScreenshot: true,
      });
    }

    case 'key': {
      const keys = step.keys || '';
      return await handleKey(cdp, config, {
        tab: tabId,
        keys,
        repeat: step.repeat as number | undefined,
        noScreenshot: true,
      });
    }

    case 'form-input': {
      return await handleFormInput(cdp, config, {
        tab: tabId,
        selector: step.selector,
        ref: step.ref,
        value: (step.value || '') as string,
        frame: step.frame,
        noScreenshot: true,
      });
    }

    case 'navigate': {
      return await handleNavigate(cdp, config, {
        tab: tabId,
        url: step.url || '',
        wait: step.wait as string | undefined,
        noScreenshot: true,
      });
    }

    case 'wait': {
      return await handleWait(cdp, config, {
        tab: tabId,
        duration: step.duration || 2,
        noScreenshot: true,
      });
    }

    case 'wait-for': {
      return await handleWaitFor(cdp, config, {
        tab: tabId,
        selector: step.selector,
        text: step.text,
        url: step.url,
        js: step.js as string | undefined,
        timeout: step.timeout || 10,
        noScreenshot: true,
      });
    }

    case 'scroll': {
      return await handleScroll(cdp, config, {
        tab: tabId,
        direction: step.direction || 'down',
        amount: step.amount,
        noScreenshot: true,
      });
    }

    case 'scroll-to': {
      return await handleScrollTo(cdp, config, {
        tab: tabId,
        selector: step.selector,
        ref: step.ref,
        noScreenshot: true,
      });
    }

    case 'hover': {
      return await handleHover(cdp, config, {
        tab: tabId,
        selector: step.selector,
        ref: step.ref,
        x: step.x as number | undefined,
        y: step.y as number | undefined,
        noScreenshot: true,
      });
    }

    case 'screenshot': {
      return await handleScreenshot(cdp, config, {
        tab: tabId,
        ref: step.ref,
        region: step.region as string | undefined,
        fullPage: step.fullPage as boolean | undefined,
      });
    }

    case 'read-page': {
      return await handleReadPage(cdp, {
        tab: tabId,
        filter: step.filter,
        search: step.search as string | undefined,
        ref: step.ref,
        depth: step.depth as number | undefined,
        scope: step.scope as string | undefined,
        frame: step.frame,
      });
    }

    default:
      return {
        ok: false,
        error: `Unknown step action "${step.action}"`,
        code: ErrorCode.INVALID_ARGUMENT,
      };
  }
}
