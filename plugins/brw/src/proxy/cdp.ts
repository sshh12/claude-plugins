import CDP from 'chrome-remote-interface';
import type { TabInfo, ConsoleMessage, NetworkRequest } from '../shared/types.js';

interface CDPClient {
  Page: any;
  Runtime: any;
  Network: any;
  DOM: any;
  Input: any;
  Emulation: any;
  Performance: any;
  Accessibility: any;
  Browser: any;
  Target: any;
  Fetch: any;
  close: () => Promise<void>;
  on: (event: string, handler: (...args: any[]) => void) => void;
}

interface FrameContextInfo {
  contextId: number;
  frameId: string;
  origin: string;
}

export interface DownloadInfo {
  path: string;
  filename: string;
  size: number;
  state: string;
}

export interface AutoDismissedDialog {
  type: string;
  message: string;
  action: string;
  timestamp: number;
}

interface TabState {
  client: CDPClient;
  targetId: string;
  url: string;
  title: string;
  consoleBuffer: ConsoleMessage[];
  networkBuffer: NetworkRequest[];
  networkBodies: Map<string, { body: string; base64: boolean; mimeType: string }>;
  elementRefCounter: number;
  pendingDialog: { type: string; message: string; defaultPrompt?: string } | null;
  autoDismissedDialogs: AutoDismissedDialog[];
  pendingDownload: DownloadInfo | null;
  mutex: Promise<void>;
  /** Maps frameId -> execution context ID for frame targeting */
  frameContexts: Map<string, FrameContextInfo>;
}

const MAX_BUFFER_SIZE = 1000;

export class CDPManager {
  private tabs = new Map<string, TabState>();
  private activeTabId: string | null = null;
  private cdpPort: number;
  private downloadDir: string;
  private connectRetries = 0;
  private maxConnectRetries = 30; // 30 * 1s = 30s max wait for Chrome

  constructor(cdpPort: number, downloadDir?: string) {
    this.cdpPort = cdpPort;
    this.downloadDir = downloadDir || '/tmp/brw-screenshots/downloads';
  }

  async connect(): Promise<void> {
    // Wait for Chrome to be ready
    while (this.connectRetries < this.maxConnectRetries) {
      try {
        const targets = await CDP.List({ port: this.cdpPort });
        const pageTargets = targets.filter((t: any) => t.type === 'page');
        if (pageTargets.length > 0) {
          // Connect to existing pages
          for (const target of pageTargets) {
            await this.attachToTarget(target.id);
          }
          if (!this.activeTabId && this.tabs.size > 0) {
            this.activeTabId = this.tabs.keys().next().value!;
          }
          return;
        }
      } catch {
        // Chrome not ready yet
      }
      this.connectRetries++;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Failed to connect to Chrome CDP on port ${this.cdpPort} after ${this.maxConnectRetries}s`);
  }

  private async attachToTarget(targetId: string): Promise<TabState> {
    if (this.tabs.has(targetId)) {
      return this.tabs.get(targetId)!;
    }

    const client = (await CDP({
      port: this.cdpPort,
      target: targetId,
    })) as unknown as CDPClient;

    // Enable required domains
    await Promise.all([
      client.Page.enable(),
      client.Runtime.enable(),
      client.Network.enable(),
      client.DOM.enable(),
      client.Performance.enable(),
    ]);

    // Set up download behavior using the configurable download directory
    try {
      await client.Browser.setDownloadBehavior({
        behavior: 'allowAndName',
        downloadPath: this.downloadDir,
        eventsEnabled: true,
      });
    } catch {
      // Older Chrome versions may not support this
    }

    const state: TabState = {
      client,
      targetId,
      url: '',
      title: '',
      consoleBuffer: [],
      networkBuffer: [],
      networkBodies: new Map(),
      elementRefCounter: 0,
      pendingDialog: null,
      autoDismissedDialogs: [],
      pendingDownload: null,
      mutex: Promise.resolve(),
      frameContexts: new Map(),
    };

    // Track page info
    client.on('Page.frameNavigated', (params: any) => {
      if (!params.frame.parentId) {
        state.url = params.frame.url || '';
        state.title = '';
      }
    });

    client.on('Page.domContentEventFired', async () => {
      try {
        const result = await client.Runtime.evaluate({
          expression: 'document.title',
          returnByValue: true,
        });
        state.title = result.result?.value || '';
      } catch {
        // ignore
      }
    });

    // Track execution contexts for frame targeting
    client.on('Runtime.executionContextCreated', (params: any) => {
      const ctx = params.context;
      if (ctx.auxData?.frameId) {
        state.frameContexts.set(ctx.auxData.frameId, {
          contextId: ctx.id,
          frameId: ctx.auxData.frameId,
          origin: ctx.origin || '',
        });
      }
    });

    client.on('Runtime.executionContextDestroyed', (params: any) => {
      // Remove destroyed contexts
      for (const [frameId, info] of state.frameContexts) {
        if (info.contextId === params.executionContextId) {
          state.frameContexts.delete(frameId);
          break;
        }
      }
    });

    client.on('Runtime.executionContextsCleared', () => {
      state.frameContexts.clear();
    });

    // Console buffer
    client.on('Runtime.consoleAPICalled', (params: any) => {
      const msg: ConsoleMessage = {
        level: params.type,
        text: params.args?.map((a: any) => a.value ?? a.description ?? '').join(' ') || '',
        timestamp: params.timestamp || Date.now(),
        source: 'console',
      };
      state.consoleBuffer.push(msg);
      if (state.consoleBuffer.length > MAX_BUFFER_SIZE) {
        state.consoleBuffer.shift();
      }
    });

    client.on('Runtime.exceptionThrown', (params: any) => {
      const msg: ConsoleMessage = {
        level: 'error',
        text: params.exceptionDetails?.text || params.exceptionDetails?.exception?.description || 'Unknown error',
        timestamp: params.timestamp || Date.now(),
        source: 'exception',
      };
      state.consoleBuffer.push(msg);
      if (state.consoleBuffer.length > MAX_BUFFER_SIZE) {
        state.consoleBuffer.shift();
      }
    });

    // Network buffer
    client.on('Network.responseReceived', (params: any) => {
      const req: NetworkRequest = {
        id: params.requestId,
        method: params.response?.requestHeaders?.[':method'] || 'GET',
        url: params.response?.url || '',
        status: params.response?.status || 0,
        duration: params.response?.timing
          ? Math.round((params.response.timing.receiveHeadersEnd || 0) - (params.response.timing.sendStart || 0))
          : 0,
        size: params.response?.encodedDataLength || 0,
      };
      state.networkBuffer.push(req);
      if (state.networkBuffer.length > MAX_BUFFER_SIZE) {
        state.networkBuffer.shift();
      }
    });

    // Network request method tracking
    const requestMethods = new Map<string, string>();
    client.on('Network.requestWillBeSent', (params: any) => {
      requestMethods.set(params.requestId, params.request?.method || 'GET');
    });

    client.on('Network.responseReceived', (params: any) => {
      // Update method from requestWillBeSent
      const existing = state.networkBuffer.find((r) => r.id === params.requestId);
      if (existing) {
        existing.method = requestMethods.get(params.requestId) || existing.method;
      }
    });

    // Dialog handling
    client.on('Page.javascriptDialogOpening', (params: any) => {
      state.pendingDialog = {
        type: params.type,
        message: params.message,
        defaultPrompt: params.defaultPrompt,
      };

      // Auto-dismiss after 5 seconds if not handled
      setTimeout(async () => {
        if (state.pendingDialog) {
          const accept = params.type === 'alert';
          const action = accept ? 'accept' : 'dismiss';
          try {
            await client.Page.handleJavaScriptDialog({ accept });
          } catch {
            // Dialog may have been handled already
            return;
          }
          // Log the auto-dismissed dialog as a warning for next response
          state.autoDismissedDialogs.push({
            type: params.type,
            message: params.message,
            action,
            timestamp: Date.now(),
          });
          state.pendingDialog = null;
        }
      }, 5000);
    });

    client.on('Page.javascriptDialogClosed', () => {
      state.pendingDialog = null;
    });

    // Download tracking
    client.on('Page.downloadWillBegin', (params: any) => {
      state.pendingDownload = {
        path: `${this.downloadDir}/${params.suggestedFilename || 'download'}`,
        filename: params.suggestedFilename || 'download',
        size: 0,
        state: 'inProgress',
      };
    });

    client.on('Page.downloadProgress', (params: any) => {
      if (state.pendingDownload) {
        if (params.totalBytes) {
          state.pendingDownload.size = params.totalBytes;
        }
        if (params.state === 'completed') {
          state.pendingDownload.state = 'completed';
          state.pendingDownload.size = params.totalBytes || state.pendingDownload.size;
        } else if (params.state === 'canceled') {
          state.pendingDownload.state = 'canceled';
        }
      }
    });

    this.tabs.set(targetId, state);

    // Get initial page info
    try {
      const result = await client.Runtime.evaluate({
        expression: 'JSON.stringify({url: location.href, title: document.title})',
        returnByValue: true,
      });
      const info = JSON.parse(result.result?.value || '{}');
      state.url = info.url || '';
      state.title = info.title || '';
    } catch {
      // ignore
    }

    return state;
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  setActiveTab(tabId: string): void {
    if (!this.tabs.has(tabId)) {
      throw new Error(`Tab ${tabId} not found`);
    }
    this.activeTabId = tabId;
  }

  getTab(tabId?: string): TabState {
    const id = tabId || this.activeTabId;
    if (!id) throw new Error('No active tab');
    const tab = this.tabs.get(id);
    if (!tab) throw new Error(`Tab ${id} not found`);
    return tab;
  }

  getClient(tabId?: string): CDPClient {
    return this.getTab(tabId).client;
  }

  async getPageInfo(tabId?: string): Promise<{ url: string; title: string; contentLength: number }> {
    const tab = this.getTab(tabId);
    try {
      const result = await tab.client.Runtime.evaluate({
        expression:
          'JSON.stringify({url: location.href, title: document.title, contentLength: document.documentElement.outerHTML.length})',
        returnByValue: true,
      });
      const info = JSON.parse(result.result?.value || '{}');
      tab.url = info.url || tab.url;
      tab.title = info.title || tab.title;
      return {
        url: info.url || tab.url,
        title: info.title || tab.title,
        contentLength: info.contentLength || 0,
      };
    } catch {
      return { url: tab.url, title: tab.title, contentLength: 0 };
    }
  }

  /**
   * Acquire per-tab mutex for mutation operations.
   * Returns a release function.
   */
  async acquireMutex(tabId?: string): Promise<() => void> {
    const tab = this.getTab(tabId);
    let release: () => void;
    const previous = tab.mutex;
    tab.mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release!;
  }

  async listTabs(): Promise<TabInfo[]> {
    const targets = await CDP.List({ port: this.cdpPort });
    const pageTargets = targets.filter((t: any) => t.type === 'page');

    // Attach to any new tabs
    for (const target of pageTargets) {
      if (!this.tabs.has(target.id)) {
        await this.attachToTarget(target.id);
      }
    }

    // Clean up closed tabs
    for (const [id] of this.tabs) {
      if (!pageTargets.find((t: any) => t.id === id)) {
        try {
          await this.tabs.get(id)?.client.close();
        } catch {
          // ignore
        }
        this.tabs.delete(id);
      }
    }

    // Reset activeTabId if it's stale (target was destroyed/recreated)
    if (this.activeTabId && !this.tabs.has(this.activeTabId)) {
      this.activeTabId = this.tabs.size > 0 ? this.tabs.keys().next().value! : null;
    }

    return pageTargets.map((t: any) => ({
      id: t.id,
      url: t.url,
      title: t.title,
    }));
  }

  async createTab(url?: string): Promise<{ tabId: string; url: string }> {
    const target = await CDP.New({
      port: this.cdpPort,
      url: url || 'about:blank',
    });
    const state = await this.attachToTarget(target.id);
    this.activeTabId = target.id;
    return { tabId: target.id, url: state.url || url || 'about:blank' };
  }

  async activateTab(tabId: string): Promise<void> {
    if (!this.tabs.has(tabId)) {
      // Try to attach
      await this.attachToTarget(tabId);
    }
    await CDP.Activate({ port: this.cdpPort, id: tabId });
    this.activeTabId = tabId;
  }

  async closeTab(tabId: string): Promise<TabInfo[]> {
    const tab = this.tabs.get(tabId);
    if (tab) {
      try {
        await tab.client.close();
      } catch {
        // ignore
      }
      this.tabs.delete(tabId);
    }
    await CDP.Close({ port: this.cdpPort, id: tabId });

    // If we closed the active tab, switch to another
    if (this.activeTabId === tabId) {
      this.activeTabId = this.tabs.size > 0 ? this.tabs.keys().next().value! : null;
    }

    return this.listTabs();
  }

  getConsoleBuffer(tabId?: string): ConsoleMessage[] {
    return this.getTab(tabId).consoleBuffer;
  }

  clearConsoleBuffer(tabId?: string): void {
    this.getTab(tabId).consoleBuffer = [];
  }

  getNetworkBuffer(tabId?: string): NetworkRequest[] {
    return this.getTab(tabId).networkBuffer;
  }

  clearNetworkBuffer(tabId?: string): void {
    this.getTab(tabId).networkBuffer = [];
  }

  getPendingDialog(tabId?: string): TabState['pendingDialog'] {
    return this.getTab(tabId).pendingDialog;
  }

  /**
   * Get and clear any auto-dismissed dialog warnings.
   * These are dialogs that were auto-dismissed after 5 seconds
   * and should be reported as warnings in the next response.
   */
  consumeAutoDismissedDialogs(tabId?: string): AutoDismissedDialog[] {
    const tab = this.getTab(tabId);
    const dialogs = tab.autoDismissedDialogs.splice(0);
    return dialogs;
  }

  /**
   * Get the pending download info (if any) and clear it.
   * Returns null if no download occurred.
   */
  consumePendingDownload(tabId?: string): DownloadInfo | null {
    const tab = this.getTab(tabId);
    const download = tab.pendingDownload;
    tab.pendingDownload = null;
    return download;
  }

  getNextRefId(tabId?: string): number {
    const tab = this.getTab(tabId);
    tab.elementRefCounter++;
    return tab.elementRefCounter;
  }

  /**
   * Resolve a --frame argument to a CDP execution context ID.
   *
   * Supports:
   * - Numeric index: "0", "1" (0-based child frame index)
   * - Frame name or id attribute: "my-frame"
   * - URL substring: "example.com/form"
   * - Nested frames: "0.1" (child 1 inside child 0)
   *
   * Returns the execution context ID, or null if not found.
   */
  async resolveFrameContext(frameTarget: string, tabId?: string): Promise<number | null> {
    const tab = this.getTab(tabId);
    const client = tab.client;

    const { frameTree } = await client.Page.getFrameTree();

    // Split by "." for nested frame resolution
    const segments = frameTarget.split('.');
    let currentTree = frameTree;

    for (let i = 0; i < segments.length; i++) {
      const frameId = this.findFrameInTree(currentTree, segments[i]);
      if (!frameId) return null;

      if (i < segments.length - 1) {
        // Intermediate segment: descend into this frame's subtree
        const subtree = this.findSubtree(currentTree, frameId);
        if (!subtree) return null;
        currentTree = subtree;
      } else {
        // Last segment: resolve to execution context
        return this.getContextIdForFrame(tab, frameId);
      }
    }

    return null;
  }

  private findFrameInTree(tree: any, target: string): string | null {
    const children = tree.childFrames;
    if (!children || children.length === 0) return null;

    // Match by numeric index
    if (/^\d+$/.test(target)) {
      const idx = parseInt(target, 10);
      if (idx >= 0 && idx < children.length) {
        return children[idx].frame.id;
      }
      return null;
    }

    // Match by name/id attribute or URL substring
    for (const child of children) {
      if (child.frame.name === target || child.frame.id === target) {
        return child.frame.id;
      }
    }
    for (const child of children) {
      if (child.frame.url?.includes(target)) {
        return child.frame.id;
      }
    }

    return null;
  }

  private findSubtree(tree: any, frameId: string): any | null {
    if (!tree.childFrames) return null;
    for (const child of tree.childFrames) {
      if (child.frame.id === frameId) return child;
      const found = this.findSubtree(child, frameId);
      if (found) return found;
    }
    return null;
  }

  private getContextIdForFrame(tab: TabState, frameId: string): number | null {
    const info = tab.frameContexts.get(frameId);
    return info ? info.contextId : null;
  }

  async closeAll(): Promise<void> {
    for (const [, tab] of this.tabs) {
      try {
        await tab.client.close();
      } catch {
        // ignore
      }
    }
    this.tabs.clear();
    this.activeTabId = null;
  }

  /**
   * Execute a CDP operation with one automatic retry on transient errors.
   */
  async withRetry<T>(tabId: string | undefined, fn: (client: CDPClient) => Promise<T>): Promise<T> {
    const TRANSIENT_ERRORS = ['Target closed', 'Session closed', 'Cannot find context'];
    try {
      return await fn(this.getClient(tabId));
    } catch (err: any) {
      const msg = err?.message || '';
      if (TRANSIENT_ERRORS.some((e) => msg.includes(e))) {
        // Try to reconnect
        const id = tabId || this.activeTabId;
        if (id) {
          this.tabs.delete(id);
          try {
            await this.attachToTarget(id);
            return await fn(this.getClient(id));
          } catch {
            throw err; // Give up
          }
        }
      }
      throw err;
    }
  }
}
