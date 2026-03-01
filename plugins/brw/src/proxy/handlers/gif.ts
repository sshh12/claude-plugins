import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { PNG } from 'pngjs';
import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';

interface GifFrame {
  screenshot: Buffer;
  action: string;
  coordinates?: [number, number];
  timestamp: number;
}

interface GifRecording {
  frames: GifFrame[];
  maxFrames: number;
  active: boolean;
}

// Per-tab GIF recordings
const recordings = new Map<string, GifRecording>();

export function getRecording(tabId: string): GifRecording | undefined {
  return recordings.get(tabId);
}

export function isRecording(tabId: string): boolean {
  return recordings.get(tabId)?.active === true;
}

/**
 * Called by mutation handlers to add a frame after an action.
 */
export function addFrame(tabId: string, screenshot: Buffer, action: string, coordinates?: [number, number]): void {
  const recording = recordings.get(tabId);
  if (!recording || !recording.active) return;

  recording.frames.push({
    screenshot,
    action,
    coordinates,
    timestamp: Date.now(),
  });

  if (recording.frames.length >= recording.maxFrames) {
    recording.active = false;
  }
}

export async function handleGifStart(
  cdp: CDPManager,
  params: {
    tab?: string;
    maxFrames?: number;
  }
): Promise<ApiResponse> {
  const tabId = params.tab || cdp.getActiveTabId() || '';
  const maxFrames = params.maxFrames || 200;

  recordings.set(tabId, {
    frames: [],
    maxFrames,
    active: true,
  });

  return { ok: true, recording: true };
}

export async function handleGifStop(
  cdp: CDPManager,
  params: {
    tab?: string;
  }
): Promise<ApiResponse> {
  const tabId = params.tab || cdp.getActiveTabId() || '';
  const recording = recordings.get(tabId);

  if (!recording) {
    return { ok: true, recording: false, frames: 0 };
  }

  recording.active = false;

  return { ok: true, recording: false, frames: recording.frames.length };
}

export async function handleGifExport(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    tab?: string;
    output?: string;
    quality?: number;
    showClicks?: boolean;
    showDrags?: boolean;
    showLabels?: boolean;
    showProgress?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab || cdp.getActiveTabId() || '';
  const recording = recordings.get(tabId);

  if (!recording || recording.frames.length === 0) {
    return {
      ok: false,
      error: 'No frames to export. Start a recording with "brw gif start" first.',
      code: 'INVALID_ARGUMENT',
    };
  }

  const quality = params.quality || 10;
  const showClicks = params.showClicks !== false;
  const showDrags = params.showDrags !== false;
  const showLabels = params.showLabels === true;
  const showProgress = params.showProgress === true;

  // Determine output path
  const outputDir = config.screenshotDir;
  mkdirSync(outputDir, { recursive: true });
  const outputPath = params.output || join(outputDir, `${Date.now()}.gif`);

  try {
    // Decode first frame to get dimensions
    const firstPng = PNG.sync.read(recording.frames[0].screenshot);
    const width = firstPng.width;
    const height = firstPng.height;

    const gif = GIFEncoder();

    for (let i = 0; i < recording.frames.length; i++) {
      const frame = recording.frames[i];
      const png = PNG.sync.read(frame.screenshot);

      // Convert RGBA to RGB for gifenc
      const rgbaData = new Uint8Array(png.data);

      // Apply click indicator if enabled
      if (showClicks && frame.coordinates) {
        drawCircle(rgbaData, width, height, frame.coordinates[0], frame.coordinates[1], 8, [255, 0, 0, 255]);
      }

      // Apply drag path if enabled
      if (showDrags && frame.action.startsWith('drag') && frame.coordinates) {
        // For drag, coordinates represent end point; we'd need start too
        // For now, just mark the endpoint
        drawCircle(rgbaData, width, height, frame.coordinates[0], frame.coordinates[1], 6, [0, 0, 255, 255]);
      }

      // Render action label overlay
      if (showLabels && frame.action) {
        const labelText = frame.coordinates
          ? `${frame.action} ${frame.coordinates[0]},${frame.coordinates[1]}`
          : frame.action;
        renderLabel(rgbaData, width, height, labelText);
      }

      // Render progress bar overlay
      if (showProgress) {
        renderProgressBar(rgbaData, width, height, i, recording.frames.length);
      }

      // Calculate frame delay from timestamps
      let delay = 100; // default 100ms
      if (i < recording.frames.length - 1) {
        delay = Math.min(recording.frames[i + 1].timestamp - frame.timestamp, 2000); // cap at 2s
        delay = Math.max(delay, 50); // min 50ms
      }

      const palette = quantize(rgbaData, 256);
      const indexed = applyPalette(rgbaData, palette);
      gif.writeFrame(indexed, width, height, { palette, delay });
    }

    gif.finish();
    const bytes = gif.bytes();
    writeFileSync(outputPath, Buffer.from(bytes));

    return {
      ok: true,
      path: outputPath,
      frames: recording.frames.length,
      duration: recording.frames.length > 1
        ? Math.round((recording.frames[recording.frames.length - 1].timestamp - recording.frames[0].timestamp) / 1000)
        : 0,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: `GIF export failed: ${err?.message || 'Unknown error'}`,
      code: 'CDP_ERROR',
    };
  }
}

export async function handleGifClear(
  cdp: CDPManager,
  params: {
    tab?: string;
  }
): Promise<ApiResponse> {
  const tabId = params.tab || cdp.getActiveTabId() || '';
  recordings.delete(tabId);
  return { ok: true, cleared: true };
}

/**
 * Draw a filled circle on RGBA pixel data.
 */
function drawCircle(
  data: Uint8Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  color: [number, number, number, number]
): void {
  for (let y = Math.max(0, cy - radius); y < Math.min(height, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x < Math.min(width, cx + radius); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        const idx = (y * width + x) * 4;
        data[idx] = color[0];
        data[idx + 1] = color[1];
        data[idx + 2] = color[2];
        data[idx + 3] = color[3];
      }
    }
  }
}

/**
 * Draw a filled rectangle on RGBA pixel data.
 */
function drawRect(
  data: Uint8Array,
  width: number,
  height: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  color: [number, number, number, number]
): void {
  const x0 = Math.max(0, rx);
  const y0 = Math.max(0, ry);
  const x1 = Math.min(width, rx + rw);
  const y1 = Math.min(height, ry + rh);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = color[0];
      data[idx + 1] = color[1];
      data[idx + 2] = color[2];
      data[idx + 3] = color[3];
    }
  }
}

// Simple 5x7 bitmap font for basic ASCII characters (space through ~)
// Each character is a 5-wide, 7-tall bitmap stored as 7 rows of 5-bit values.
const FONT_W = 5;
const FONT_H = 7;
const FONT: Record<string, number[]> = {
  ' ': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
  'a': [0b01110, 0b00001, 0b01111, 0b10001, 0b01111, 0b00000, 0b00000],
  'b': [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b11110, 0b00000],
  'c': [0b00000, 0b01110, 0b10000, 0b10000, 0b10000, 0b01110, 0b00000],
  'd': [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b01111, 0b00000],
  'e': [0b01110, 0b10001, 0b11111, 0b10000, 0b01110, 0b00000, 0b00000],
  'f': [0b00110, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000, 0b00000],
  'g': [0b01111, 0b10001, 0b01111, 0b00001, 0b01110, 0b00000, 0b00000],
  'h': [0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b10001, 0b00000],
  'i': [0b00100, 0b00000, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000],
  'j': [0b00010, 0b00000, 0b00010, 0b00010, 0b10010, 0b01100, 0b00000],
  'k': [0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b00000],
  'l': [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110, 0b00000],
  'm': [0b00000, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001, 0b00000],
  'n': [0b00000, 0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b00000],
  'o': [0b00000, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110, 0b00000],
  'p': [0b11110, 0b10001, 0b11110, 0b10000, 0b10000, 0b00000, 0b00000],
  'q': [0b01111, 0b10001, 0b01111, 0b00001, 0b00001, 0b00000, 0b00000],
  'r': [0b00000, 0b10110, 0b11000, 0b10000, 0b10000, 0b10000, 0b00000],
  's': [0b00000, 0b01110, 0b10000, 0b01110, 0b00001, 0b11110, 0b00000],
  't': [0b01000, 0b11100, 0b01000, 0b01000, 0b01000, 0b00110, 0b00000],
  'u': [0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101, 0b00000],
  'v': [0b00000, 0b10001, 0b10001, 0b01010, 0b01010, 0b00100, 0b00000],
  'w': [0b00000, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010, 0b00000],
  'x': [0b00000, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b00000],
  'y': [0b10001, 0b10001, 0b01111, 0b00001, 0b01110, 0b00000, 0b00000],
  'z': [0b00000, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111, 0b00000],
  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  '3': [0b01110, 0b10001, 0b00001, 0b00110, 0b00001, 0b10001, 0b01110],
  '4': [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  ',': [0b00000, 0b00000, 0b00000, 0b00000, 0b00100, 0b00100, 0b01000],
  '.': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
  ':': [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000],
  '-': [0b00000, 0b00000, 0b00000, 0b11110, 0b00000, 0b00000, 0b00000],
  '_': [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111],
  '/': [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  '(': [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ')': [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  '#': [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
  '+': [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
  '=': [0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000],
};

/**
 * Draw a single character on RGBA pixel data at (px, py) with a given scale.
 */
function drawChar(
  data: Uint8Array,
  width: number,
  height: number,
  ch: string,
  px: number,
  py: number,
  scale: number,
  color: [number, number, number, number]
): void {
  const glyph = FONT[ch.toLowerCase()];
  if (!glyph) return; // skip unknown characters
  for (let row = 0; row < FONT_H; row++) {
    for (let col = 0; col < FONT_W; col++) {
      if (glyph[row] & (1 << (FONT_W - 1 - col))) {
        // Fill a scale x scale block
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = px + col * scale + sx;
            const y = py + row * scale + sy;
            if (x >= 0 && x < width && y >= 0 && y < height) {
              const idx = (y * width + x) * 4;
              data[idx] = color[0];
              data[idx + 1] = color[1];
              data[idx + 2] = color[2];
              data[idx + 3] = color[3];
            }
          }
        }
      }
    }
  }
}

/**
 * Draw a text string on RGBA pixel data. Returns the width in pixels of the rendered text.
 */
function drawText(
  data: Uint8Array,
  width: number,
  height: number,
  text: string,
  px: number,
  py: number,
  scale: number,
  fgColor: [number, number, number, number],
  bgColor?: [number, number, number, number]
): number {
  const charW = (FONT_W + 1) * scale; // 1px spacing between chars
  const textW = text.length * charW;
  const textH = FONT_H * scale;

  // Draw background bar if specified
  if (bgColor) {
    drawRect(data, width, height, px - scale, py - scale, textW + 2 * scale, textH + 2 * scale, bgColor);
  }

  // Draw each character with 1px outline effect (draw dark behind, then light on top)
  for (let i = 0; i < text.length; i++) {
    // Black outline: draw at offsets
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      drawChar(data, width, height, text[i], px + i * charW + dx * scale, py + dy * scale, scale, [0, 0, 0, 255]);
    }
    // Foreground
    drawChar(data, width, height, text[i], px + i * charW, py, scale, fgColor);
  }

  return textW;
}

/**
 * Render a label overlay at the bottom of the frame showing the action text.
 */
function renderLabel(
  data: Uint8Array,
  width: number,
  height: number,
  action: string
): void {
  const scale = 2;
  const textH = FONT_H * scale;
  const barH = textH + 4 * scale;
  const barY = height - barH;

  // Semi-transparent black bar at bottom
  drawRect(data, width, height, 0, barY, width, barH, [0, 0, 0, 200]);

  // Draw text centered vertically within the bar, left-padded
  const textY = barY + 2 * scale;
  const textX = 4 * scale;
  drawText(data, width, height, action, textX, textY, scale, [255, 255, 255, 255]);
}

/**
 * Render a thin progress bar at the very bottom of the frame.
 */
function renderProgressBar(
  data: Uint8Array,
  width: number,
  height: number,
  frameIndex: number,
  totalFrames: number
): void {
  const barH = 4; // 4px tall progress bar
  const barY = height - barH;
  const progress = totalFrames > 1 ? (frameIndex + 1) / totalFrames : 1;
  const filledW = Math.round(width * progress);

  // Background (dark gray)
  drawRect(data, width, height, 0, barY, width, barH, [60, 60, 60, 255]);

  // Filled portion (bright green)
  drawRect(data, width, height, 0, barY, filledW, barH, [0, 200, 80, 255]);
}
