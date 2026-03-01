import type { CDPManager } from '../cdp.js';
import type { BrwConfig, ApiResponse } from '../../shared/types.js';
import { handleScreenshot } from './screenshot.js';

// Map key names to CDP key info
const KEY_MAP: Record<string, { key: string; code: string; keyCode: number }> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  f1: { key: 'F1', code: 'F1', keyCode: 112 },
  f2: { key: 'F2', code: 'F2', keyCode: 113 },
  f3: { key: 'F3', code: 'F3', keyCode: 114 },
  f4: { key: 'F4', code: 'F4', keyCode: 115 },
  f5: { key: 'F5', code: 'F5', keyCode: 116 },
  f6: { key: 'F6', code: 'F6', keyCode: 117 },
  f7: { key: 'F7', code: 'F7', keyCode: 118 },
  f8: { key: 'F8', code: 'F8', keyCode: 119 },
  f9: { key: 'F9', code: 'F9', keyCode: 120 },
  f10: { key: 'F10', code: 'F10', keyCode: 121 },
  f11: { key: 'F11', code: 'F11', keyCode: 122 },
  f12: { key: 'F12', code: 'F12', keyCode: 123 },
};

const MODIFIER_KEYS = ['ctrl', 'control', 'alt', 'shift', 'meta', 'cmd', 'command'];

export async function handleKey(
  cdp: CDPManager,
  config: BrwConfig,
  params: {
    keys: string;
    tab?: string;
    repeat?: number;
    noScreenshot?: boolean;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);
  const repeatCount = params.repeat || 1;

  const parts = params.keys.toLowerCase().split('+').map((s) => s.trim());
  const modifiers = parts.filter((p) => MODIFIER_KEYS.includes(p));
  const mainKeys = parts.filter((p) => !MODIFIER_KEYS.includes(p));

  // Build modifier bitmask
  let modifierFlags = 0;
  if (modifiers.includes('alt')) modifierFlags |= 1;
  if (modifiers.includes('ctrl') || modifiers.includes('control')) modifierFlags |= 2;
  if (modifiers.includes('meta') || modifiers.includes('cmd') || modifiers.includes('command')) modifierFlags |= 4;
  if (modifiers.includes('shift')) modifierFlags |= 8;

  for (let r = 0; r < repeatCount; r++) {
    // Press modifier keys down
    for (const mod of modifiers) {
      const modKey = getModifierKeyInfo(mod);
      await client.Input.dispatchKeyEvent({
        type: 'keyDown',
        key: modKey.key,
        code: modKey.code,
        modifiers: modifierFlags,
      });
    }

    // Press main keys
    for (const keyName of mainKeys) {
      const keyInfo = KEY_MAP[keyName];
      if (keyInfo) {
        await client.Input.dispatchKeyEvent({
          type: 'keyDown',
          key: keyInfo.key,
          code: keyInfo.code,
          windowsVirtualKeyCode: keyInfo.keyCode,
          modifiers: modifierFlags,
        });
        await client.Input.dispatchKeyEvent({
          type: 'keyUp',
          key: keyInfo.key,
          code: keyInfo.code,
          windowsVirtualKeyCode: keyInfo.keyCode,
          modifiers: modifierFlags,
        });
      } else if (keyName.length === 1) {
        // Single character
        const code = `Key${keyName.toUpperCase()}`;
        const keyCode = keyName.toUpperCase().charCodeAt(0);
        await client.Input.dispatchKeyEvent({
          type: 'keyDown',
          key: keyName,
          code,
          windowsVirtualKeyCode: keyCode,
          modifiers: modifierFlags,
        });
        await client.Input.dispatchKeyEvent({
          type: 'keyUp',
          key: keyName,
          code,
          windowsVirtualKeyCode: keyCode,
          modifiers: modifierFlags,
        });
      }
    }

    // Release modifier keys
    for (const mod of modifiers.reverse()) {
      const modKey = getModifierKeyInfo(mod);
      await client.Input.dispatchKeyEvent({
        type: 'keyUp',
        key: modKey.key,
        code: modKey.code,
        modifiers: 0,
      });
    }
  }

  const page = await cdp.getPageInfo(tabId);
  const screenshotResult = await handleScreenshot(cdp, config, { tab: tabId, noScreenshot: params.noScreenshot });
  return { ok: true, screenshot: screenshotResult.screenshot, page };
}

function getModifierKeyInfo(mod: string): { key: string; code: string } {
  switch (mod) {
    case 'ctrl':
    case 'control':
      return { key: 'Control', code: 'ControlLeft' };
    case 'alt':
      return { key: 'Alt', code: 'AltLeft' };
    case 'shift':
      return { key: 'Shift', code: 'ShiftLeft' };
    case 'meta':
    case 'cmd':
    case 'command':
      return { key: 'Meta', code: 'MetaLeft' };
    default:
      return { key: mod, code: mod };
  }
}
