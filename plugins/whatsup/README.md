# whatsup

WhatsApp messaging plugin for Claude Code. Send and receive messages, react to conversations, share media/locations/polls, and monitor incoming messages — all via a CLI backed by the [Baileys](https://github.com/WhiskeySockets/Baileys) WebSocket client.

## Requirements

- **Node.js 18+**
- **A WhatsApp account** on a phone

## Install

### From the marketplace

```bash
/plugin marketplace add sshh12/claude-plugins
/plugin install whatsup@shrivu-plugins
```

### For development

```bash
cd plugins/whatsup && npm install && bash build.sh
claude --plugin-dir ./plugins/whatsup
```

## Quick Start

### 1. Authenticate

```bash
whatsup auth login
```

Generates a QR code at `/tmp/whatsup-qr.png`. Scan it with your phone: **WhatsApp > Settings > Linked Devices > Link a Device**.

Credentials persist across restarts — no re-scanning needed.

### 2. Set allowlist

Only allowlisted contacts can receive messages. Without this, all sends are blocked (safe default).

Set via environment variable:
```bash
export WHATSUP_ALLOWLIST="+18005551234,+447911123456"
```

Or user config at `~/.config/whatsup/config.json`:
```json
{
  "allowlist": ["+18005551234", "+447911123456"]
}
```

After changing, restart the daemon: `whatsup server restart`

Phone numbers must be E.164 format (country code with `+` prefix).

### 3. Send a message

```bash
whatsup send "+18005551234" "Hello from whatsup!"
```

### 4. Poll for replies

```bash
whatsup poll --timeout 30
```

## Features

| Feature | Command | Example |
|---------|---------|---------|
| Text messages | `send` | `whatsup send "+1234" "Hello"` |
| Media (image/video/doc) | `send-media` | `whatsup send-media "+1234" photo.jpg --caption "Check this"` |
| Location pins | `send-location` | `whatsup send-location "+1234" 29.76 -95.37 --name "Houston"` |
| Polls | `send-poll` | `whatsup send-poll "+1234" "Lunch?" --options "Pizza,Sushi,Tacos"` |
| Reactions | `react` | `whatsup react <msgId> "🔥" --chat <chatId>` |
| Typing indicators | `typing` | `whatsup typing "+1234"` |
| Forward/edit/delete | `forward`, `edit`, `delete` | `whatsup edit <msgId> "corrected text" --chat <chatId>` |
| Long-polling | `poll` | `whatsup poll --timeout 60 --from "+1234"` |
| Chat history | `read-chat` | `whatsup read-chat <chatId> --limit 20` |
| Contact search | `contacts` | `whatsup contacts --search "Alice"` |
| Message search | `search` | `whatsup search "meeting" --limit 10` |
| Profile/status | `status`, `profile` | `whatsup status "Away until Monday"` |

## Architecture

```
CLI (whatsup.js) ──HTTP──> Proxy daemon (proxy.js) ──WebSocket──> WhatsApp
     stateless               persistent Fastify          Baileys WASocket
                             on 127.0.0.1:9226
```

The proxy auto-starts on first CLI call and auto-shuts down after 1 hour idle.

## Security

Locked down by default:

- **Empty allowlist = all sends blocked** — must explicitly approve contacts
- **Rate limiting** — 30 msgs/min per contact, 100 total (protects against WhatsApp bans)
- **Untrusted content tagging** — all incoming message content wrapped in `<untrusted_user_message>` tags
- **Audit logging** — all commands logged to `~/.config/whatsup/audit.jsonl`
- **Auth file protection** — credentials stored with 0700/0600 permissions
- **Localhost only** — proxy binds to 127.0.0.1, never exposed externally

## Documentation

- **Onboarding guide**: [`references/ONBOARDING.md`](skills/whatsup/references/ONBOARDING.md) — step-by-step first-time setup and troubleshooting
- **Skill instructions**: [`SKILL.md`](skills/whatsup/SKILL.md) — workflow, guardrails, configuration
- **Command reference**: [`references/COMMANDS.md`](skills/whatsup/references/COMMANDS.md) — all commands, flags, and examples
- **Security reference**: [`references/SECURITY.md`](skills/whatsup/references/SECURITY.md) — threat model, allowlist design, audit logging

## License

MIT
