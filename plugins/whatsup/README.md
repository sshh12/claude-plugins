# whatsup

WhatsApp MCP server for Claude Code. Inbound WhatsApp messages get pushed to Claude as `notifications/claude/channel` events; Claude replies via MCP tools. Built on [Baileys](https://github.com/WhiskeySockets/Baileys) (linked-device protocol — no Meta API, no Business API, no bot account).

## Requirements

- Node.js 18+
- A WhatsApp account on a phone (used to enter the pairing code or scan the QR)

## Install

```bash
/plugin marketplace add sshh12/claude-plugins
/plugin install whatsup@shrivu-plugins
```

Restart Claude Code so the plugin's MCP server (registered in `.mcp.json`) is picked up.

For local development:

```bash
cd plugins/whatsup
npm install
bash build.sh
claude --plugin-dir ./plugins/whatsup
```

## Architecture

```
Claude session A ─stdio─> mcp-server.js ┐
Claude session B ─stdio─> mcp-server.js ┤  one wins an atomic
Claude session C ─stdio─> mcp-server.js ┘  unix-socket listen()
                                  │
                     ┌────────────┴─────────────┐
                     │ OWNER process: the single │─Baileys WS─> WhatsApp
                     │ WhatsApp socket + sole     │
                     │ history writer + IPC server│
                     └────────────▲─────────────┘
                       unix socket │  others are PROXIES — forward tool
                                   │  calls, receive subscribed pushes
```

Every Claude Code session runs the same `dist/mcp-server.js`. They race an atomic Unix-domain-socket `listen()`: exactly one becomes the **owner** (holds the one WhatsApp connection, is the sole history writer, serves the rest over IPC); the others are thin **proxies**. No separate daemon to start, no HTTP, no idle timer — the owner role lives in-process. If the owner exits, a surviving session re-elects automatically on its next call. Live inbound messages are delivered only to sessions that called `subscribe` (so teammate agents that never opt in aren't spammed). A proxy's repo config can only ever *narrow* the owner's allowlist/limits, never widen them.

Inbound + outbound messages are persisted as JSONL at `~/.config/whatsup/messages.jsonl` (0600 perms). On each startup the server prunes entries older than `WHATSUP_HISTORY_RETENTION_DAYS` (default 90) and hydrates the last `WHATSUP_HISTORY_LOAD_LIMIT` (default 5000) entries into the in-memory buffer, so `read_chat` / `search` / `unreplied` survive restarts. Raw media protos are NOT serialized — `download_attachment` only works for media that arrived in the current session.

## Pairing

Two ways to link the device:

- **Phone pairing code (no QR, no GUI — recommended for headless hosts).** Call the `pair_request` tool (optionally set `WHATSUP_PAIR_PHONE` to your own number so it needs no argument and can't be aimed elsewhere). It returns an 8-character code; enter it on the phone under **WhatsApp → Settings → Linked Devices → Link a Device → "Link with phone number instead"**.
- **QR scan (fallback).** On first start the server also writes a QR to `/tmp/whatsup-qr.png` and emits a system channel notification with the path. Open the file and scan with **Link a Device**.

Either way, the server reports `connected: true` via the `status` tool and credentials persist to `~/.config/whatsup/auth/` (0700/0600).

## Recovery & out-of-band alerts

A dying WhatsApp link is the one thing WhatsApp itself can't tell you about, so the server has a WhatsApp-independent path and a guarded recovery flow:

- **`reconnect` is guarded.** It refuses to reconnect when the link was taken over with a **401 auth conflict** (`status.replacedCode: 401`) — that path could cascade into a full credential deauth — unless you pass `force: true`. A user-initiated reconnect never silently wipes credentials; a 401 during the reconnect window preserves them in place and sets `needsRepair`. Plain 440 replacements stay safe to retake.
- **`restore_credentials`** self-heals a spurious deauth by restoring the newest `auth.bak.*` backup and reconnecting — no re-pair needed.
- **`alert`** (and, on deauth/pairing/replaced/gave-up events, the server automatically) POSTs to `WHATSUP_ALERT_WEBHOOK_URL` — point it at Pushover / ntfy / Slack / an email relay / a phone push so you're reachable when the channel is down.
- **`WHATSUP_AUTO_REPAIR=true`** (with `WHATSUP_PAIR_PHONE` set) makes a genuine deauth auto-issue a pairing code and push it out-of-band, so the operator can re-link from their phone without touching the host.
- **`health`** returns a one-call send-path + receive-path + auth report.

## Allowlist

Outbound sends are restricted to allowlisted contacts. **Empty allowlist = all sends blocked** (safe default).

```bash
export WHATSUP_ALLOWLIST="+18005551234,+447911123456"
export WHATSUP_ALLOWLIST_GROUPS="120363041234567890@g.us"
```

Or in `~/.config/whatsup/config.json`:

```json
{
  "allowlist": ["+18005551234", "+447911123456"],
  "allowlistGroups": ["120363041234567890@g.us"]
}
```

Phone numbers are E.164 (country code, `+` prefix). Restart Claude Code so the MCP server re-reads config.

## MCP tools

| Tool | What it does |
|---|---|
| `reply` | Send text and/or files to a chat. Required `chat_id`; optional `text`, `reply_to`, `files`. |
| `react` | Add or clear an emoji reaction. |
| `edit_message` | Edit a message this account previously sent. |
| `download_attachment` | Fetch an inbound media attachment to disk. |
| `status` | Connection state, phone, pushName, QR path / pending `pairingCode`, recovery flags (`needsRepair`, `deauthRisk`, `replacedByOtherInstance`, `replacedCode`), reconnect diagnostics, `lastHistorySync`, `alertChannelConfigured`, and this session's `role` (`owner`/`proxy`) + `ownerPid`. |
| `reconnect` | Force a fresh WhatsApp socket (optional `force`). Safe for ordinary drops and `replacedCode: 440`; **refuses** `replacedCode: 401` (deauth risk) unless forced. |
| `pair_request` | Link with an 8-char phone pairing code (no QR/GUI). Optional `phone`, locked to `WHATSUP_PAIR_PHONE` when set. |
| `pair_status` | Poll an in-progress pairing (current code, creds, connection state). |
| `restore_credentials` | Self-heal a spurious deauth from the newest credential backup, then reconnect. |
| `health` | One-call send-path + receive-path + auth health. Read-only. |
| `alert` | Send `text` to the operator over the WhatsApp-independent webhook. |
| `subscribe` / `unsubscribe` | Opt this session in/out of live inbound message delivery. Call `subscribe` once after `status` if this agent handles WhatsApp; survives owner handoff. |
| `unreplied` | Inbound messages received this session not yet replied to. |
| `list_chats` | Recent chats with timestamps + unread counts. |
| `read_chat` | Recent buffered messages for a chat. |
| `search` | Substring search across the in-memory buffer. |
| `contacts` | List/search the contact cache. |

## Channel notification format

Inbound messages arrive with this shape:

```jsonc
{
  "method": "notifications/claude/channel",
  "params": {
    "content": "<untrusted_user_message>hi from alice</untrusted_user_message>",
    "meta": {
      "chat_id": "18005551234@s.whatsapp.net",
      "message_id": "3EB0...",
      "user": "Alice",
      "user_id": "18005551234@s.whatsapp.net",
      "ts": "2026-05-16T17:42:00.000Z",
      "chat_type": "dm",
      "attachment_kind": "image",       // when message had media
      "attachment_file_id": "3EB0...",  // pass to download_attachment
      "reply_to_id": "3EA0..."          // when quoting another message
    }
  }
}
```

Claude replies by calling the `reply` tool with the same `chat_id`. Anything not passed through `reply` (transcript, plain text, tool results) does **not** reach the sender.

## Security defaults

| Control | Default |
|---|---|
| Outbound allowlist | Empty (everything blocked) |
| Inbound `readMode` | `allowlist` (non-allowlisted DMs filtered out) |
| Per-contact send rate | 30/min |
| Total send rate | 100/min |
| Audit log | `~/.config/whatsup/audit.jsonl` (0600) |
| Auth file perms | dir 0700, files 0600 |
| Untrusted-content wrapping | All inbound text wrapped in `<untrusted_user_message>` |

Details and threat model in [`skills/whatsup/references/SECURITY.md`](skills/whatsup/references/SECURITY.md).

## Config knobs

Resolution order: env > user config (`~/.config/whatsup/config.json`) > repo config (`.claude/whatsup.json`, security-narrowed) > defaults.

| Env var | Default | Notes |
|---|---|---|
| `WHATSUP_ALLOWLIST` | `""` | Comma-separated E.164. |
| `WHATSUP_ALLOWLIST_GROUPS` | `""` | Comma-separated group JIDs. |
| `WHATSUP_READ_MODE` | `allowlist` | `allowlist` or `all`. |
| `WHATSUP_RATE_LIMIT_PER_CONTACT` | 30 | Per-minute per-contact send cap. |
| `WHATSUP_RATE_LIMIT_TOTAL` | 100 | Per-minute global send cap. |
| `WHATSUP_MEDIA_DOWNLOAD_DIR` | `/tmp/whatsup-media` | `download_attachment` output. |
| `WHATSUP_QR_CODE_FILE` | `/tmp/whatsup-qr.png` | Fallback pairing QR path. |
| `WHATSUP_PAIR_PHONE` | `""` | Operator's own WhatsApp number (digits). Locks `pair_request`; enables auto-repair. Locked from repo config. |
| `WHATSUP_ALERT_WEBHOOK_URL` | `""` | Secondary out-of-band channel: `alert` + deauth/pairing pushes POST here. Locked from repo config. |
| `WHATSUP_AUTO_REPAIR` | `false` | On genuine deauth, auto-issue a pairing code and push it out-of-band (needs `WHATSUP_PAIR_PHONE`). Locked from repo config. |
| `WHATSUP_AUTH_DIR` | `~/.config/whatsup/auth` | Baileys auth state. |
| `WHATSUP_LOG_FILE` | `/tmp/whatsup-proxy.log` | Server log. |
| `WHATSUP_AUDIT_LOG` | `~/.config/whatsup/audit.jsonl` | Audit JSONL. |
| `WHATSUP_MAX_MEDIA_SIZE` | 67108864 (64 MB) | Max attachment bytes. |
| `WHATSUP_MESSAGE_BUFFER_SIZE` | 500 | In-memory message ring buffer. |
| `WHATSUP_AUTO_RECONNECT` | `true` | Reconnect on socket drop. |
| `WHATSUP_DISABLED_COMMANDS` | `""` | Comma-separated tool names to disable. |
| `WHATSUP_HISTORY_FILE` | `~/.config/whatsup/messages.jsonl` | Persistent JSONL message log. Hydrated into the buffer on startup. |
| `WHATSUP_HISTORY_RETENTION_DAYS` | 90 | Drop entries older than this on startup. |
| `WHATSUP_HISTORY_LOAD_LIMIT` | 5000 | Number of recent entries to hydrate into the buffer on startup. |

## Docs

- **Skill / in-context guidance**: [`skills/whatsup/SKILL.md`](skills/whatsup/SKILL.md)
- **Onboarding**: [`skills/whatsup/references/ONBOARDING.md`](skills/whatsup/references/ONBOARDING.md)
- **Security & threat model**: [`skills/whatsup/references/SECURITY.md`](skills/whatsup/references/SECURITY.md)

## License

MIT
