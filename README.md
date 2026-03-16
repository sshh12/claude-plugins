# claude-plugins

[![Blog](https://img.shields.io/badge/Blog-blog.sshh.io-blue?style=flat-square&logo=hashnode)](https://blog.sshh.io/)
[![GitHub](https://img.shields.io/badge/GitHub-sshh12-181717?style=flat-square&logo=github)](https://github.com/sshh12)
[![X](https://img.shields.io/badge/X-@ShrivuShankar-000000?style=flat-square&logo=x)](https://x.com/ShrivuShankar)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-shrivushankar-0A66C2?style=flat-square&logo=linkedin)](https://linkedin.com/in/shrivushankar)
[![Chat](https://img.shields.io/badge/Chat-Coffee%20Chat-orange?style=flat-square&logo=googlechat)](https://sshh.io/coffee-chat)

Shrivu's random Claude Code plugins.

## Install

```sh
/plugin marketplace add sshh12/claude-plugins
/plugin install <plugin-name>@shrivu-plugins
```

## Plugins

### [brw](https://github.com/sshh12/claude-plugins/tree/main/plugins/brw)

Full browser automation for Claude Code via Chrome DevTools Protocol. Navigate, click, type, screenshot, record GIFs, intercept network requests, and more — all from your terminal.

**Why brw?** Claude for Chrome is a black box that requires a subscription. Playwright MCP and Chrome DevTools MCP servers don't handle highly parallel agent workflows well — they weren't designed for multiple agents sharing one browser concurrently. brw is a lightweight proxy built for agent-first usage: stateless CLI, per-tab mutexes, and JSON output that agents can parse directly.

```
/plugin install brw@shrivu-plugins
```

Then use `/brw` to start browsing. The proxy auto-starts on first command and stays running. Key capabilities:
- **Navigate & interact**: click, type, scroll, drag, keyboard shortcuts
- **Read pages**: screenshots, DOM extraction, console logs, network traffic
- **Record**: GIF recordings of multi-step workflows
- **Multi-tab**: open, switch, and manage browser tabs
- **Security**: configurable URL blocking, protocol restrictions, cookie scoping

### [freetaxusa](https://github.com/sshh12/claude-plugins/tree/main/plugins/freetaxusa)

Tax filing automation for FreeTaxUSA.com. Guides you through filing US federal and state taxes by extracting your tax documents, researching current tax rules, and automating browser-based form filling via `brw`.

```
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

WhatsApp messaging for Claude Code via the Baileys WebSocket client. Send and receive messages, react, share media/locations/polls, search chat history, and long-poll for incoming messages — all restricted to an allowlist of approved contacts.

```
/plugin install whatsup@shrivu-plugins
```

Then use `/whatsup` to start. The proxy auto-starts on first command. Key capabilities:
- **Messaging**: send text, media, locations, polls, contact cards, reactions
- **Monitoring**: long-poll for incoming messages, read chat history, search messages
- **Profile**: set status text, update display name and picture
- **Security**: allowlist-only sends, rate limiting, audit logging, untrusted content tagging
- **Architecture**: same CLI + proxy pattern as brw — stateless CLI, persistent Fastify daemon, auto-start/stop