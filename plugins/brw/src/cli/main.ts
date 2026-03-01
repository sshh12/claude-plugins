import { Command } from 'commander';
import { getConfig } from '../shared/config.js';
import { ExitCode } from '../shared/types.js';
import { proxyRequest, ensureProxy, formatOutput } from './http.js';

const config = getConfig();

const program = new Command();

program
  .name('brw')
  .version('0.2.1')
  .description('Browser automation for Claude Code via Chrome DevTools Protocol')
  .option('-t, --tab <id>', 'Target tab ID (default: active tab)')
  .option('--text', 'Output as plain text instead of JSON')
  .option('--timeout <seconds>', 'CLI request timeout', '30')
  .option('--debug', 'Verbose logging to stderr')
  .option('--port <port>', 'Proxy server port');

function getPort(): number {
  const opts = program.opts();
  return opts.port ? parseInt(opts.port, 10) : config.proxyPort;
}

function getGlobalOpts(): { tab?: string; text: boolean; timeout: number; debug: boolean; port: number } {
  const opts = program.opts();
  return {
    tab: opts.tab,
    text: !!opts.text,
    timeout: parseInt(opts.timeout, 10) || 30,
    debug: !!opts.debug,
    port: getPort(),
  };
}

async function run(
  method: string,
  endpoint: string,
  body: Record<string, unknown>,
  exitCodeMap?: Record<string, number>
): Promise<void> {
  const globals = getGlobalOpts();
  if (body.tab === undefined && globals.tab) {
    body.tab = globals.tab;
  }

  try {
    await ensureProxy(globals.port, globals.timeout, globals.debug);
  } catch (err: any) {
    const msg = err?.message || 'Failed to connect to proxy';
    const result = { ok: false, error: msg, code: 'PROXY_NOT_RUNNING', hint: 'Run `brw server start` or check that Node.js is available.' };
    process.stdout.write(formatOutput(result, globals.text) + '\n');
    process.exit(ExitCode.PROXY_ERROR);
  }

  try {
    let result = await proxyRequest(method, endpoint, body, globals.port, globals.timeout, globals.debug);

    // Auto-restart on CDP errors (stale websocket, Chrome crash) — retry once
    if (!result.ok && result.code === 'CDP_ERROR') {
      if (globals.debug) {
        process.stderr.write('[brw] CDP error, restarting proxy and retrying...\n');
      }
      try {
        await proxyRequest('POST', '/shutdown', {}, globals.port, 5, false);
      } catch { /* ignore */ }
      // Wait for old proxy to die
      await new Promise((r) => setTimeout(r, 1000));
      const { startProxy } = await import('./proxy-launcher.js');
      await startProxy(globals.port, undefined, undefined, globals.debug);
      result = await proxyRequest(method, endpoint, body, globals.port, globals.timeout, globals.debug);
    }

    process.stdout.write(formatOutput(result, globals.text) + '\n');

    if (!result.ok) {
      const code = result.code as string;
      if (exitCodeMap && exitCodeMap[code] !== undefined) {
        process.exit(exitCodeMap[code]);
      }
      if (code === 'URL_BLOCKED') process.exit(ExitCode.URL_BLOCKED);
      if (code === 'INVALID_ARGUMENT') process.exit(ExitCode.USAGE_ERROR);
      process.exit(ExitCode.CDP_ERROR);
    }
  } catch (err: any) {
    const msg = err?.message || 'Request failed';
    const result = { ok: false, error: msg, code: 'PROXY_ERROR' };
    process.stdout.write(formatOutput(result, globals.text) + '\n');
    process.exit(ExitCode.PROXY_ERROR);
  }
}

// ---- screenshot ----

program
  .command('screenshot')
  .description('Capture a screenshot of the current page')
  .option('--region <coords>', 'Crop to bounding box x1,y1,x2,y2')
  .option('--ref <ref>', 'Screenshot a single element by ref ID')
  .option('--full-page', 'Capture the entire scrollable page')
  .action(async (opts) => {
    await run('POST', '/api/screenshot', {
      region: opts.region,
      ref: opts.ref,
      fullPage: opts.fullPage,
    });
  });

// ---- click ----

program
  .command('click [x] [y]')
  .description('Click at coordinates or element')
  .option('--ref <ref>', 'Click element by ref ID')
  .option('--selector <css>', 'Click element by CSS selector')
  .option('--right', 'Right click')
  .option('--double', 'Double click')
  .option('--triple', 'Triple click')
  .option('--modifiers <mods>', 'Modifier keys (e.g., shift, ctrl+shift)')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (x, y, opts) => {
    const body: Record<string, unknown> = {
      ref: opts.ref,
      selector: opts.selector,
      right: opts.right,
      double: opts.double,
      triple: opts.triple,
      modifiers: opts.modifiers,
      noScreenshot: opts.screenshot === false,
    };
    if (x !== undefined && y !== undefined) {
      body.x = parseInt(x, 10);
      body.y = parseInt(y, 10);
    }
    await run('POST', '/api/click', body);
  });

// ---- hover ----

program
  .command('hover [x] [y]')
  .description('Hover at coordinates or element')
  .option('--ref <ref>', 'Hover element by ref ID')
  .option('--selector <css>', 'Hover element by CSS selector')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (x, y, opts) => {
    const body: Record<string, unknown> = {
      ref: opts.ref,
      selector: opts.selector,
      noScreenshot: opts.screenshot === false,
    };
    if (x !== undefined && y !== undefined) {
      body.x = parseInt(x, 10);
      body.y = parseInt(y, 10);
    }
    await run('POST', '/api/hover', body);
  });

// ---- type ----

program
  .command('type <text>')
  .description('Type text into the focused element')
  .option('--clear', 'Clear field before typing')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (text, opts) => {
    await run('POST', '/api/type', {
      text,
      clear: opts.clear,
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- key ----

program
  .command('key <keys>')
  .description('Press keyboard keys/shortcuts')
  .option('--repeat <n>', 'Number of times to press', '1')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (keys, opts) => {
    await run('POST', '/api/key', {
      keys,
      repeat: parseInt(opts.repeat, 10),
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- navigate ----

program
  .command('navigate <url>')
  .description('Navigate to URL, or "back"/"forward"')
  .option('--wait <strategy>', 'Wait strategy: none, dom, network, render (full SPA render)', 'dom')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (url, opts) => {
    await run('POST', '/api/navigate', {
      url,
      wait: opts.wait,
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- scroll ----

program
  .command('scroll <direction>')
  .description('Scroll the page (up, down, left, right)')
  .option('--amount <n>', 'Number of scroll ticks', '3')
  .option('--at <coords>', 'Scroll element at x,y coordinates')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (direction, opts) => {
    const body: Record<string, unknown> = {
      direction,
      amount: parseInt(opts.amount, 10),
      noScreenshot: opts.screenshot === false,
    };
    if (opts.at) {
      const parts = opts.at.split(',').map(Number);
      if (parts.length === 2) {
        body.atX = parts[0];
        body.atY = parts[1];
      }
    }
    await run('POST', '/api/scroll', body);
  });

// ---- scroll-to ----

program
  .command('scroll-to')
  .description('Scroll an element into view')
  .option('--ref <ref>', 'Element ref ID')
  .option('--selector <css>', 'CSS selector')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (opts) => {
    if (!opts.ref && !opts.selector) {
      process.stderr.write('Error: must specify --ref or --selector\n');
      process.exit(1);
    }
    await run('POST', '/api/scroll-to', {
      ref: opts.ref,
      selector: opts.selector,
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- drag ----

program
  .command('drag [x1] [y1] [x2] [y2]')
  .description('Drag from one point to another')
  .option('--from-ref <ref>', 'Start element ref ID')
  .option('--to-ref <ref>', 'End element ref ID')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (x1, y1, x2, y2, opts) => {
    const body: Record<string, unknown> = {
      fromRef: opts.fromRef,
      toRef: opts.toRef,
      noScreenshot: opts.screenshot === false,
    };
    if (x1 !== undefined) body.x1 = parseInt(x1, 10);
    if (y1 !== undefined) body.y1 = parseInt(y1, 10);
    if (x2 !== undefined) body.x2 = parseInt(x2, 10);
    if (y2 !== undefined) body.y2 = parseInt(y2, 10);
    await run('POST', '/api/drag', body);
  });

// ---- tabs ----

program
  .command('tabs')
  .description('List all browser tabs')
  .action(async () => {
    await run('GET', '/api/tabs', {});
  });

// ---- new-tab ----

program
  .command('new-tab [url]')
  .description('Open a URL in a new tab')
  .action(async (url) => {
    await run('POST', '/api/tabs/new', { url });
  });

// ---- switch-tab ----

program
  .command('switch-tab <id>')
  .description('Switch to a tab by ID')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (id, opts) => {
    await run('POST', '/api/tabs/switch', {
      tabId: id,
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- close-tab ----

program
  .command('close-tab <id>')
  .description('Close a tab by ID')
  .action(async (id) => {
    await run('POST', '/api/tabs/close', { tabId: id });
  });

// ---- wait ----

program
  .command('wait')
  .description('Wait for a duration')
  .option('--duration <seconds>', 'Seconds to wait', '2')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (opts) => {
    await run('POST', '/api/wait', {
      duration: parseFloat(opts.duration),
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- wait-for ----

program
  .command('wait-for')
  .description('Wait for a condition')
  .option('--selector <css>', 'Wait for CSS selector to match')
  .option('--text <text>', 'Wait for text to appear on page')
  .option('--url <glob>', 'Wait for URL to match glob pattern')
  .option('--js <expression>', 'Wait for JS expression to return truthy')
  .option('--network-idle', 'Wait for network to be idle')
  .option('--timeout <seconds>', 'Max seconds to wait', '10')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (opts) => {
    await run('POST', '/api/wait-for', {
      selector: opts.selector,
      text: opts.text,
      url: opts.url,
      js: opts.js,
      networkIdle: opts.networkIdle,
      timeout: parseInt(opts.timeout, 10),
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- read-page ----

program
  .command('read-page')
  .description('Read the page accessibility tree')
  .option('--filter <mode>', 'Filter: all or interactive', 'all')
  .option('--search <text>', 'Search for elements by text')
  .option('--ref <ref>', 'Return subtree rooted at ref')
  .option('--depth <n>', 'Max tree depth')
  .option('--max-chars <n>', 'Truncate output')
  .option('--frame <target>', 'Target iframe by index, name, or URL')
  .action(async (opts) => {
    await run('POST', '/api/read-page', {
      filter: opts.filter,
      search: opts.search,
      ref: opts.ref,
      depth: opts.depth ? parseInt(opts.depth, 10) : undefined,
      maxChars: opts.maxChars ? parseInt(opts.maxChars, 10) : undefined,
      frame: opts.frame,
    });
  });

// ---- get-text ----

program
  .command('get-text')
  .description('Extract main content text from the page')
  .option('--max-chars <n>', 'Truncate output')
  .action(async (opts) => {
    await run('POST', '/api/get-text', {
      maxChars: opts.maxChars ? parseInt(opts.maxChars, 10) : undefined,
    });
  });

// ---- form-input ----

program
  .command('form-input')
  .description('Set a form element value')
  .option('--ref <ref>', 'Element ref ID')
  .option('--selector <css>', 'CSS selector')
  .requiredOption('--value <value>', 'Value to set')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (opts) => {
    await run('POST', '/api/form-input', {
      ref: opts.ref,
      selector: opts.selector,
      value: opts.value,
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- js ----

program
  .command('js [expression]')
  .description('Execute JavaScript in the page')
  .option('--file <path>', 'Read JavaScript from a file instead of argument')
  .option('--frame <target>', 'Target iframe by index, name, or URL')
  .action(async (expression, opts) => {
    let jsCode = expression;

    if (opts.file) {
      const { readFileSync, existsSync } = await import('fs');
      if (!existsSync(opts.file)) {
        process.stderr.write(`Error: file not found: ${opts.file}\n`);
        process.exit(ExitCode.USAGE_ERROR);
      }
      jsCode = readFileSync(opts.file, 'utf-8');
    } else if (expression === '-' || (!expression && !process.stdin.isTTY)) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      jsCode = Buffer.concat(chunks).toString('utf-8');
    }

    if (!jsCode) {
      process.stderr.write('Error: provide an expression, --file <path>, or pipe via stdin\n');
      process.exit(ExitCode.USAGE_ERROR);
    }

    await run('POST', '/api/js', {
      expression: jsCode,
      frame: opts.frame,
    });
  });

// ---- dialog ----

program
  .command('dialog [action]')
  .description('Handle browser dialogs (accept, dismiss, or check)')
  .option('--text <response>', 'Response text for prompt dialogs')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (action, opts) => {
    await run('POST', '/api/dialog', {
      action: action || 'check',
      text: opts.text,
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- console ----

program
  .command('console')
  .description('Read captured console messages')
  .option('--errors-only', 'Only error-level messages')
  .option('--pattern <regex>', 'Filter by regex pattern')
  .option('--limit <n>', 'Max messages to return')
  .option('--clear', 'Clear buffer after reading')
  .action(async (opts) => {
    await run('POST', '/api/console', {
      errorsOnly: opts.errorsOnly,
      pattern: opts.pattern,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      clear: opts.clear,
    });
  });

// ---- network ----

program
  .command('network')
  .description('Read captured network requests')
  .option('--url-pattern <pattern>', 'Filter by URL pattern')
  .option('--limit <n>', 'Max requests to return')
  .option('--clear', 'Clear buffer after reading')
  .action(async (opts) => {
    await run('POST', '/api/network', {
      urlPattern: opts.urlPattern,
      limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
      clear: opts.clear,
    });
  });

// ---- network-body ----

program
  .command('network-body <requestId>')
  .description('Get response body for a captured network request')
  .action(async (requestId) => {
    await run('POST', '/api/network-body', { requestId });
  });

// ---- file-upload ----

program
  .command('file-upload')
  .description('Upload files to a file input element')
  .option('--ref <ref>', 'Element ref ID')
  .requiredOption('--files <paths...>', 'File paths to upload')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (opts) => {
    await run('POST', '/api/file-upload', {
      ref: opts.ref,
      files: opts.files,
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- cookies ----

const cookiesCmd = program
  .command('cookies')
  .description('List cookies for the current page')
  .action(async () => {
    await run('POST', '/api/cookies', { action: 'list' });
  });

cookiesCmd
  .command('get <name>')
  .description('Get a specific cookie')
  .action(async (name) => {
    await run('POST', '/api/cookies', { action: 'get', name });
  });

cookiesCmd
  .command('set <name> <value>')
  .description('Set a cookie')
  .option('--domain <domain>', 'Cookie domain')
  .option('--path <path>', 'Cookie path')
  .option('--expires <epoch>', 'Expiry timestamp')
  .option('--secure', 'Secure flag')
  .option('--httponly', 'HttpOnly flag')
  .action(async (name, value, opts) => {
    await run('POST', '/api/cookies', {
      action: 'set',
      name,
      value,
      domain: opts.domain,
      path: opts.path,
      expires: opts.expires ? parseInt(opts.expires, 10) : undefined,
      secure: opts.secure,
      httponly: opts.httponly,
    });
  });

cookiesCmd
  .command('delete <name>')
  .description('Delete a cookie')
  .action(async (name) => {
    await run('POST', '/api/cookies', { action: 'delete', name });
  });

cookiesCmd
  .command('clear')
  .description('Clear all cookies for current domain')
  .action(async () => {
    await run('POST', '/api/cookies', { action: 'clear' });
  });

// ---- storage ----

const storageCmd = program
  .command('storage')
  .description('Manage localStorage/sessionStorage');

storageCmd
  .command('get <key>')
  .description('Get a storage value')
  .option('--session', 'Use sessionStorage')
  .action(async (key, opts) => {
    await run('POST', '/api/storage', { action: 'get', key, session: opts.session });
  });

storageCmd
  .command('set <key> <value>')
  .description('Set a storage value')
  .option('--session', 'Use sessionStorage')
  .action(async (key, value, opts) => {
    await run('POST', '/api/storage', { action: 'set', key, value, session: opts.session });
  });

storageCmd
  .command('delete <key>')
  .description('Delete a storage key')
  .option('--session', 'Use sessionStorage')
  .action(async (key, opts) => {
    await run('POST', '/api/storage', { action: 'delete', key, session: opts.session });
  });

storageCmd
  .command('list')
  .description('List all storage entries')
  .option('--session', 'Use sessionStorage')
  .action(async (opts) => {
    await run('POST', '/api/storage', { action: 'list', session: opts.session });
  });

storageCmd
  .command('clear')
  .description('Clear all storage entries')
  .option('--session', 'Use sessionStorage')
  .action(async (opts) => {
    await run('POST', '/api/storage', { action: 'clear', session: opts.session });
  });

// ---- intercept ----

const interceptCmd = program
  .command('intercept')
  .description('Network request interception');

interceptCmd
  .command('add <pattern>')
  .description('Add an interception rule')
  .option('--status <code>', 'Override response status code')
  .option('--body <text>', 'Override response body')
  .option('--body-file <path>', 'Override response body from file')
  .option('--header <header>', 'Add response header (repeatable)', (val: string, arr: string[]) => {
    arr.push(val);
    return arr;
  }, [])
  .option('--block', 'Block the request entirely')
  .action(async (pattern, opts) => {
    await run('POST', '/api/intercept', {
      action: 'add',
      pattern,
      statusCode: opts.status ? parseInt(opts.status, 10) : undefined,
      body: opts.body,
      bodyFile: opts.bodyFile,
      headers: opts.header,
      block: opts.block,
    });
  });

interceptCmd
  .command('list')
  .description('List interception rules')
  .action(async () => {
    await run('POST', '/api/intercept', { action: 'list' });
  });

interceptCmd
  .command('remove <ruleId>')
  .description('Remove an interception rule')
  .action(async (ruleId) => {
    await run('POST', '/api/intercept', { action: 'remove', ruleId });
  });

interceptCmd
  .command('clear')
  .description('Clear all interception rules')
  .action(async () => {
    await run('POST', '/api/intercept', { action: 'clear' });
  });

// ---- resize ----

program
  .command('resize <width> <height>')
  .description('Resize the browser viewport')
  .option('--no-screenshot', 'Skip auto-screenshot')
  .action(async (width, height, opts) => {
    await run('POST', '/api/resize', {
      width: parseInt(width, 10),
      height: parseInt(height, 10),
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- pdf ----

program
  .command('pdf')
  .description('Save the current page as PDF')
  .option('--output <path>', 'Output file path')
  .option('--landscape', 'Landscape orientation')
  .option('--print-background', 'Include background graphics')
  .option('--scale <n>', 'Scale factor (0.1-2.0)')
  .option('--paper <size>', 'Paper size: letter, a4, legal, tabloid')
  .action(async (opts) => {
    await run('POST', '/api/pdf', {
      output: opts.output,
      landscape: opts.landscape,
      printBackground: opts.printBackground,
      scale: opts.scale ? parseFloat(opts.scale) : undefined,
      paper: opts.paper,
    });
  });

// ---- emulate ----

program
  .command('emulate [action]')
  .description('Set device emulation')
  .option('--device <name>', 'Preset device name')
  .option('--width <n>', 'Viewport width')
  .option('--height <n>', 'Viewport height')
  .option('--scale <n>', 'Device scale factor')
  .option('--mobile', 'Enable mobile mode')
  .option('--touch', 'Enable touch emulation')
  .option('--user-agent <ua>', 'Override User-Agent')
  .option('--geolocation <lat,lng>', 'Override geolocation')
  .option('--media <feature=value>', 'Override CSS media feature')
  .option('--timezone <zone>', 'Override timezone')
  .option('--locale <locale>', 'Override locale')
  .action(async (action, opts) => {
    if (action === 'reset') {
      await run('POST', '/api/emulate', { action: 'reset' });
      return;
    }
    await run('POST', '/api/emulate', {
      device: opts.device,
      width: opts.width ? parseInt(opts.width, 10) : undefined,
      height: opts.height ? parseInt(opts.height, 10) : undefined,
      scale: opts.scale ? parseFloat(opts.scale) : undefined,
      mobile: opts.mobile,
      touch: opts.touch,
      userAgent: opts.userAgent,
      geolocation: opts.geolocation,
      media: opts.media,
      timezone: opts.timezone,
      locale: opts.locale,
    });
  });

// ---- perf ----

program
  .command('perf')
  .description('Get performance metrics')
  .action(async () => {
    await run('GET', '/api/perf', {});
  });

// ---- gif ----

const gifCmd = program
  .command('gif')
  .description('GIF recording');

gifCmd
  .command('start')
  .description('Start recording')
  .option('--max-frames <n>', 'Max frames before auto-stopping', '200')
  .action(async (opts) => {
    await run('POST', '/api/gif/start', {
      maxFrames: parseInt(opts.maxFrames, 10),
    });
  });

gifCmd
  .command('stop')
  .description('Stop recording')
  .action(async () => {
    await run('POST', '/api/gif/stop', {});
  });

gifCmd
  .command('export')
  .description('Export recorded frames as GIF')
  .option('--output <path>', 'Output file path')
  .option('--quality <n>', 'GIF quality 1-30', '10')
  .option('--show-clicks', 'Show click indicators')
  .option('--no-show-clicks', 'Hide click indicators')
  .option('--show-drags', 'Show drag paths')
  .option('--no-show-drags', 'Hide drag paths')
  .option('--show-labels', 'Show action labels')
  .option('--show-progress', 'Show progress bar')
  .option('--no-show-progress', 'Hide progress bar')
  .action(async (opts) => {
    await run('POST', '/api/gif/export', {
      output: opts.output,
      quality: parseInt(opts.quality, 10),
      showClicks: opts.showClicks,
      showDrags: opts.showDrags,
      showLabels: opts.showLabels,
      showProgress: opts.showProgress,
    });
  });

gifCmd
  .command('clear')
  .description('Discard recorded frames')
  .action(async () => {
    await run('POST', '/api/gif/clear', {});
  });

// ---- quick ----

program
  .command('quick <commands>')
  .description('Execute quick mode commands')
  .option('--no-screenshot', 'Skip final screenshot')
  .action(async (commands, opts) => {
    await run('POST', '/api/quick', {
      commands,
      noScreenshot: opts.screenshot === false,
    });
  });

// ---- config ----

program
  .command('config')
  .description('Show resolved configuration')
  .action(async () => {
    // Config is read locally, no proxy needed
    const { resolveConfig } = await import('../shared/config.js');
    const { detectChromePath, getChromeVersion, readPidFile, isProcessRunning } = await import('../proxy/chrome.js');
    const resolved = resolveConfig();
    const globals = getGlobalOpts();

    // Detect Chrome binary info
    const chromePath = (resolved.chromePath as any)?.value || detectChromePath();
    const chromeVersion = chromePath ? getChromeVersion(chromePath) : null;

    // Check proxy status
    const pidData = readPidFile();
    const proxyRunning = pidData ? isProcessRunning(pidData.pid) : false;

    // Check config file locations
    const { existsSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');
    const repoConfigPath = join(process.cwd(), '.claude', 'brw.json');
    const userConfigPath = join(homedir(), '.config', 'brw', 'config.json');
    const repoConfigFound = existsSync(repoConfigPath);
    const userConfigFound = existsSync(userConfigPath);

    if (globals.text) {
      process.stdout.write('Config resolution:\n');
      process.stdout.write(`  repo:       .claude/brw.json (${repoConfigFound ? 'found' : 'not found'})\n`);
      process.stdout.write(`  user:       ~/.config/brw/config.json (${userConfigFound ? 'found' : 'not found'})\n`);
      process.stdout.write('\nResolved config:\n');
      for (const [key, entry] of Object.entries(resolved)) {
        const { value, source } = entry as { value: unknown; source: string };
        const valStr = Array.isArray(value) ? value.join(', ') : String(value ?? 'null');
        process.stdout.write(`  ${key.padEnd(18)} ${valStr.padEnd(40)} (${source})\n`);
      }
      process.stdout.write(`\nProxy status:    ${proxyRunning ? `running (pid ${pidData!.pid}, port ${pidData!.port})` : 'not running'}\n`);
      process.stdout.write(`Chrome binary:   ${chromePath || 'not found'}\n`);
      process.stdout.write(`Chrome version:  ${chromeVersion || 'unknown'}\n`);
    } else {
      process.stdout.write(JSON.stringify({
        ok: true,
        config: resolved,
        proxy: proxyRunning
          ? { running: true, pid: pidData!.pid, port: pidData!.port }
          : { running: false },
        chrome: {
          path: chromePath || null,
          version: chromeVersion || null,
        },
        configFiles: {
          repo: { path: repoConfigPath, found: repoConfigFound },
          user: { path: userConfigPath, found: userConfigFound },
        },
      }, null, 2) + '\n');
    }
  });

// ---- server ----

const serverCmd = program
  .command('server')
  .description('Manage the proxy server');

serverCmd
  .command('start')
  .description('Start the proxy server')
  .option('--chrome-data-dir <path>', 'Chrome user data directory')
  .option('--headless', 'Run Chrome in headless mode')
  .action(async (opts) => {
    const globals = getGlobalOpts();
    const { startProxy } = await import('./proxy-launcher.js');
    try {
      const result = await startProxy(globals.port, opts.chromeDataDir, opts.headless, globals.debug);
      process.stdout.write(formatOutput(result, globals.text) + '\n');
    } catch (err: any) {
      const result = { ok: false, error: err?.message || 'Failed to start proxy', code: 'PROXY_START_FAILED' };
      process.stdout.write(formatOutput(result, globals.text) + '\n');
      process.exit(ExitCode.PROXY_ERROR);
    }
  });

serverCmd
  .command('stop')
  .description('Stop the proxy server')
  .action(async () => {
    const globals = getGlobalOpts();
    const { readPidFile, isProcessRunning } = await import('../proxy/chrome.js');
    const pidData = readPidFile();

    try {
      await proxyRequest('POST', '/shutdown', {}, globals.port, 5, globals.debug);
    } catch {
      // Server might already be dead
    }

    // Wait for process to actually exit
    if (pidData?.pid) {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && isProcessRunning(pidData.pid)) {
        await new Promise((r) => setTimeout(r, 100));
      }
      if (isProcessRunning(pidData.pid)) {
        try { process.kill(pidData.pid, 'SIGKILL'); } catch { /* ignore */ }
      }
    }

    process.stdout.write(formatOutput({ ok: true }, globals.text) + '\n');
  });

serverCmd
  .command('status')
  .description('Check proxy server status')
  .action(async () => {
    const globals = getGlobalOpts();
    try {
      const result = await proxyRequest('GET', '/health', {}, globals.port, 5, globals.debug);
      process.stdout.write(formatOutput({
        ok: true,
        running: true,
        pid: result.pid,
        port: result.port,
        chromeVersion: result.chromeVersion,
        uptime: result.uptime,
      }, globals.text) + '\n');
    } catch {
      process.stdout.write(formatOutput({ ok: true, running: false, pid: null, port: null, chromeVersion: null }, globals.text) + '\n');
      process.exit(ExitCode.USAGE_ERROR);
    }
  });

// Handle unknown commands
program.on('command:*', () => {
  process.stderr.write(`Unknown command: ${program.args.join(' ')}\nRun "brw --help" for usage.\n`);
  process.exit(ExitCode.USAGE_ERROR);
});

// Auto-create /tmp/brw symlink pointing to this script
(function autoSetupSymlink() {
  const symlinkPath = '/tmp/brw';
  const targetPath = __filename; // brw.js (has shebang, is executable)
  try {
    const { existsSync, readlinkSync, unlinkSync, symlinkSync } = require('fs');
    let needsCreate = true;
    if (existsSync(symlinkPath)) {
      try {
        const current = readlinkSync(symlinkPath);
        if (current === targetPath) needsCreate = false;
        else unlinkSync(symlinkPath);
      } catch {
        // Not a symlink or broken — remove and recreate
        try { unlinkSync(symlinkPath); } catch { /* ignore */ }
      }
    }
    if (needsCreate) {
      symlinkSync(targetPath, symlinkPath);
    }
  } catch {
    // Best-effort — don't fail the CLI if symlink creation fails
  }
})();

program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(`Error: ${err.message}\n`);
  process.exit(ExitCode.USAGE_ERROR);
});
