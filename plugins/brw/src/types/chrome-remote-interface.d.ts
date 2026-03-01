declare module 'chrome-remote-interface' {
  interface CDPOptions {
    port?: number;
    host?: string;
    target?: string;
  }

  interface CDPTarget {
    id: string;
    type: string;
    url: string;
    title: string;
  }

  function CDP(options?: CDPOptions): Promise<any>;

  namespace CDP {
    function List(options?: { port?: number; host?: string }): Promise<CDPTarget[]>;
    function New(options?: { port?: number; host?: string; url?: string }): Promise<CDPTarget>;
    function Activate(options: { port?: number; host?: string; id: string }): Promise<void>;
    function Close(options: { port?: number; host?: string; id: string }): Promise<void>;
  }

  export = CDP;
}
