# whatsup — First-time setup

## Prerequisites

- Node.js 18+
- A WhatsApp account on a phone (used to enter the pairing code or scan the QR)

## Step 1: Install the plugin

```bash
/plugin marketplace add sshh12/claude-plugins
/plugin install whatsup@shrivu-plugins
```

Restart Claude Code so the MCP server registered in `.mcp.json` is picked up.

## Step 2: Pair the device

### Option A — phone pairing code (no QR, no GUI — recommended)

Best for headless/background hosts where you can't view an image. In Claude, ask:

> "Pair whatsapp with my number 18005551234."

Claude calls the `pair_request` tool, which returns an 8-character code. On the phone, go to **WhatsApp → Settings → Linked Devices → Link a Device → "Link with phone number instead"** and enter the code. Set `WHATSUP_PAIR_PHONE` to your own number to skip passing it each time (and to lock pairing to that number):

```bash
export WHATSUP_PAIR_PHONE="18005551234"   # digits, your own WhatsApp number
```

### Option B — QR scan (fallback)

If the phone code is rejected (status shows `lastPairError` / a repeated `401`), ask Claude to call **`qr_request`** — it brings up a fresh, rotating QR (the plain startup QR goes stale because WhatsApp stops rotating it once a code is requested). Then:

```bash
# In Claude, ask: "what's the whatsup status?" → returns qrCodeFile + qrAgeSec.
open /tmp/whatsup-qr.png   # macOS   (xdg-open on Linux)
```

Scan with **WhatsApp → Settings → Linked Devices → Link a Device**. If pairing is stuck in a failure loop, `reset_credentials` gets you back to a clean slate (safe — a completed session is backed up, never destroyed).

Credentials persist to `~/.config/whatsup/auth/` (0700 dir, 0600 files). Subsequent starts skip pairing.

### Optional — stay reachable when the link dies (out-of-band alerts)

If the link ever deauths, the server can't tell you over WhatsApp. Point it at a secondary channel so it can:

```bash
export WHATSUP_ALERT_WEBHOOK_URL="https://…"   # Pushover / ntfy / Slack / email relay / phone push
export WHATSUP_AUTO_REPAIR="true"              # optional: auto-issue a pairing code on deauth and push it here
```

Deauth, pairing-code, replaced, and reconnect-gave-up events then POST to that URL, and the `alert` tool lets Claude reach you there directly.

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
| `status` returns `qrCodeFile` / `pairingCode` and `connected: false` | Pairing not completed | Enter the `pairingCode` (or scan the QR); call `pair_request` for a fresh code if it expired. |
| Phone code keeps ending in `401` / `PAIRING_FAILED` / `lastPairError` set | WhatsApp rejected the pairing (often a stale WA client version) | Retry `pair_request` for a fresh code, or `qr_request` to scan a QR; `reset_credentials` if looping. Note the `waVersion` from `status` and update the plugin if it's stale. |
| `REPAIR_REQUIRED` / `status.needsRepair` / `replacedCode: 401` | Link deauthed or taken over via a 401 auth conflict | **Don't** `reconnect` (risks a wipe). Call `restore_credentials`; if it fails, `pair_request` to re-link. |
| `CONTACT_NOT_ALLOWLISTED` on `reply` | Number not in allowlist | Add to `WHATSUP_ALLOWLIST`; restart Claude Code. |
| Inbound messages don't arrive | `readMode: allowlist` and sender not on allowlist | Add the contact, or set `WHATSUP_READ_MODE=all` if you want every DM. |
| Server log says `disconnected, statusCode: 401` | Phone unlinked the device (genuine deauth) | Call `restore_credentials` (if spurious) or `pair_request` to re-link. Credentials are backed up to `auth.bak.*`, not deleted. |
| `ALERT_NOT_CONFIGURED` on `alert` | No secondary channel set | Set `WHATSUP_ALERT_WEBHOOK_URL`. |
| `MEDIA_TOO_LARGE` on `reply` with files | File > 64 MB default | Compress or lower `WHATSUP_MAX_MEDIA_SIZE`. |

Logs: `/tmp/whatsup-proxy.log` (default `logFile`). Audit log: `~/.config/whatsup/audit.jsonl`.

## Re-pairing

Preferred (no host access, no QR): ask Claude to call `pair_request` and enter the returned code on your phone. `pair_request` moves any existing credentials aside into `auth.bak.*` first, so a mistaken re-pair is recoverable with `restore_credentials`.

Manual reset (removes creds without a backup):

```bash
rm -rf ~/.config/whatsup/auth/
```

Then restart Claude Code — the server emits a fresh pairing notification.

## Config sources, in priority order

1. Environment variables (`WHATSUP_*`)
2. User config (`~/.config/whatsup/config.json`)
3. Repo config (`.claude/whatsup.json` — security-narrowed)
4. Defaults

`authDir`, `logFile`, `auditLog`, `qrCodeFile`, `historyFile`, `daemonSocketFile`, and the sensitive `alertWebhookUrl` / `pairPhone` / `autoRepair` are locked from repo config — only env vars or user config can set them (so a malicious repo can't redirect alerts, aim pairing at a foreign number, or silently enable auto-repair). Repo config can never *widen* `allowlist` / `allowlistGroups` beyond what user config permits (intersection only), and can never *raise* rate limits.
