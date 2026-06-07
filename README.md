# claude-plugins

[![Blog](https://img.shields.io/badge/Blog-blog.sshh.io-blue?style=flat-square&logo=hashnode)](https://blog.sshh.io/)
[![GitHub](https://img.shields.io/badge/GitHub-sshh12-181717?style=flat-square&logo=github)](https://github.com/sshh12)
[![X](https://img.shields.io/badge/X-@ShrivuShankar-000000?style=flat-square&logo=x)](https://x.com/ShrivuShankar)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-shrivushankar-0A66C2?style=flat-square&logo=linkedin)](https://linkedin.com/in/shrivushankar)
[![Chat](https://img.shields.io/badge/Chat-Coffee%20Chat-orange?style=flat-square&logo=googlechat)](https://sshh.io/coffee-chat)

Shrivu's random Claude Code plugins.

## Plugins

### [brw](https://github.com/sshh12/claude-plugins/tree/main/plugins/brw)

Full browser automation for Claude Code via Chrome DevTools Protocol. Navigate, click, type, screenshot, record GIFs, intercept network requests, and more — all from your terminal.

**Why brw?** Claude for Chrome is a black box that requires a subscription. Playwright MCP and Chrome DevTools MCP servers don't handle highly parallel agent workflows well — they weren't designed for multiple agents sharing one browser concurrently. brw is a lightweight proxy built for agent-first usage: stateless CLI, per-tab mutexes, and JSON output that agents can parse directly.

```
/plugin marketplace add sshh12/claude-plugins
/plugin install brw@shrivu-plugins
```

Then use `/brw` to start browsing. The proxy auto-starts on first command and stays running. Key capabilities:
- **Navigate & interact**: click, type, scroll, drag, keyboard shortcuts
- **Read pages**: screenshots, DOM extraction, console logs, network traffic
- **Record**: GIF recordings of multi-step workflows
- **Multi-tab**: open, switch, and manage browser tabs
- **Script-driven extraction**: capture the app's own XHRs and replay them as a `.js` script that uses the user's existing session — paginate inboxes, export history, scrape behind login without clicking through the UI
- **Security**: configurable URL blocking, protocol restrictions, cookie scoping

### [freetaxusa](https://github.com/sshh12/claude-plugins/tree/main/plugins/freetaxusa)

Tax filing automation for FreeTaxUSA.com. Guides you through filing US federal and state taxes by extracting your tax documents, researching current tax rules, and automating browser-based form filling via `brw`.

```
/plugin marketplace add sshh12/claude-plugins
/plugin install freetaxusa@shrivu-plugins
```

Then use `/freetaxusa` to start. The skill walks through 5 phases:
- **Setup**: Explains risks, legal disclaimers, loads browser automation, gets consent
- **Discovery**: Extracts text and images from your PDFs (W-2s, 1099s, etc.), builds a consolidated summary, front-loads all questions
- **Research**: Fetches current-year tax brackets and rules, runs a life-change questionnaire, flags items that may need a CPA
- **Filing**: Fills FreeTaxUSA forms section by section with a 4-source verification table (expected, entered, page read, screenshot)
- **Review**: Generates a personalized HTML tax breakdown report, walks through a review checklist, creates a data purge reminder

**Not a tax professional. Not tax advice.** The user reviews and submits their return themselves — the skill never auto-submits.

### [whatsup](https://github.com/sshh12/claude-plugins/tree/main/plugins/whatsup)

WhatsApp **MCP server** for Claude Code via the Baileys WebSocket client. Inbound WhatsApp messages get pushed to Claude as `notifications/claude/channel` events; Claude responds with the `reply` tool. Bidirectional, no polling, no CLI.

```
/plugin marketplace add sshh12/claude-plugins
/plugin install whatsup@shrivu-plugins
```

Restart Claude Code, then ask it to call the `status` tool — first run surfaces a QR file for **WhatsApp → Settings → Linked Devices → Link a Device**. Key capabilities:
- **Bidirectional**: messages from allowlisted contacts arrive as channel notifications; Claude replies via the `reply` MCP tool
- **Tool surface**: `reply`, `react`, `edit_message`, `download_attachment`, `status`, `unreplied`, `list_chats`, `read_chat`, `search`, `contacts`
- **Security**: allowlist-only sends (empty = blocked), per-contact + global rate limits, `<untrusted_user_message>` wrapping on inbound text, audit logging
- **Architecture**: single MCP stdio process — no daemon, no HTTP, lifetime tied to the Claude Code session

### [diy-mcp-connector](https://github.com/sshh12/claude-plugins/tree/main/plugins/diy-mcp-connector)

Turn any web app into a set of tools that Claude can call directly — no browser automation, no screenshots, no copy-pasting between tabs. Instead of Claude navigating a UI like a human (screenshot, click, wait, screenshot again), your connector talks to the app's API and returns clean, structured data. One tool call replaces 4-6 browser steps with ~80% fewer tokens and ~10x faster responses.

```
/plugin marketplace add sshh12/claude-plugins
/plugin install diy-mcp-connector@shrivu-plugins
```

Then tell Claude which app you want to connect — "I want to connect my recipe app so I can search recipes and pull ingredient lists into Claude." The skill walks through 9 stages: capturing API traffic, designing tools around your workflows, security review, building the server, testing, and connecting it to your MCP client. You don't write the code — Claude does.

- **Uses your existing login** — sign in through Chrome once and the connector remembers your session
- **API discovery** — auto-detects browser tools you have (Claude for Chrome, brw, Playwright) for live exploration, or works with manual HAR file captures
- **Read-only by default** — Claude can look up your data but can't accidentally change anything
- **Works everywhere** — Claude Code, Claude Desktop/Cowork, OpenClaw, or any MCP client

### [cc-essentials](https://github.com/sshh12/claude-plugins/tree/main/plugins/cc-essentials)

Meta-skills for working with Claude Code itself.

```
/plugin marketplace add sshh12/claude-plugins
/plugin install cc-essentials@shrivu-plugins
```

- **`build-skill`** — walks you through building a project skill end-to-end: problem framing, data mapping, SKILL.md, testing on real tasks, and committing it to the repo.
- **`build-agent-team`** — designs a long-running, autonomous agent team for the current project and writes a `/start-<team>-team` skill that spawns it. Loop-based role design, mandatory leader + auditor, comms protocol, and reward-hacking review passes baked in. Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

### [windows-computer-use](https://github.com/sshh12/claude-plugins/tree/main/plugins/windows-computer-use)

Full **computer use for Windows** as an MCP server — multi-monitor screen capture, native keyboard/mouse input, video recording, and a game/app play-test loop. Claude drives the actual Windows desktop: open apps, click, type, see the screen, and play-test software.

**Why?** Anthropic's official computer use in the Claude Code CLI is a macOS-only research preview (Pro/Max, interactive sessions only — not `-p`). There's no official, non-Desktop computer-use for Windows. This server fills that gap: a standard MCP server that works on Windows in Claude Code (interactive *and* headless `-p`), Claude Desktop, or any MCP client — with real multi-monitor capture, per-window GPU capture, scan-code input that games respond to, and play-testing. Runs on the machine it controls, so it reads the actual displays rather than requesting a resolution.

```
/plugin marketplace add sshh12/claude-plugins
/plugin install windows-computer-use@shrivu-plugins
```

First run bootstraps a Python venv and installs the server from GitHub, then it auto-starts. Key capabilities:
- **See**: the whole desktop, a specific monitor, or a single window (even occluded / GPU-composited) — downscaled inline, with the coordinate frame for subsequent clicks
- **Do**: batched `act` — click, type, scroll, drag, keyboard shortcuts; scan-code keys and relative mouse so games respond
- **Read without screenshots**: `window get_text` / `ui_tree` / `click_element` via UI Automation (~10x fewer tokens than a screenshot)
- **Record & play-test**: capture a clip as a timestamped frame montage + mp4; drive a timed input script at a cadence while recording, with telemetry-driven early stop
- **Process & readiness**: launch apps/URLs/Store apps, wait for a window or file, run shell commands
- **Multi-monitor + DPI aware**: reads the real displays; targets `display:0` / `display:primary|left|right`