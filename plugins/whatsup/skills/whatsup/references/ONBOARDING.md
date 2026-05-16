# whatsup — First-time setup

## Prerequisites

- Node.js 18+
- A WhatsApp account on a phone (used to scan the pairing QR)

## Step 1: Install the plugin

```bash
/plugin marketplace add sshh12/claude-plugins
/plugin install whatsup@shrivu-plugins
```

Restart Claude Code so the MCP server registered in `.mcp.json` is picked up.

## Step 2: Pair the device (QR)

On first start the MCP server detects no credentials and pushes a system channel notification with the QR file path (default `/tmp/whatsup-qr.png`). Claude will either surface this to the user or you can prompt for it:

```bash
# In Claude, ask: "what's the whatsup status?"
# Claude calls the `status` tool which returns the qrCodeFile path when pairing is pending.

open /tmp/whatsup-qr.png   # macOS
# or: xdg-open /tmp/whatsup-qr.png   # Linux
```

Scan with the phone: **WhatsApp → Settings → Linked Devices → Link a Device**.

Credentials persist to `~/.config/whatsup/auth/` (0700 dir, 0600 files). Subsequent starts skip the QR.

## Step 3: Configure the allowlist

**An empty allowlist blocks all outbound sends.** This is the safe default. Add the contacts you want Claude to be able to message.

Option A — environment variable (highest priority):

```bash
export WHATSUP_ALLOWLIST="+18005551234,+447911123456"
```

Option B — user config at `~/.config/whatsup/config.json`:

```json
{
  "allowlist": ["+18005551234", "+447911123456"]
}
```

Phone numbers must be E.164 (country code, `+` prefix). Group JIDs go in `WHATSUP_ALLOWLIST_GROUPS` / `allowlistGroups` and look like `120363041234567890@g.us`.

Restart Claude Code so the MCP server re-reads config.

## Step 4: Smoke-test

In Claude:

> "Send a test WhatsApp message to +18005551234 saying 'hi from claude code'."

The `reply` tool fires, the message lands on WhatsApp. Then have that contact reply — the response should appear in Claude as an inbound channel event with the `chat_id` and untrusted-tagged content.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `status` returns `qrCodeFile` and `connected: false` | Pairing not completed | Scan the QR; if expired, restart Claude Code to regenerate. |
| `CONTACT_NOT_ALLOWLISTED` on `reply` | Number not in allowlist | Add to `WHATSUP_ALLOWLIST`; restart Claude Code. |
| Inbound messages don't arrive | `readMode: allowlist` and sender not on allowlist | Add the contact, or set `WHATSUP_READ_MODE=all` if you want every DM. |
| Server log says `disconnected, statusCode: 401` | Phone unlinked the device | Delete `~/.config/whatsup/auth/` and re-pair. |
| `MEDIA_TOO_LARGE` on `reply` with files | File > 64 MB default | Compress or lower `WHATSUP_MAX_MEDIA_SIZE`. |

Logs: `/tmp/whatsup-proxy.log` (default `logFile`). Audit log: `~/.config/whatsup/audit.jsonl`.

## Re-pairing

```bash
rm -rf ~/.config/whatsup/auth/
```

Then restart Claude Code — the server emits a fresh QR notification.

## Config sources, in priority order

1. Environment variables (`WHATSUP_*`)
2. User config (`~/.config/whatsup/config.json`)
3. Repo config (`.claude/whatsup.json` — security-narrowed)
4. Defaults

`authDir`, `logFile`, `auditLog`, `qrCodeFile` are locked from repo config — only env vars or user config can set them. Repo config can never *widen* `allowlist` / `allowlistGroups` beyond what user config permits (intersection only), and can never *raise* rate limits.
