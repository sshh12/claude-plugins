import type { CDPManager } from '../cdp.js';
import type { ApiResponse } from '../../shared/types.js';

// Script to inject into the page to build the accessibility tree with ref IDs
const TREE_SCRIPT = `
(function(options) {
  if (!window.__brwElementMap) {
    window.__brwElementMap = new Map();
    window.__brwRefCounter = 0;
  }

  // Clean up dead WeakRefs periodically
  function cleanDeadRefs() {
    for (const [id, ref] of window.__brwElementMap) {
      if (ref.deref() === undefined) window.__brwElementMap.delete(id);
    }
  }

  function getRefId(el) {
    // Check if element already has a ref
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

  function getAccessibleName(el) {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.getAttribute('aria-labelledby')) {
      const labelEl = document.getElementById(el.getAttribute('aria-labelledby'));
      if (labelEl) return labelEl.textContent?.trim() || '';
    }
    if (el.placeholder) return el.placeholder;
    if (el.title) return el.title;
    if (el.alt) return el.alt;
    // Check for associated label
    if (el.id) {
      const label = document.querySelector('label[for="' + el.id + '"]');
      if (label) return label.textContent?.trim() || '';
    }
    // For some elements, use text content
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'label', 'legend', 'caption', 'figcaption', 'summary', 'option'].includes(tag)) {
      return el.innerText?.trim().substring(0, 200) || '';
    }
    // For elements with interactive ARIA roles (div[role="button"], etc.), use innerText
    const elRole = el.getAttribute('role');
    if (elRole && ['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
        'tab', 'option', 'treeitem', 'switch', 'combobox', 'textbox'].includes(elRole)) {
      const text = el.innerText?.trim().substring(0, 200);
      if (text) return text;
    }
    // Last resort: check first child's aria-label (common in Google apps)
    for (const child of el.children) {
      const childLabel = child.getAttribute && child.getAttribute('aria-label');
      if (childLabel) return childLabel;
    }
    return '';
  }

  function getRole(el) {
    if (el.getAttribute('role')) return el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    const type = el.type?.toLowerCase();
    const roles = {
      'a': el.href ? 'link' : 'generic',
      'button': 'button',
      'input': type === 'checkbox' ? 'checkbox' : type === 'radio' ? 'radio' : type === 'submit' ? 'button' : type === 'range' ? 'slider' : type === 'file' ? 'file' : 'textbox',
      'textarea': 'textbox',
      'select': 'combobox',
      'img': 'img',
      'h1': 'heading',
      'h2': 'heading',
      'h3': 'heading',
      'h4': 'heading',
      'h5': 'heading',
      'h6': 'heading',
      'nav': 'navigation',
      'main': 'main',
      'header': 'banner',
      'footer': 'contentinfo',
      'aside': 'complementary',
      'section': 'region',
      'article': 'article',
      'form': 'form',
      'table': 'table',
      'tr': 'row',
      'th': 'columnheader',
      'td': 'cell',
      'ul': 'list',
      'ol': 'list',
      'li': 'listitem',
      'dialog': 'dialog',
      'details': 'group',
      'summary': 'button',
      'progress': 'progressbar',
      'meter': 'meter',
      'video': 'video',
      'audio': 'audio',
      'iframe': 'frame',
    };
    return roles[tag] || 'generic';
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

  function getState(el) {
    const states = [];
    if (el.disabled) states.push('disabled');
    if (el.checked) states.push('checked');
    if (el.selected) states.push('selected');
    if (el.readOnly) states.push('readonly');
    if (el.required) states.push('required');
    if (el.getAttribute('aria-expanded') === 'true') states.push('expanded');
    if (el.getAttribute('aria-expanded') === 'false') states.push('collapsed');
    if (el.getAttribute('aria-selected') === 'true') states.push('selected');
    if (el.getAttribute('aria-pressed') === 'true') states.push('pressed');
    if (document.activeElement === el) states.push('focused');
    return states;
  }

  function buildTree(el, depth, maxDepth, filter, search) {
    if (depth > maxDepth) return null;
    if (!el || el.nodeType !== 1) return null;

    // Skip hidden elements
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    if (el.getAttribute('aria-hidden') === 'true') return null;

    const role = getRole(el);
    const name = getAccessibleName(el);
    const interactive = isInteractive(el);

    // For interactive filter, skip non-interactive elements but still traverse children
    const include = filter === 'all' || interactive || role !== 'generic';

    // Build children (light DOM + shadow DOM)
    const children = [];
    for (const child of el.children) {
      const childNode = buildTree(child, depth + 1, maxDepth, filter, search);
      if (childNode) children.push(childNode);
    }
    // Traverse shadow DOM if present (open shadow roots only)
    if (el.shadowRoot) {
      for (const child of el.shadowRoot.children) {
        const childNode = buildTree(child, depth + 1, maxDepth, filter, search);
        if (childNode) children.push(childNode);
      }
    }

    // Search filter — match name, aria-label, aria-description, and textContent
    if (search) {
      const searchLower = search.toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const ariaDesc = (el.getAttribute('aria-description') || '').toLowerCase();
      const matchesSelf = name.toLowerCase().includes(searchLower) ||
        ariaLabel.includes(searchLower) ||
        ariaDesc.includes(searchLower) ||
        (el.textContent || '').toLowerCase().includes(searchLower);
      if (!matchesSelf && children.length === 0) return null;
    }

    // Skip generic nodes with no name and only one child (compress tree)
    if (role === 'generic' && !name && children.length === 1 && !interactive) {
      return children[0];
    }

    // Skip generic nodes with no meaningful content
    if (!include && children.length === 0) return null;

    const node = {
      ref: interactive || include ? getRefId(el) : undefined,
      role: role,
      name: name || undefined,
      states: getState(el),
      value: undefined,
      children: children.length > 0 ? children : undefined,
    };

    // Add value for form elements
    if (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea') {
      node.value = el.value;
    }
    if (el.tagName.toLowerCase() === 'select') {
      node.value = el.value;
      // List options
      const opts = [];
      for (const opt of el.options) {
        opts.push({ text: opt.text, value: opt.value, selected: opt.selected });
      }
      node.options = opts;
    }

    return node;
  }

  const root = options.rootEl || document.body;
  const tree = buildTree(root, 0, options.maxDepth || 30, options.filter || 'all', options.search || '');
  return JSON.stringify({ tree, refCount: window.__brwRefCounter });
})
`;

export async function handleReadPage(
  cdp: CDPManager,
  params: {
    tab?: string;
    filter?: string;
    depth?: number;
    ref?: string;
    scope?: string;
    maxChars?: number;
    search?: string;
    frame?: string;
    limit?: number;
  }
): Promise<ApiResponse> {
  const tabId = params.tab;
  const client = cdp.getClient(tabId);

  let expression: string;

  if (params.ref) {
    // Scope to a subtree by ref
    expression = `${TREE_SCRIPT}({
      rootEl: window.__brwElementMap?.get(${JSON.stringify(params.ref)})?.deref(),
      filter: ${JSON.stringify(params.filter || 'all')},
      maxDepth: ${params.depth || 30},
      search: ${JSON.stringify(params.search || '')}
    })`;
  } else if (params.scope) {
    // Scope to a subtree by CSS selector
    expression = `${TREE_SCRIPT}({
      rootEl: document.querySelector(${JSON.stringify(params.scope)}),
      filter: ${JSON.stringify(params.filter || 'all')},
      maxDepth: ${params.depth || 30},
      search: ${JSON.stringify(params.search || '')}
    })`;
  } else {
    expression = `${TREE_SCRIPT}({
      filter: ${JSON.stringify(params.filter || 'all')},
      maxDepth: ${params.depth || 30},
      search: ${JSON.stringify(params.search || '')}
    })`;
  }

  // Handle frame targeting
  let evaluateOptions: any = {
    expression,
    returnByValue: true,
    awaitPromise: false,
  };

  if (params.frame) {
    const contextId = await cdp.resolveFrameContext(params.frame, tabId);
    if (contextId === null) {
      return { ok: false, error: `Frame "${params.frame}" not found`, code: 'FRAME_NOT_FOUND' };
    }
    evaluateOptions.contextId = contextId;
  }

  const result = await client.Runtime.evaluate(evaluateOptions);
  if (result.exceptionDetails) {
    return {
      ok: false,
      error: `Failed to read page: ${result.exceptionDetails.text}`,
      code: 'CDP_ERROR',
    };
  }

  const data = JSON.parse(result.result?.value || '{}');
  let tree = formatTree(data.tree, 0);

  // Apply ref limit truncation
  if (params.limit && params.limit > 0) {
    const lines = tree.split('\n');
    let refCount = 0;
    let cutIdx = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('[ref_')) {
        refCount++;
        if (refCount > params.limit) { cutIdx = i; break; }
      }
    }
    if (cutIdx < lines.length) {
      tree = lines.slice(0, cutIdx).join('\n') +
        `\n... (showing ${params.limit} of ${data.refCount} refs, use --search to narrow)`;
    }
  }

  // Apply max-chars truncation
  const maxChars = params.maxChars || 50000;
  if (tree.length > maxChars) {
    tree = tree.substring(0, maxChars) + '\n... (truncated)';
  }

  return { ok: true, tree, refCount: data.refCount };
}

function formatTree(node: any, indent: number): string {
  if (!node) return '';

  const pad = '  '.repeat(indent);
  let line = pad;

  if (node.ref) line += `[${node.ref}] `;
  line += node.role || 'generic';
  if (node.name) line += ` "${node.name}"`;
  if (node.value !== undefined && node.value !== '') line += ` value="${node.value}"`;
  if (node.states?.length) line += ` (${node.states.join(', ')})`;

  let output = line + '\n';

  // Show select options
  if (node.options) {
    for (const opt of node.options) {
      output += `${pad}  ${opt.selected ? '>' : ' '} "${opt.text}" (${opt.value})\n`;
    }
  }

  if (node.children) {
    for (const child of node.children) {
      output += formatTree(child, indent + 1);
    }
  }

  return output;
}

