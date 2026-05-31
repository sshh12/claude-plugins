# brw Security Reference

## Threat Model

brw gives AI coding agents full browser control via Chrome DevTools Protocol. The primary threat is **prompt injection via web content**: a malicious page can contain hidden text that tricks the agent into reading local files (`file://`), stealing cookies/tokens from other domains, or accessing cloud metadata endpoints to exfiltrate credentials.

Secondary threats include: agents navigating to `javascript:` or `data:` URLs to execute arbitrary payloads, cross-domain cookie harvesting (page A tricks agent into dumping cookies from page B), and SSRF via cloud metadata endpoints (`169.254.169.254`) that expose IAM credentials on AWS/GCP/Azure.

brw mitigates these by blocking dangerous protocols and cloud metadata by default, scoping cookie access to the current domain, and providing a layered config system where user-level restrictions cannot be weakened by repo-level config.

**Important limitation**: brw's security controls only cover the browser attack surface. A malicious page can still embed hidden instructions that trick the AI agent into taking harmful actions *outside* the browser — such as running shell commands, writing files, or calling APIs via the agent's other tools. brw cannot prevent this because the prompt injection happens at the agent level, not the browser level. Defense in depth (sandboxed environments, restricted agent permissions, human-in-the-loop approval for sensitive actions) is essential.

## Transport Security

brw uses two private, port-less transports so that no debugging endpoint is ever exposed on the network:

- **CLI ↔ proxy** over a **per-user Unix domain socket** (default `~/.config/brw/proxy.sock`, mode `0600`). Because the socket lives in the user's home directory and is created with owner-only permissions, access is OS-enforced and isolated to that user — another local user account cannot connect to it. The socket path is configurable via `BRW_SOCKET`.
- **proxy ↔ Chrome** over **`--remote-debugging-pipe`** (CDP runs over inherited file descriptors between the proxy and the Chrome child process, with no listening port). The pipe is private to the proxy/Chrome process pair and is not reachable by any other process.

Earlier versions exposed the proxy and CDP over **loopback TCP ports** (e.g. `127.0.0.1`). A loopback port is reachable by *any* local user on the machine, so any other account could connect to the debugging endpoint and drive the browser or read its traffic. Removing the loopback TCP ports in favor of a `0600` Unix socket plus an inherited pipe removes that cross-local-user exposure entirely — there is no port for another user to connect to.

## Default Protections

Out of the box, brw applies these security defaults:

### Blocked Protocols

The following URL protocols are blocked by default:

| Protocol | Risk |
|----------|------|
| `file://` | Local file access (read `/etc/passwd`, SSH keys, env files) |
| `javascript:` | Arbitrary JS execution via navigation |
| `data:` | Inline HTML/JS execution, bypasses same-origin |
| `chrome://` | Access to browser internals and settings |
| `chrome-extension://` | Access to extension data and APIs |
| `view-source:` | Source code disclosure |
| `ftp://` | Legacy protocol, potential SSRF vector |

Override: `BRW_BLOCKED_PROTOCOLS=javascript,data` (comma-separated list replaces defaults). Use empty string `BRW_BLOCKED_PROTOCOLS=""` to allow all protocols.

### Blocked URLs

Cloud metadata endpoints are blocked by default:

- `*169.254.169.254*` — AWS/Azure instance metadata (IAM credentials)
- `*metadata.google.internal*` — GCP metadata (service account tokens)

Override: `BRW_BLOCKED_URLS=""` clears defaults. If you set `blockedUrls` in a config file, it replaces defaults entirely (you're responsible for your own blocklist).

### Cookie Domain Scoping

`cookies list` shows only cookies for the **current tab's domain** by default. This prevents a malicious page from tricking the agent into exfiltrating cookies from other sites.

- Use `--all-domains` flag to see all cookies explicitly
- Set `cookieScope: "all"` in config to default to showing all cookies

## Config Reference

### Security Config Keys

| Key | Env Var | Default | Description |
|-----|---------|---------|-------------|
| `blockedProtocols` | `BRW_BLOCKED_PROTOCOLS` | `file,javascript,data,chrome,chrome-extension,view-source,ftp` | URL protocols to block |
| `blockedUrls` | `BRW_BLOCKED_URLS` | `*169.254.169.254*,*metadata.google.internal*` | URL patterns to block (glob) |
| `allowedUrls` | `BRW_ALLOWED_URLS` | `*` | URL patterns to allow (glob allowlist) |
| `disabledCommands` | `BRW_DISABLED_COMMANDS` | `[]` | Commands to disable entirely |
| `cookieScope` | `BRW_COOKIE_SCOPE` | `tab` | Cookie list scope: `tab` or `all` |
| `auditLog` | `BRW_AUDIT_LOG` | `null` | Path to JSONL audit log file |
| `allowedPaths` | `BRW_ALLOWED_PATHS` | `null` (unrestricted) | File I/O path prefixes |

### Config Priority

Highest wins: **Environment variables** > **Repo config** (`.claude/brw.json`) > **User config** (`~/.config/brw/config.json`) > **Defaults**

### Config Lockdown Rules

- **allowedUrls**: If user config is restrictive (not `["*"]`), repo config cannot override it
- **blockedUrls**: Union of user + repo entries. Repo can only add blocked URLs
- **disabledCommands**: Union of user + repo entries. Repo can only add disabled commands
- **blockedProtocols**: Env var replaces everything; config file replaces defaults
- Environment variables (`BRW_*`) always take highest priority

## Recommended Configs

### Solo Developer (default)

No config needed. Default protections apply automatically.

### Corporate Environment

```json
{
  "allowedUrls": ["*.corp.com", "*.internal.example.com"],
  "blockedUrls": ["*admin*", "*169.254.169.254*", "*metadata.google.internal*"],
  "disabledCommands": ["intercept"],
  "auditLog": "/var/log/brw-audit.jsonl",
  "allowedPaths": ["/tmp", "/home/user/projects"]
}
```

### Strict Lockdown

```json
{
  "allowedUrls": ["https://specific-app.example.com"],
  "blockedUrls": ["*"],
  "disabledCommands": ["js", "script-run", "script-gen", "auth-tokens", "intercept", "cookies", "storage"],
  "auditLog": "/var/log/brw-audit.jsonl",
  "allowedPaths": ["~/.config/brw/screenshots"]
}
```

## Per-Command Security Notes

| Command | Security Implications |
|---------|----------------------|
| `navigate` | Subject to protocol blocklist and URL policy. Checks both before and after navigation. |
| `js` | Executes arbitrary JavaScript in page context. Post-execution URL check catches JS-based navigation to blocked protocols/URLs. |
| `script run` | Same execution surface as `js` but with a longer timeout (default 60s, max 600s) and helpers for reading cookies / decoding JWT-shaped values. Use `disabledCommands: ["script-run"]` to disable. The same post-execution URL check applies. |
| `script gen` | Read-only against the network buffer, but the **generated script file contains stripped header values verbatim** (Cookie, Authorization, csrf-tokens) as a reference block. Treat generated `.js` files as sensitive — don't paste them into shared issues / pastes. Use `disabledCommands: ["script-gen"]` to disable. |
| `auth-tokens` | Enumerates session cookies (incl. JWT contents with claims decoded), localStorage, sessionStorage, and captured Authorization headers. Output contains live credentials. With `--probe`, fires a request from the page context. Disable with `disabledCommands: ["auth-tokens"]` in environments where surfacing credentials in tool output is unacceptable. |
| `cookies` | Default: scoped to current tab domain. `--all-domains` reveals cross-domain cookies. |
| `storage` | Accesses localStorage/sessionStorage for the current page origin. |
| `network` / `network-request` / `network-body` | Read-only against the network buffer. `--full` and `network-request` surface captured request headers (incl. Cookie, Authorization). `--with-body-preview` returns response bodies (may include PII). |
| `intercept` | Can modify network responses. Powerful for testing but can be abused. Consider disabling in production. |
| `file-upload` | Uploads local files to the page. Subject to `allowedPaths` restriction. |
| `read-page` | Read-only, no security risk. |
| `screenshot` | Read-only, but screenshots may contain sensitive page content. |

## Environment Variables Quick Reference

```bash
# Protocol blocking (replaces default list)
BRW_BLOCKED_PROTOCOLS="javascript,data,chrome"

# URL blocking (replaces default list)
BRW_BLOCKED_URLS="*admin*,*169.254.169.254*"

# URL allowlist
BRW_ALLOWED_URLS="*.example.com"

# Disable commands
BRW_DISABLED_COMMANDS="js,intercept,cookies"

# Cookie scope
BRW_COOKIE_SCOPE="all"

# Audit log
BRW_AUDIT_LOG="/var/log/brw-audit.jsonl"

# File I/O restriction
BRW_ALLOWED_PATHS="/tmp,/home/user"
```
