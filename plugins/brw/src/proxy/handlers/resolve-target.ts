import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

export interface TargetParams {
  ref?: string;
  selector?: string;
  text?: string;
  label?: string;
  x?: number;
  y?: number;
  tab?: string;
  wait?: number;
  frame?: string;
}

export interface ResolvedTarget {
  x: number;
  y: number;
  ref?: string;
}

// JS injected into the page to find an interactive element by visible text
const FIND_BY_TEXT_SCRIPT = `(function(searchText) {
  function getAccessibleName(el) {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.getAttribute('aria-labelledby')) {
      const labelEl = document.getElementById(el.getAttribute('aria-labelledby'));
      if (labelEl) return labelEl.textContent?.trim() || '';
    }
    if (el.placeholder) return el.placeholder;
    if (el.title) return el.title;
    if (el.alt) return el.alt;
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (label) return label.textContent?.trim() || '';
    }
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'label', 'legend', 'caption', 'figcaption', 'summary', 'option'].includes(tag)) {
      return el.innerText?.trim().substring(0, 200) || '';
    }
    const elRole = el.getAttribute('role');
    if (elRole && ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'tab', 'option', 'treeitem', 'switch', 'combobox', 'textbox'].includes(elRole)) {
      const text = el.innerText?.trim().substring(0, 200);
      if (text) return text;
    }
    for (const child of el.children) {
      const childLabel = child.getAttribute && child.getAttribute('aria-label');
      if (childLabel) return childLabel;
    }
    return '';
  }

  function isInteractive(el) {
    const tag = el.tagName.toLowerCase();
    if (['input', 'button', 'select', 'textarea', 'a', 'summary', 'details'].includes(tag)) return true;
    if (el.getAttribute('role') && ['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'switch', 'slider', 'spinbutton', 'combobox', 'textbox', 'listbox', 'option', 'menuitemcheckbox', 'menuitemradio', 'treeitem'].includes(el.getAttribute('role'))) return true;
    if (el.tabIndex >= 0) return true;
    if (el.onclick || el.getAttribute('onclick')) return true;
    if (el.contentEditable === 'true') return true;
    return false;
  }

  function isVisible(el) {
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }

  const lower = searchText.toLowerCase();
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (!isInteractive(el) || !isVisible(el)) continue;
    const name = getAccessibleName(el);
    if (name && name.toLowerCase().includes(lower)) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      // Register in element map
      if (!window.__brwElementMap) {
        window.__brwElementMap = new Map();
        window.__brwRefCounter = 0;
      }
      // Check if already has a ref
      let refId = null;
      for (const [id, ref] of window.__brwElementMap) {
        const target = ref.deref();
        if (target === undefined) { window.__brwElementMap.delete(id); continue; }
        if (target === el) { refId = id; break; }
      }
      if (!refId) {
        window.__brwRefCounter++;
        refId = 'ref_' + window.__brwRefCounter;
        window.__brwElementMap.set(refId, new WeakRef(el));
      }
      return JSON.stringify({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        ref: refId,
      });
    }
  }
  return null;
})`;

// JS injected into the page to find a form input by label text
const FIND_BY_LABEL_SCRIPT = `(function(searchLabel) {
  function isVisible(el) {
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }

  function registerRef(el) {
    if (!window.__brwElementMap) {
      window.__brwElementMap = new Map();
      window.__brwRefCounter = 0;
    }
    for (const [id, ref] of window.__brwElementMap) {
      const target = ref.deref();
      if (target === undefined) { window.__brwElementMap.delete(id); continue; }
      if (target === el) return id;
    }
    window.__brwRefCounter++;
    const id = 'ref_' + window.__brwRefCounter;
    window.__brwElementMap.set(id, new WeakRef(el));
    return id;
  }

  const lower = searchLabel.toLowerCase();

  // 1. Search <label> elements by text content
  const labels = document.querySelectorAll('label');
  for (const label of labels) {
    const labelText = label.textContent?.trim() || '';
    if (labelText.toLowerCase().includes(lower)) {
      let input = null;
      if (label.htmlFor) {
        input = document.getElementById(label.htmlFor);
      }
      if (!input) {
        input = label.querySelector('input, select, textarea');
      }
      if (input && isVisible(input)) {
        const rect = input.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        return JSON.stringify({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          ref: registerRef(input),
        });
      }
    }
  }

  // 2. Fallback: search inputs by aria-label, aria-labelledby, placeholder, title
  const inputs = document.querySelectorAll('input, select, textarea, [contenteditable="true"]');
  for (const el of inputs) {
    if (!isVisible(el)) continue;
    const names = [
      el.getAttribute('aria-label'),
      el.placeholder,
      el.title,
    ].filter(Boolean);
    // aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) names.push(labelEl.textContent?.trim() || '');
    }
    for (const name of names) {
      if (name && name.toLowerCase().includes(lower)) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        return JSON.stringify({
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          ref: registerRef(el),
        });
      }
    }
  }

  return null;
})`;

async function pollForElement(
  cdp: CDPManager,
  script: string,
  searchArg: string,
  tabId: string | undefined,
  timeoutSec: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutSec * 1000;
  const client = cdp.getClient(tabId);
  while (Date.now() < deadline) {
    const result = await client.Runtime.evaluate({
      expression: `${script}(${JSON.stringify(searchArg)})`,
      returnByValue: true,
    });
    if (result.result?.value) return result.result.value;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/**
 * Resolve target to center coordinates. Used by click, hover, drag.
 * Priority: ref > selector > text > label > x,y > error
 */
export async function resolveTargetCoords(
  cdp: CDPManager,
  params: TargetParams,
): Promise<ApiResponse & { target?: ResolvedTarget }> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  // --- ref ---
  if (params.ref) {
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        const el = window.__brwElementMap?.get(${JSON.stringify(params.ref)})?.deref();
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return JSON.stringify({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2});
      })()`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `Ref ${params.ref} not found`, code: 'REF_NOT_FOUND', hint: 'Refs expire after navigation or DOM mutations. Run "brw read-page" to get fresh refs.' };
    }
    const coords = JSON.parse(result.result.value);
    return { ok: true, target: { x: coords.x, y: coords.y, ref: params.ref } };
  }

  // --- selector ---
  if (params.selector) {
    if (params.wait) {
      const timeout = Math.max(1, Math.min(params.wait, 30));
      const deadline = Date.now() + timeout * 1000;
      while (Date.now() < deadline) {
        const result = await client.Runtime.evaluate({
          expression: `(function() {
            const el = document.querySelector(${JSON.stringify(params.selector)});
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return JSON.stringify({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2});
          })()`,
          returnByValue: true,
        });
        if (result.result?.value) {
          const coords = JSON.parse(result.result.value);
          return { ok: true, target: { x: coords.x, y: coords.y } };
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: false, error: `Selector "${params.selector}" not found within ${timeout}s`, code: 'TIMEOUT' };
    }
    const result = await client.Runtime.evaluate({
      expression: `(function() {
        const el = document.querySelector(${JSON.stringify(params.selector)});
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return JSON.stringify({x: rect.x + rect.width / 2, y: rect.y + rect.height / 2});
      })()`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `Selector "${params.selector}" not found`, code: 'SELECTOR_NOT_FOUND' };
    }
    const coords = JSON.parse(result.result.value);
    return { ok: true, target: { x: coords.x, y: coords.y } };
  }

  // --- text ---
  if (params.text) {
    if (!params.text.trim()) {
      return { ok: false, error: '--text requires a non-empty string', code: 'INVALID_ARGUMENT' };
    }
    if (params.wait) {
      const timeout = Math.max(1, Math.min(params.wait, 30));
      const value = await pollForElement(cdp, FIND_BY_TEXT_SCRIPT, params.text, tabId, timeout);
      if (!value) {
        return { ok: false, error: `No interactive element matched --text "${params.text}" within ${timeout}s`, code: 'TIMEOUT' };
      }
      const data = JSON.parse(value);
      return { ok: true, target: { x: data.x, y: data.y, ref: data.ref } };
    }
    const result = await client.Runtime.evaluate({
      expression: `${FIND_BY_TEXT_SCRIPT}(${JSON.stringify(params.text)})`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `No interactive element matched --text "${params.text}"`, code: 'TEXT_NOT_FOUND', hint: 'Try "brw read-page --search <text>" to find elements.' };
    }
    const data = JSON.parse(result.result.value);
    return { ok: true, target: { x: data.x, y: data.y, ref: data.ref } };
  }

  // --- label ---
  if (params.label) {
    if (!params.label.trim()) {
      return { ok: false, error: '--label requires a non-empty string', code: 'INVALID_ARGUMENT' };
    }
    if (params.wait) {
      const timeout = Math.max(1, Math.min(params.wait, 30));
      const value = await pollForElement(cdp, FIND_BY_LABEL_SCRIPT, params.label, tabId, timeout);
      if (!value) {
        return { ok: false, error: `No form input matched --label "${params.label}" within ${timeout}s`, code: 'TIMEOUT' };
      }
      const data = JSON.parse(value);
      return { ok: true, target: { x: data.x, y: data.y, ref: data.ref } };
    }
    const result = await client.Runtime.evaluate({
      expression: `${FIND_BY_LABEL_SCRIPT}(${JSON.stringify(params.label)})`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `No form input matched --label "${params.label}"`, code: 'LABEL_NOT_FOUND', hint: 'Try "brw read-page --filter interactive --search <text>".' };
    }
    const data = JSON.parse(result.result.value);
    return { ok: true, target: { x: data.x, y: data.y, ref: data.ref } };
  }

  // --- x,y coordinates ---
  if (params.x !== undefined && params.y !== undefined) {
    return { ok: true, target: { x: params.x, y: params.y } };
  }

  return { ok: false, error: 'Must specify --ref, --selector, --text, --label, or x,y coordinates', code: 'INVALID_ARGUMENT' };
}

/**
 * Resolve target to an element expression string. Used by form-input.
 * Returns a JS expression that resolves to the DOM element.
 */
export async function resolveTargetElement(
  cdp: CDPManager,
  params: TargetParams,
): Promise<ApiResponse & { resolveExpr?: string }> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  // --- ref ---
  if (params.ref) {
    return { ok: true, resolveExpr: `window.__brwElementMap?.get(${JSON.stringify(params.ref)})?.deref()` };
  }

  // --- selector ---
  if (params.selector) {
    if (params.wait) {
      const timeout = Math.max(1, Math.min(params.wait, 30));
      const deadline = Date.now() + timeout * 1000;
      while (Date.now() < deadline) {
        const result = await client.Runtime.evaluate({
          expression: `!!document.querySelector(${JSON.stringify(params.selector)})`,
          returnByValue: true,
        });
        if (result.result?.value === true) {
          return { ok: true, resolveExpr: `document.querySelector(${JSON.stringify(params.selector)})` };
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return { ok: false, error: `Selector "${params.selector}" not found within ${timeout}s`, code: 'TIMEOUT' };
    }
    return { ok: true, resolveExpr: `document.querySelector(${JSON.stringify(params.selector)})` };
  }

  // --- text / label: resolve to a ref, then return ref expression ---
  if (params.text || params.label) {
    const script = params.text ? FIND_BY_TEXT_SCRIPT : FIND_BY_LABEL_SCRIPT;
    const searchArg = (params.text || params.label)!;
    const notFoundCode = params.text ? 'TEXT_NOT_FOUND' : 'LABEL_NOT_FOUND';
    const notFoundHint = params.text
      ? 'Try "brw read-page --search <text>" to find elements.'
      : 'Try "brw read-page --filter interactive --search <text>".';

    if (!searchArg.trim()) {
      return { ok: false, error: `--${params.text ? 'text' : 'label'} requires a non-empty string`, code: 'INVALID_ARGUMENT' };
    }

    if (params.wait) {
      const timeout = Math.max(1, Math.min(params.wait, 30));
      const value = await pollForElement(cdp, script, searchArg, tabId, timeout);
      if (!value) {
        return { ok: false, error: `No element matched --${params.text ? 'text' : 'label'} "${searchArg}" within ${timeout}s`, code: 'TIMEOUT' };
      }
      const data = JSON.parse(value);
      return { ok: true, resolveExpr: `window.__brwElementMap?.get(${JSON.stringify(data.ref)})?.deref()` };
    }

    const result = await client.Runtime.evaluate({
      expression: `${script}(${JSON.stringify(searchArg)})`,
      returnByValue: true,
    });
    if (!result.result?.value) {
      return { ok: false, error: `No element matched --${params.text ? 'text' : 'label'} "${searchArg}"`, code: notFoundCode, hint: notFoundHint };
    }
    const data = JSON.parse(result.result.value);
    return { ok: true, resolveExpr: `window.__brwElementMap?.get(${JSON.stringify(data.ref)})?.deref()` };
  }

  return { ok: false, error: 'Must specify --ref, --selector, --text, or --label', code: 'INVALID_ARGUMENT' };
}
