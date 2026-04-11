---
name: diy-mcp-connector
description: >-
  Builds a dedicated MCP server for a single web app by walking through
  API discovery, tool design, security review, implementation, testing,
  and deployment. Use when the user asks to create an MCP server, connect
  a web app to Claude Code, or build a tool integration for any web app.
---

## Overview

This skill runs in Claude Code and builds a standalone MCP server that turns one web app's API into purpose-built tools. The connector you build works with Claude Code, Claude Desktop (Cowork), and any other MCP-supporting application. The result is a Node.js server that handles authentication, response formatting, and tool routing — one dedicated server per app.

**All 9 stages are mandatory. Complete each in order — do not skip ahead.** Each stage has a gate condition that must be met before proceeding.

**Stages can loop.** Auth or API issues discovered in Stages 6-7 may require returning to Stage 2 to reclassify the app type, then re-running Stages 5-7. This is expected — the linear numbering is the happy path, not a one-way gate.

## Prerequisites

- **Node.js 18+** and **npm**
- **Python 3** (for HAR analysis script)
- **Google Chrome** (for auto-login via CDP)
- **`@modelcontextprotocol/sdk`** npm package (installed during build)
- **Optional (for live exploration):** Claude for Chrome, brw, Playwright MCP, or Chrome DevTools MCP — any browser MCP server enables live API discovery instead of manual HAR capture

## Getting Started

1. Ask the user which web app they want to connect
2. Detect available browser tools (`claude mcp list`) — see `references/1-capture-api.md` for the detection table and preference order
3. If no browser tools found, ask if they have HAR files or want to set up a browser tool (Claude for Chrome is the easiest)
4. Create the project directory: `<app>/`
5. Copy the analyze script: `cp "${SKILL_DIR}/scripts/analyze-har.py" <app>/scripts/`

---

## Stage 1: Capture API Surface

See `references/1-capture-api.md`

- [ ] If api-key-auth with documented API: skip HAR, document endpoints from docs/existing code
- [ ] Otherwise: detect available browser tools via `claude mcp list`
- [ ] Choose capture method: HAR files, live exploration (using detected tool), or both
- [ ] Capture API traffic across all major app sections (not just one page)
- [ ] Save HAR to `<app>/har/<app>.har` (if using HAR method)

**Gate:** At least one HAR file saved, endpoint list documented from live exploration, or endpoint inventory from API docs. Do not proceed without this.

---

## Stage 2: Analyze API Surface

See `references/2-analyze-api.md`

- [ ] Run HAR analysis: `python3 scripts/analyze-har.py har/<app>.har --domain <domain>`
- [ ] For GraphQL apps: `python3 scripts/analyze-har.py har/<app>.har --graphql --extract`
- [ ] Classify auth pattern (api-key-auth, cookie-auth, spa-token-auth, or hybrid) — see fingerprinting table in reference
- [ ] If split API detected (browser uses different domains than public API): present tradeoff and get user choice before proceeding
- [ ] If api-key-auth: load `references/patterns/api-key-auth.md`
- [ ] If spa-token-auth: load `references/patterns/spa-token-auth.md`
- [ ] If GraphQL allowlisting detected: load `references/patterns/graphql-allowlist.md`
- [ ] If SDUI response shapes detected: load `references/patterns/sdui.md`
- [ ] Identify response format (JSON, HTML, mixed)
- [ ] Identify search/filter API behavior
- [ ] Document endpoint inventory with response shapes

**Gate:** Endpoint inventory with auth classification and response shapes documented. Do not proceed without this.

---

## Stage 3: Design Tools

See `references/3-design-tools.md`

- [ ] Design 3–7 tools following Anthropic's tool engineering guide
- [ ] Consolidate related API calls into user-workflow tools
- [ ] Evaluate batch/multi-tool pattern for common multi-step workflows
- [ ] Namespace tools by app: `<app>_<action>`
- [ ] Spawn Opus subagent to brainstorm 10-15 realistic user prompts and identify coverage gaps (see reference)
- [ ] Adjust design for any significant gaps found
- [ ] Present tool design table to user and get feedback
- [ ] Incorporate feedback

**Gate:** User has reviewed and approved the tool design table. Do not start building until this is done.

---

## Stage 4: Security Review (Subagent)

See `references/4-security-review.md`

- [ ] Write tool design from Stage 3 to `<app>/security-review/tool-design.md`
- [ ] Spawn Opus security-reviewer subagent with the 7-point checklist (prompt template in reference)
- [ ] Subagent writes findings to `<app>/security-review/findings.md`
- [ ] Read findings — if CRITICAL issues exist, fix the tool design and re-run the subagent (loop until clean)
- [ ] Present final findings to user
- [ ] If write tools requested: present risk assessment and get explicit user confirmation

**Gate:** Security reviewer subagent reports no CRITICAL issues (or user explicitly accepts remaining risks). Findings shown to user. **Await the subagent's completion before starting Stage 5** — do not run the security review in the background while building.

---

## Stage 5: Build

See `references/5-build.md`

- [ ] Copy template scripts from `"${SKILL_DIR}/scripts/"`:
  - Always: `server.js`, `auth.js`, `output.js`
  - If GraphQL: also `graphql.js`
  - If CSRF-protected (Rails/Django/etc.): also `csrf.js`
  - Always: `test-tool.sh` → `test/test-tool.sh`
- [ ] Create `server/index.js`: META + APP_TOOLS + handleTool + `await startServer(...)` (see reference for contract)
- [ ] Implement tool handlers using `auth.authFetch` and `output.buildResponse`
- [ ] Generate `package.json` with `type: "module"` and dependencies
- [ ] Run `npm install`

- [ ] Run Stage 5.5 auth smoke test (single authenticated API call before writing all handlers)

**Gate:** `printf '...' | node server/index.js` starts without errors via stdio.

---

## Stage 6: Auth Verification

See `references/6-auth-verification.md`

- [ ] If api-key-auth: verify valid key works, missing key errors clearly, invalid key errors clearly
- [ ] If cookie-auth: fresh login test, cookie reuse test, auth failure recovery test
- [ ] App-specific auth test (GraphQL null-data, CSRF invalidation) if applicable

**Gate:** All auth tests pass for the app's auth classification.

---

## Stage 7: Test (Parallel Subagents)

See `references/7-test.md`

- [ ] Create `test/.mcp-test.json` config pointing to `server/index.js`
- [ ] Spawn test subagents in parallel (single message, multiple Agent calls):
  - **stdio-tester**: Run `test/test-tool.sh` for every tool + `--list`, report pass/fail per tool
  - **consistency-checker**: Verify every name in `APP_TOOLS` has a matching `handleTool` case and vice versa
  - **pressure-tester**: Claude CLI pressure tests across 4 categories (happy path, edge cases, multi-tool, wrong-tool)
- [ ] Aggregate results from all subagents into `<app>/test/results.md`
- [ ] Evaluate: accuracy, tool call count, token usage, error frequency

**Gate:** All subagents report pass. Aggregated results reported to user.

---

## Stage 8: Optimize

See `references/8-optimize.md`

- [ ] Review Claude CLI logs against symptom-fix table
- [ ] Adjust tool descriptions, schemas, response sizes
- [ ] Estimate token savings: MCP tools vs browser automation for common tasks
- [ ] Iterate: redesign → rebuild → retest until stable

---

## Stage 9: Package & Connect

See `references/9-package-connect.md`

- [ ] Ask user for permission to install, and confirm scope (local/user/project) — see reference for scope guidance
- [ ] **Proactively ask the user** if they'd also like to connect to other MCP clients (Cowork, OpenClaw, Claude Desktop, etc.) — don't assume one target is enough
- [ ] For each additional target the user wants, follow the corresponding setup in the reference
- [ ] Configure env vars as needed (leave `ALLOW_INLINE_LARGE` off for Claude Code and Cowork — they support file URIs)
- [ ] Verify: tools appear in tool list and respond correctly in each connected client

**Gate:** Tools appear in at least one client and return correct data. User has been offered and had the chance to set up additional clients.

---

## Stage 10: Challenges & Feedback (Optional)

See `references/10-challenges-feedback.md`

After Stage 9 is complete, offer to generate a `<app>/<APP>_DEVELOPER_FEEDBACK.md` report documenting issues encountered during the build — auth quirks, API surprises, workarounds, and what generalizes to other apps. This is optional but valuable for the user's future reference and for improving the skill.

- [ ] Ask: *"Would you like me to generate a challenges report for the issues we hit during this build?"*
- [ ] If yes: review the full session, write `<app>/<APP>_DEVELOPER_FEEDBACK.md` following the report structure in the reference
- [ ] Ask if any challenges feel like something the skill should handle better out of the box

---

## Generated Server Layout

```
<app>/
├── package.json              # type: "module", deps: @modelcontextprotocol/sdk, ws
├── server/
│   ├── index.js              # META + APP_TOOLS + handleTool + startServer()
│   ├── server.js             # MCP harness: built-in tools, wiring, error handling
│   ├── auth.js               # Cookie persistence + Chrome CDP auto-login
│   ├── output.js             # Response builder + set_output_dir
│   ├── graphql.js            # GraphQL client with auth retry (if needed)
│   └── csrf.js               # CSRF token manager (if needed)
├── har/                      # HAR files from API discovery
├── scripts/
│   └── analyze-har.py        # HAR analysis tool
├── test/
│   ├── test-tool.sh          # Parameterized stdio test runner
│   └── .mcp-test.json        # Claude CLI test config
└── .gitignore
```

## Built-in Tools

Every generated server includes these tools automatically (not app-specific):

- **`set_output_dir`** — Change where large responses are saved as files. Call at session start with `<working_dir>/<app-name>/` (not the bare working directory — avoid cluttering the project root). Returns the resolved path.
- **`<app>_debug_env`** — Dumps safe server environment info (Node version, output dir, config). Only available when `INCLUDE_DEBUG_TOOLS=true` (off by default). Uses an allowlist — never exposes API keys or tokens.

## Inline Config

**`ALLOW_INLINE_LARGE`** env var (default: `"false"`):

- **When off (default):** The `inline` parameter is omitted from tool schemas — the agent never sees it. Large responses always go to files. The agent uses `set_output_dir` to control where files are written.
- **When on:** The `inline` parameter appears on every app tool. The agent can force large responses inline by passing `inline: true`.

**When to enable:** Set `ALLOW_INLINE_LARGE=true` in environments where the client cannot follow `resource_link` URIs — e.g., Claude Chat (web), non-sandboxed environments, or clients that don't have filesystem access.

## Bundled Scripts

| Script | Type | When to copy | Usage |
|--------|------|-------------|-------|
| `analyze-har.py` | Executable | To `scripts/` (always) | `python3 scripts/analyze-har.py har/<app>.har --domain <domain>` |
| `server.js` | Template | To `server/` (always) | MCP harness: built-in tools, wiring, error handling |
| `auth.js` | Template | To `server/` (always) | Cookie persistence + Chrome CDP auto-login |
| `output.js` | Template | To `server/` (always) | Response builder with `set_output_dir` |
| `graphql.js` | Template | To `server/` (if GraphQL) | `createGraphQLClient()` with auth-failure retry |
| `csrf.js` | Template | To `server/` (if CSRF) | `createCsrfManager()` with 422 retry |
| `test-tool.sh` | Executable | To `test/` (always) | `./test/test-tool.sh <tool-name> [json-args]` |

After copying templates, call `auth.init(META.app)` and `output.init(META.app)` in `server/index.js` to set cookie and output directories.

## Key Principles

- **Read-only by default** — only build write tools if explicitly requested and after risk assessment
- **Cookie isolation** — each app stores cookies at `~/.diy-mcp/<app>/cookies/` with `0o600` permissions
- **Response size guidelines** — inline <8KB, auto-file >8KB, always-file >50KB (transcripts, docs, exports)
- **Browser headers** — all requests include browser-like headers to avoid Cloudflare 403/1010 errors
- **`console.error` only** — stdout is the MCP protocol channel; all logging goes to stderr
- **Gotchas are inline** — Cloudflare headers, GraphQL pitfalls, CSRF, and HTML parsing are documented in the stage where they apply (mostly `5-build.md`), not in a separate file
