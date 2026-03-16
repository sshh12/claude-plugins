# WhatsUp First-Time Setup Guide

## Prerequisites

- Node.js 18+
- A WhatsApp account on a phone

## Step 1: Authenticate via QR Code

```bash
whatsup auth login
```

This starts the background daemon and generates a QR code at `/tmp/whatsup-qr.png`. Open that image file so the user can scan it.

The user must scan this QR with their phone: **WhatsApp > Settings > Linked Devices > Link a Device**.

After scanning, verify the connection:

```bash
whatsup auth status
```

Expected response: `"connected": true, "authenticated": true`. Credentials are now saved to `~/.config/whatsup/auth/` and persist across restarts — no QR needed next time.

## Step 2: Configure Allowlist

Before any messages can be sent, the user must specify which phone numbers the agent is allowed to contact. **Without this, all sends are blocked** (safe default).

Option A — environment variable:
```bash
export WHATSUP_ALLOWLIST="+1234567890,+447911123456"
```

Option B — user config file at `~/.config/whatsup/config.json`:
```json
{
  "allowlist": ["+1234567890", "+447911123456"]
}
```

After changing the allowlist, restart the daemon to pick up changes:
```bash
whatsup server restart
```

Phone numbers must be in E.164 format (country code with `+` prefix, e.g., `+18005551234` for US).

## Step 3: Send a Test Message

```bash
whatsup send "+1234567890" "Hello from whatsup!"
```

If it returns `"ok": true` with a `messageId`, the setup is complete.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| QR code not generated | Daemon failed to start | Check `whatsup log` for errors |
| QR scan doesn't connect | QR expired (timeout ~60s) | Run `whatsup auth login` again for a fresh QR |
| `CONTACT_NOT_ALLOWLISTED` on send | Number not in allowlist | Add to `WHATSUP_ALLOWLIST`, then `whatsup server restart` |
| `NOT_AUTHENTICATED` after restart | Session expired or revoked from phone | Run `whatsup auth login` to re-link |
| Connection drops after linking | Phone went offline or WhatsApp revoked session | Keep phone connected to internet; re-auth if needed |

## Re-Authentication

Credentials persist across daemon restarts. If the phone is offline for too long, WhatsApp may revoke the session — re-run `whatsup auth login` to re-link.

```bash
whatsup auth status    # Check connection state
whatsup auth logout    # Clear credentials and disconnect
whatsup auth login     # Generate new QR for re-linking
```

## Config File Locations

| Level | Path | Priority |
|-------|------|----------|
| Environment | `WHATSUP_*` vars | Highest |
| User config | `~/.config/whatsup/config.json` | Medium |
| Repo config | `.claude/whatsup.json` | Lowest (security-restricted) |

Run `whatsup config` to see all resolved values with their sources.
