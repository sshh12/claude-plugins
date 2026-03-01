import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PNG } from 'pngjs';
import { platform } from 'os';
import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';

export async function handleScreenshot(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    tab?: string;
    region?: string;
    ref?: string;
    fullPage?: boolean;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  if (params.noScreenshot) {
    return { ok: true };
  }

  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;

  // Handle --ref: resolve element bounding box
  if (params.ref) {
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        const el = window.__brwElementMap?.get(${JSON.stringify(params.ref)})?.deref();
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return JSON.stringify({x: rect.x, y: rect.y, width: rect.width, height: rect.height});
      })()`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `Ref ${params.ref} not found`, code: 'REF_NOT_FOUND' };
    }
    const rect = JSON.parse(result.result.value);
    clip = { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 1 };
  }

  // Handle --region: parse x1,y1,x2,y2
  if (params.region) {
    const parts = params.region.split(',').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return { ok: false, error: 'Invalid region format. Use: x1,y1,x2,y2', code: 'INVALID_ARGUMENT' };
    }
    const [x1, y1, x2, y2] = parts;
    clip = { x: x1, y: y1, width: x2 - x1, height: y2 - y1, scale: 1 };
  }

  // Handle --full-page: get full document dimensions
  let captureBeyondViewport = false;
  if (params.fullPage) {
    const dims = await client.Runtime.evaluate({
      expression:
        'JSON.stringify({width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight})',
      returnByValue: true,
    });
    const { width, height } = JSON.parse(dims.result?.value || '{}');
    clip = { x: 0, y: 0, width, height, scale: 1 };
    captureBeyondViewport = true;
  }

  // Capture screenshot
  const screenshotParams: any = {
    format: 'png',
    captureBeyondViewport,
  };
  if (clip) {
    screenshotParams.clip = clip;
  }

  const { data } = await client.Page.captureScreenshot(screenshotParams);
  const rawBuffer = Buffer.from(data, 'base64');

  // Resize if needed: max 1568px on longest side
  const imgBuffer = resizeIfNeeded(rawBuffer as Buffer, 1568);

  // Save to disk
  mkdirSync(config.screenshotDir, { recursive: true, mode: platform() === 'linux' ? 0o700 : undefined });
  const filename = `${Date.now()}.png`;
  const filepath = join(config.screenshotDir, filename);
  writeFileSync(filepath, imgBuffer, { mode: platform() === 'linux' ? 0o600 : undefined });

  return { ok: true, screenshot: filepath };
}

/**
 * Resize a PNG buffer so its longest side is at most maxDim pixels.
 * Uses nearest-neighbor for speed (pure JS, no native deps).
 */
function resizeIfNeeded(pngBuffer: Buffer, maxDim: number): Buffer {
  const png = PNG.sync.read(pngBuffer);
  const { width, height } = png;

  if (width <= maxDim && height <= maxDim) {
    return pngBuffer;
  }

  const scale = maxDim / Math.max(width, height);
  const newWidth = Math.round(width * scale);
  const newHeight = Math.round(height * scale);

  const resized = new PNG({ width: newWidth, height: newHeight });

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.min(Math.floor(x / scale), width - 1);
      const srcY = Math.min(Math.floor(y / scale), height - 1);
      const srcIdx = (srcY * width + srcX) * 4;
      const dstIdx = (y * newWidth + x) * 4;
      resized.data[dstIdx] = png.data[srcIdx];
      resized.data[dstIdx + 1] = png.data[srcIdx + 1];
      resized.data[dstIdx + 2] = png.data[srcIdx + 2];
      resized.data[dstIdx + 3] = png.data[srcIdx + 3];
    }
  }

  return PNG.sync.write(resized);
}
