# diy-mcp-connector

Turn any web app into a set of tools that Claude can call directly — no browser automation, no screenshots, no copy-pasting between tabs.

This is a skill you run in **Claude Code**. It builds connectors that work with **Claude Code**, **Claude Desktop (Cowork)**, and **any other MCP-supporting application**.

## The problem

You use web apps every day — recipe sites, banking dashboards, fitness trackers, hobby forums, project boards, whatever. When you want Claude to help with data from these apps, your options today are bad:

| Approach | What happens |
|----------|-------------|
| **Nothing** | You copy-paste between Claude and the app. Slow, error-prone, context lost between messages. |
| **Browser tools** (Chrome DevTools MCP, Claude for Chrome, brw, Playwright, etc.) | Claude navigates the UI like a human: screenshot, read page, click, wait, screenshot again. Each page costs ~3,000-5,000 tokens. A 5-step workflow burns 15,000+ tokens just on navigation and breaks when the UI changes. |
| **Existing MCP connectors** | Pre-built connectors exist for some apps, but they're often stale, too generic (50 endpoints when you need 5), don't handle your login flow, or simply don't exist for the app you care about. |

## What a connector is

A **connector** is a small server that sits between Claude and a web app's API. Instead of Claude clicking through pages in a browser, it calls purpose-built tools that talk to the API directly and return clean data:

```
Claude ──→ recipes_search({ query: "weeknight pasta" }) ──→ App API ──→ structured results back
```

vs.

```
Claude ──→ screenshot ──→ read page ──→ click search ──→ type query ──→ screenshot ──→ parse results...
```

One tool call replaces 4-6 browser steps. Typical savings: **~80% fewer tokens** and **~10x faster** for the same task.

## What this skill does

This skill walks Claude through building a connector for any app you choose. You don't write the code — Claude does, guided by a 9-stage workflow with security reviews and testing built in. The result is a server that:

- **Uses your existing login** — you sign in through Chrome once, and the connector remembers your session. No developer API keys or special setup for most apps.
- **Claude gets real data, not pixels** — instead of taking screenshots and guessing what's on screen, Claude gets the actual numbers, names, and dates back. Fewer mistakes, faster answers.
- **Won't break things** — connectors are read-only by default. Claude can look up your data but can't accidentally delete or change anything.
- **Built for how you use the app** — not a firehose of every possible feature. Just the 3-7 things you actually want Claude to help with.

## Example

> "Build a connector for my recipe app so I can search recipes and pull ingredient lists into Claude"

Claude records the app's API traffic, designs tools around your workflows, reviews them for security, builds the server, tests it, and hooks it into Claude Code. You end up with tools like:

- `recipes_search` — find recipes by ingredient, cuisine, or prep time
- `recipes_get_recipe` — full recipe with ingredients, steps, and nutrition
- `recipes_get_meal_plan` — this week's planned meals in one call

Each returns structured data. No screenshots, no waiting for pages to load.

## Install

```sh
/plugin marketplace add sshh12/claude-plugins
/plugin install diy-mcp-connector@shrivu-plugins
```

## Usage

Tell Claude which app you want to connect:

> "I want to connect my Goodreads to Claude Code so I can search my bookshelves and track what I'm reading"

The skill activates and walks through 9 stages:

1. **Capture** — Record API traffic via HAR files or live browser exploration (Claude for Chrome, brw, Playwright, or Chrome DevTools MCP — auto-detected)
2. **Analyze** — Map endpoints, auth patterns, and data shapes
3. **Design** — Plan 3-7 tools matching your workflows (you review before building)
4. **Security** — Every tool reviewed against a 6-point checklist before code is written
5. **Build** — Generate the server using battle-tested templates for auth and response handling
6. **Auth** — Verify login flow works end-to-end
7. **Test** — Automated tests plus real Claude CLI pressure testing
8. **Optimize** — Tune tool descriptions and response sizes, estimate token savings vs browser
9. **Connect** — Hook into Claude Code, Claude Desktop/Cowork, OpenClaw, or any MCP client

## What you get

A self-contained folder for your app:

- **`server/`** — The connector itself. A main file with your tools (`index.js`), plus shared modules that handle login (`auth.js`), response formatting (`output.js`), and optionally GraphQL or CSRF support if the app needs them.
- **`har/`** — The API recordings from the discovery phase, kept around for reference.
- **`test/`** — A test script so you can verify any tool with one command.
- **`scripts/`** — The HAR analyzer, in case you want to re-examine the API later.

Run `node server/index.js` and it handles everything — logging in via Chrome, caching your session, formatting responses, saving large outputs to files. No external services, no API keys for most apps.

The connector works with Claude Code (via `claude mcp add`), Claude Desktop/Cowork (via `.mcpb` extension or config file), OpenClaw (via `openclaw mcp set`), or any application that supports MCP servers.

> **"Won't too many MCP tools slow things down?"**
>
> This used to be a real concern — early MCP clients loaded every tool definition into the prompt on every message, so 50 tools meant thousands of wasted tokens before Claude even started thinking.
>
> That's no longer the case. Claude Code, Cowork, and other modern MCP clients use **tool querying** and **programmatic tool calling**, meaning tools are only loaded when relevant to the current task. Having 10 connectors with 5 tools each is no different from having one — the client fetches what it needs, when it needs it.
>
> Build connectors for everything you use. MCP away.
