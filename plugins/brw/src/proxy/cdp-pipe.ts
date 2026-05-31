/**
 * CRI-compatible CDP-over-pipe transport.
 *
 * Chrome launched with --remote-debugging-pipe reads CDP commands on fd 3 and
 * writes responses + events on fd 4; messages are NUL-byte (\0)-delimited UTF-8
 * JSON. From the proxy (Node) side we WRITE commands to a Writable stream (the
 * child's stdio[3]) and READ from a Readable stream (the child's stdio[4]).
 *
 * This module exposes a default export `CDP` that is API-compatible with the
 * subset of `chrome-remote-interface` used by the proxy: a callable that
 * attaches to a target and returns a session "client" exposing per-domain
 * proxies (client.Page.*, client.Runtime.*, ...), `client.on/once/...` event
 * subscription, and `client.close()`, plus static helpers
 * `CDP.List/New/Activate/Close`.
 */
import { EventEmitter } from 'events';

/**
 * "Domain.event" strings used to disambiguate an event subscription from a
 * command invocation when a domain member is called. If the member name is in
 * this set it is treated as an event (subscribe / await-as-promise), otherwise
 * it is sent as a command.
 */
const EVENTS: Set<string> = new Set([
  'Page.loadEventFired',
  'Page.domContentEventFired',
  'Page.frameNavigated',
  'Page.frameStartedLoading',
  'Page.frameStoppedLoading',
  'Page.javascriptDialogOpening',
  'Page.javascriptDialogClosed',
  'Page.downloadWillBegin',
  'Page.downloadProgress',
  'Page.lifecycleEvent',
  'Page.navigatedWithinDocument',
  'Page.frameAttached',
  'Page.frameDetached',
  'Runtime.consoleAPICalled',
  'Runtime.exceptionThrown',
  'Runtime.executionContextCreated',
  'Runtime.executionContextDestroyed',
  'Runtime.executionContextsCleared',
  'Runtime.bindingCalled',
  'Network.requestWillBeSent',
  'Network.responseReceived',
  'Network.loadingFinished',
  'Network.loadingFailed',
  'Network.dataReceived',
  'Network.requestServedFromCache',
  'Fetch.requestPaused',
  'Fetch.authRequired',
  'Target.targetCreated',
  'Target.targetDestroyed',
  'Target.targetInfoChanged',
  'Target.attachedToTarget',
  'Target.detachedFromTarget',
  'Target.targetCrashed',
]);

/**
 * Domains whose commands route to the browser root (NO sessionId). All other
 * domains (Page, Runtime, Network, DOM, Input, Emulation, Performance,
 * Accessibility, Fetch, Storage, Log, ...) route WITH the page sessionId.
 */
const ROOT: Set<string> = new Set(['Browser', 'Target', 'SystemInfo', 'Tracing', 'IO']);

class PipeConnection {
  private write: any;
  private read: any;
  private nextId: number;
  private pending: Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>;
  private rootEmitter: EventEmitter;
  private sessionEmitters: Map<string, EventEmitter>;
  private buf: Buffer;

  constructor(writeStream: any, readStream: any) {
    this.write = writeStream;
    this.read = readStream;
    this.nextId = 1;
    this.pending = new Map();
    this.rootEmitter = new EventEmitter();
    this.sessionEmitters = new Map();
    this.buf = Buffer.alloc(0);
    this.rootEmitter.setMaxListeners(0);
    readStream.on('data', (c: Buffer) => this._onData(c));
    readStream.on('error', () => {});
  }

  private _onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    let idx = this.buf.indexOf(0);
    while (idx !== -1) {
      const slice = this.buf.subarray(0, idx);
      this.buf = this.buf.subarray(idx + 1);
      if (slice.length) {
        try {
          this._dispatch(JSON.parse(slice.toString('utf8')));
        } catch {
          // ignore malformed frame
        }
      }
      idx = this.buf.indexOf(0);
    }
  }

  private _dispatch(msg: any): void {
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    const em = msg.sessionId ? this._sessionEmitter(msg.sessionId) : this.rootEmitter;
    if (msg.method) em.emit(msg.method, msg.params || {});
  }

  send(method: string, params: any = {}, sessionId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const m: any = { id, method, params };
      if (sessionId) m.sessionId = sessionId;
      try {
        this.write.write(JSON.stringify(m) + '\0');
      } catch (e: any) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  _sessionEmitter(sessionId: string): EventEmitter {
    let em = this.sessionEmitters.get(sessionId);
    if (!em) {
      em = new EventEmitter();
      em.setMaxListeners(0);
      this.sessionEmitters.set(sessionId, em);
    }
    return em;
  }

  removeSession(sessionId: string): void {
    const em = this.sessionEmitters.get(sessionId);
    if (em) em.removeAllListeners();
    this.sessionEmitters.delete(sessionId);
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      p.reject(new Error('CDP pipe closed'));
    }
    this.pending.clear();
    this.rootEmitter.removeAllListeners();
    for (const [, em] of this.sessionEmitters) {
      em.removeAllListeners();
    }
    this.sessionEmitters.clear();
  }
}

let connection: PipeConnection | null = null;

function conn(): PipeConnection {
  if (!connection) throw new Error('CDP pipe not attached');
  return connection;
}

export function attachPipe(writeStream: any, readStream: any): void {
  connection = new PipeConnection(writeStream, readStream);
  // Fire-and-forget: enable target discovery so the browser reports targets.
  connection.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
}

export function detachPipe(): void {
  if (connection) connection.dispose();
  connection = null;
}

/**
 * Attach to a target and return a CRI-like session client.
 */
const CDP: any = async function CDP(options: any = {}): Promise<any> {
  const targetId = options.target;
  const { sessionId } = await conn().send('Target.attachToTarget', { targetId, flatten: true });
  const em = conn()._sessionEmitter(sessionId);

  const base: any = {};
  let client: any;

  base.on = (event: string, handler: any) => {
    em.on(event, handler);
    return client;
  };
  base.once = (event: string, handler: any) => {
    em.once(event, handler);
    return client;
  };
  base.removeListener = (event: string, handler: any) => {
    em.removeListener(event, handler);
    return client;
  };
  base.removeAllListeners = (event?: string) => {
    em.removeAllListeners(event as any);
    return client;
  };
  base.close = async () => {
    try {
      await conn().send('Target.detachFromTarget', { sessionId });
    } catch {
      // ignore — target may already be gone
    }
    conn().removeSession(sessionId);
  };

  client = new Proxy(base, {
    get(target: any, prop: any) {
      if (prop in target) return target[prop];
      // Treat prop as a Domain name → per-domain proxy.
      const domain = String(prop);
      return new Proxy(
        {},
        {
          get(_d: any, method: any) {
            const full = domain + '.' + String(method);
            const routeSession = ROOT.has(domain) ? undefined : sessionId;
            return (arg?: any) => {
              if (EVENTS.has(full)) {
                if (typeof arg === 'function') {
                  em.on(full, arg);
                  return arg;
                }
                return new Promise((res: any) => em.once(full, res));
              }
              return conn().send(full, arg || {}, routeSession);
            };
          },
        }
      );
    },
  });

  return client;
};

CDP.List = async (): Promise<any[]> => {
  const r = await conn().send('Target.getTargets');
  return ((r && r.targetInfos) || []).map((t: any) => ({
    id: t.targetId,
    type: t.type,
    url: t.url,
    title: t.title,
  }));
};

CDP.New = async (opts: any = {}): Promise<any> => {
  const c = await conn().send('Target.createTarget', { url: opts.url || 'about:blank' });
  const targetId = c.targetId;
  let info: any = {};
  try {
    info = await conn().send('Target.getTargetInfo', { targetId });
  } catch {
    // ignore — fall back to opts below
  }
  const ti = (info && info.targetInfo) || {};
  return {
    id: targetId,
    type: ti.type || 'page',
    url: ti.url || opts.url || '',
    title: ti.title || '',
  };
};

CDP.Activate = async (opts: any): Promise<void> => {
  await conn().send('Target.activateTarget', { targetId: opts.id });
};

CDP.Close = async (opts: any): Promise<void> => {
  await conn().send('Target.closeTarget', { targetId: opts.id });
};

export default CDP;
