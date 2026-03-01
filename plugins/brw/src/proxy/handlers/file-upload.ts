import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { existsSync } from 'fs';
import { basename } from 'path';
import { handleScreenshot } from './screenshot.js';
import { checkAllowedPath } from '../../shared/config.js';
import { audit } from '../logger.js';

export async function handleFileUpload(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    tab?: string;
    ref?: string;
    files: string[];
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  if (!params.ref) {
    return { ok: false, error: 'ref is required for file-upload', code: 'INVALID_ARGUMENT' };
  }

  if (!params.files || params.files.length === 0) {
    return { ok: false, error: 'At least one file path is required', code: 'INVALID_ARGUMENT' };
  }

  // Validate file paths
  for (const filePath of params.files) {
    if (!checkAllowedPath(filePath, config.allowedPaths)) {
      return {
        ok: false,
        error: `File path ${filePath} is not in the allowed paths`,
        code: 'PATH_BLOCKED',
      };
    }
    if (!existsSync(filePath)) {
      return {
        ok: false,
        error: `File not found: ${filePath}`,
        code: 'FILE_NOT_FOUND',
      };
    }
  }

  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  // Resolve ref to a DOM node
  const evalResult = await client.Runtime.evaluate({
    expression: `(function() {
      const el = window.__brwElementMap?.get(${JSON.stringify(params.ref)})?.deref();
      if (!el) return null;
      return 'found';
    })()`,
    returnByValue: true,
  });

  if (!evalResult.result?.value) {
    return {
      ok: false,
      error: `Ref ${params.ref} not found`,
      code: 'REF_NOT_FOUND',
      hint: 'Refs expire after navigation. Run "brw read-page" to get fresh refs.',
    };
  }

  // Get the DOM node via the ref
  const nodeResult = await client.Runtime.evaluate({
    expression: `(function() {
      const el = window.__brwElementMap?.get(${JSON.stringify(params.ref)})?.deref();
      if (!el) return null;
      // Return the element as a remote object (not by value)
      return el;
    })()`,
  });

  if (!nodeResult.result?.objectId) {
    return {
      ok: false,
      error: `Could not get DOM node for ref ${params.ref}`,
      code: 'CDP_ERROR',
    };
  }

  // Describe the node to get its backend node ID
  const nodeDesc = await client.DOM.describeNode({ objectId: nodeResult.result.objectId });
  const backendNodeId = nodeDesc.node?.backendNodeId;

  if (!backendNodeId) {
    return {
      ok: false,
      error: 'Could not resolve DOM node',
      code: 'CDP_ERROR',
    };
  }

  // Set files using CDP
  await client.DOM.setFileInputFiles({
    files: params.files,
    backendNodeId,
  });

  const page = await cdp.getPageInfo(tabId);
  const { ok: _ok, ...screenshotData } = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });

  audit('file-upload', { files: params.files.map((f) => basename(f)) });

  return {
    ok: true,
    ...screenshotData,
    page,
    files: params.files.map((f) => basename(f)),
  };
}
