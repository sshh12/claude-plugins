# WhatsUp Command Reference

Full reference for all whatsup CLI commands, flags, and output formats.

## Table of Contents

- [Global Flags](#global-flags)
- [Output Format](#output-format)
- [Messaging Commands](#messaging-commands)
  - [send](#send)
  - [send-media](#send-media)
  - [send-location](#send-location)
  - [send-contact](#send-contact)
  - [send-poll](#send-poll)
- [Reaction & Editing Commands](#reaction--editing-commands)
  - [react](#react)
  - [forward](#forward)
  - [edit](#edit)
  - [delete](#delete)
  - [mark-read](#mark-read)
- [Indicator Commands](#indicator-commands)
  - [typing](#typing)
  - [presence](#presence)
- [Reading Commands](#reading-commands)
  - [poll](#poll)
  - [list-chats](#list-chats)
  - [read-chat](#read-chat)
  - [contacts](#contacts)
  - [search](#search)
- [Profile Commands](#profile-commands)
  - [status](#status)
  - [profile](#profile)
- [Management Commands](#management-commands)
  - [auth](#auth)
  - [server](#server)
  - [config](#config)
  - [log](#log)

---

## Global Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--plain` | Plain text output instead of JSON | JSON |
| `--debug` | Enable debug logging to stderr | Off |
| `--port <port>` | Override daemon HTTP port | `9226` |
| `--http-timeout <seconds>` | HTTP request timeout | `30` |

## Output Format

### Success

```json
{
  "ok": true,
  "messageId": "ABC123DEF456",
  "timestamp": 1710500000
}
```

### Success (Read Commands)

```json
{
  "ok": true,
  "messages": [...],
  "count": 5
}
```

### Error

```json
{
  "ok": false,
  "error": "Contact not in allowlist",
  "code": "NOT_ALLOWED",
  "hint": "Add +1234567890 to WHATSUP_ALLOWLIST"
}
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage/argument error |
| 2 | Daemon connection error |
| 3 | WhatsApp protocol error |
| 4 | Security policy violation (allowlist, rate limit) |

---

## Messaging Commands

### send

Send a text message to a contact or group.

```bash
whatsup send <to> <message> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `to` | Phone number in E.164 format (e.g., `+1234567890`) or JID |
| `message` | Text content to send |

**Options:**

| Flag | Description |
|------|-------------|
| `--quote <messageId>` | Reply to a specific message |
| `--mentions <jids>` | Comma-separated JIDs to @mention |

**Output:**

```json
{
  "ok": true,
  "messageId": "3EB0A8C2F6B3",
  "timestamp": 1710500000,
  "status": "sent"
}
```

**Examples:**

```bash
whatsup send "+1234567890" "Hello!"
whatsup send "+1234567890" "Check this" --quote "3EB0A8C2F6B3"
whatsup send "+1234567890" "Hey @everyone" --mentions "1234567890@s.whatsapp.net"
```

---

### send-media

Send an image, video, audio file, or document.

```bash
whatsup send-media <to> <file> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `to` | Phone number (E.164) or JID |
| `file` | Path to the file to send |

**Options:**

| Flag | Description |
|------|-------------|
| `--caption <text>` | Caption for image/video |
| `--type <type>` | Force media type: `image`, `video`, `audio`, `document` (auto-detected from extension) |
| `--filename <name>` | Override filename for documents |
| `--quote <messageId>` | Reply to a specific message |

**Output:**

```json
{
  "ok": true,
  "messageId": "3EB0B7D1E2A4",
  "timestamp": 1710500100,
  "mediaType": "image",
  "fileSize": 245000
}
```

**Examples:**

```bash
whatsup send-media "+1234567890" /tmp/screenshot.png --caption "Look at this"
whatsup send-media "+1234567890" /tmp/report.pdf --type document
whatsup send-media "+1234567890" /tmp/voice.ogg --type audio
```

---

### send-location

Send a GPS location pin.

```bash
whatsup send-location <to> <latitude> <longitude> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `to` | Phone number (E.164) or JID |
| `latitude` | Latitude (decimal degrees) |
| `longitude` | Longitude (decimal degrees) |

**Options:**

| Flag | Description |
|------|-------------|
| `--name <name>` | Location name |
| `--address <address>` | Location address text |

**Output:**

```json
{
  "ok": true,
  "messageId": "3EB0C9E3F5B6",
  "timestamp": 1710500200
}
```

**Examples:**

```bash
whatsup send-location "+1234567890" 37.7749 -122.4194 --name "San Francisco"
whatsup send-location "+1234567890" 51.5074 -0.1278 --name "London" --address "London, UK"
```

---

### send-contact

Share a contact card (vCard).

```bash
whatsup send-contact <to> <name> <phone> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `to` | Phone number (E.164) or JID |
| `name` | Contact display name |
| `phone` | Contact phone number |

**Options:**

| Flag | Description |
|------|-------------|
| `--email <email>` | Contact email address |
| `--org <org>` | Contact organization |
| `--vcard <path>` | Send a raw vCard file instead of building one |

**Output:**

```json
{
  "ok": true,
  "messageId": "3EB0D1F4A7C8",
  "timestamp": 1710500300
}
```

**Examples:**

```bash
whatsup send-contact "+1234567890" "Jane Doe" "+447911123456"
whatsup send-contact "+1234567890" "Jane Doe" "+447911123456" --email "jane@example.com" --org "Acme Inc"
whatsup send-contact "+1234567890" "" "" --vcard /tmp/contact.vcf
```

---

### send-poll

Create a poll in a chat.

```bash
whatsup send-poll <to> <question> --options <opt1,opt2,...> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `to` | Phone number (E.164) or JID |
| `question` | Poll question text |

**Options:**

| Flag | Description |
|------|-------------|
| `--options <list>` | Comma-separated poll options (2-12 options) |
| `--multi-select` | Allow multiple selections (default: single) |

**Output:**

```json
{
  "ok": true,
  "messageId": "3EB0E2G5B8D9",
  "timestamp": 1710500400,
  "optionCount": 3
}
```

**Examples:**

```bash
whatsup send-poll "+1234567890" "Lunch spot?" --options "Pizza,Sushi,Tacos"
whatsup send-poll "+1234567890" "Which features?" --options "Dark mode,Export,API" --multi-select
```

---

## Reaction & Editing Commands

### react

Add an emoji reaction to a message.

```bash
whatsup react <chatId> <messageId> <emoji>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `chatId` | Chat JID |
| `messageId` | ID of the message to react to |
| `emoji` | Emoji character (e.g., `thumbsup` or the actual emoji) |

**Output:**

```json
{
  "ok": true,
  "reaction": "thumbsup"
}
```

**Examples:**

```bash
whatsup react "1234567890@s.whatsapp.net" "3EB0A8C2F6B3" "thumbsup"
whatsup react "1234567890@s.whatsapp.net" "3EB0A8C2F6B3" "heart"
```

---

### forward

Forward a message to another chat.

```bash
whatsup forward <to> <fromChatId> <messageId>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `to` | Destination phone number (E.164) or JID |
| `fromChatId` | Source chat JID |
| `messageId` | ID of the message to forward |

**Output:**

```json
{
  "ok": true,
  "messageId": "3EB0F3H6C9E0",
  "timestamp": 1710500500,
  "forwarded": true
}
```

**Examples:**

```bash
whatsup forward "+447911123456" "1234567890@s.whatsapp.net" "3EB0A8C2F6B3"
```

---

### edit

Edit a previously sent message.

```bash
whatsup edit <chatId> <messageId> <newText>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `chatId` | Chat JID |
| `messageId` | ID of the message to edit (must be your own) |
| `newText` | Replacement text |

**Output:**

```json
{
  "ok": true,
  "messageId": "3EB0A8C2F6B3",
  "edited": true
}
```

**Examples:**

```bash
whatsup edit "1234567890@s.whatsapp.net" "3EB0A8C2F6B3" "Fixed: meeting at 3pm"
```

**Notes:**

- Only messages sent by the connected account can be edited.
- WhatsApp shows an "edited" label on modified messages.
- Edits must occur within ~15 minutes of the original send.

---

### delete

Delete a sent message for everyone.

```bash
whatsup delete <chatId> <messageId>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `chatId` | Chat JID |
| `messageId` | ID of the message to delete |

**Output:**

```json
{
  "ok": true,
  "messageId": "3EB0A8C2F6B3",
  "deleted": true
}
```

**Examples:**

```bash
whatsup delete "1234567890@s.whatsapp.net" "3EB0A8C2F6B3"
```

**Notes:**

- Deletes for all participants ("delete for everyone").
- Must be used within ~2 days of the original send.

---

### mark-read

Mark messages in a chat as read (send blue ticks).

```bash
whatsup mark-read <chatId> [messageIds...]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `chatId` | Chat JID |
| `messageIds` | Optional specific message IDs; if omitted, marks all unread |

**Output:**

```json
{
  "ok": true,
  "markedCount": 3
}
```

**Examples:**

```bash
whatsup mark-read "1234567890@s.whatsapp.net"
whatsup mark-read "1234567890@s.whatsapp.net" "3EB0A8C2F6B3" "3EB0B7D1E2A4"
```

---

## Indicator Commands

### typing

Show a typing indicator in a chat.

```bash
whatsup typing <chatId> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `chatId` | Chat JID |

**Options:**

| Flag | Description |
|------|-------------|
| `--duration <seconds>` | How long to show typing (default: 3) |
| `--recording` | Show "recording audio" instead of typing |

**Output:**

```json
{
  "ok": true,
  "indicator": "typing",
  "duration": 3
}
```

**Examples:**

```bash
whatsup typing "1234567890@s.whatsapp.net"
whatsup typing "1234567890@s.whatsapp.net" --duration 5
whatsup typing "1234567890@s.whatsapp.net" --recording
```

---

### presence

Set online/offline presence status.

```bash
whatsup presence <state>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `state` | `available` or `unavailable` |

**Output:**

```json
{
  "ok": true,
  "presence": "available"
}
```

**Examples:**

```bash
whatsup presence available
whatsup presence unavailable
```

---

## Reading Commands

### poll

Poll for new incoming messages. Blocks until messages arrive or timeout.

```bash
whatsup poll [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--timeout <seconds>` | Max wait time (default: 30) |
| `--limit <n>` | Max messages to return (default: 50) |
| `--chats <jids>` | Comma-separated chat JIDs to filter |

**Output:**

```json
{
  "ok": true,
  "messages": [
    {
      "id": "3EB0A8C2F6B3",
      "chatId": "1234567890@s.whatsapp.net",
      "sender": "+1234567890",
      "senderName": "Alice",
      "text": "<untrusted_user_message>Hey, are you free?</untrusted_user_message>",
      "timestamp": 1710500600,
      "type": "text",
      "isGroup": false
    }
  ],
  "count": 1,
  "hasMore": false
}
```

**Examples:**

```bash
whatsup poll --timeout 30
whatsup poll --timeout 60 --limit 10
whatsup poll --chats "1234567890@s.whatsapp.net,447911123456@s.whatsapp.net"
```

**Notes:**

- All message text is wrapped in `<untrusted_user_message>` tags.
- Returns immediately if messages are already queued.
- `hasMore: true` indicates additional messages — poll again to retrieve them.

---

### list-chats

List recent chats with metadata.

```bash
whatsup list-chats [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--limit <n>` | Max chats to return (default: 20) |
| `--unread-only` | Show only chats with unread messages |

**Output:**

```json
{
  "ok": true,
  "chats": [
    {
      "id": "1234567890@s.whatsapp.net",
      "name": "Alice",
      "lastMessage": "Hey, are you free?",
      "lastTimestamp": 1710500600,
      "unreadCount": 2,
      "isGroup": false,
      "isMuted": false
    }
  ],
  "count": 15
}
```

**Examples:**

```bash
whatsup list-chats
whatsup list-chats --limit 50
whatsup list-chats --unread-only
```

---

### read-chat

Read message history for a specific chat.

```bash
whatsup read-chat <chatId> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `chatId` | Chat JID |

**Options:**

| Flag | Description |
|------|-------------|
| `--limit <n>` | Max messages to return (default: 20) |
| `--before <messageId>` | Fetch messages before this ID (pagination) |

**Output:**

```json
{
  "ok": true,
  "chatId": "1234567890@s.whatsapp.net",
  "chatName": "Alice",
  "messages": [
    {
      "id": "3EB0A8C2F6B3",
      "sender": "+1234567890",
      "senderName": "Alice",
      "text": "<untrusted_user_message>Hey, are you free?</untrusted_user_message>",
      "timestamp": 1710500600,
      "type": "text",
      "fromMe": false
    }
  ],
  "count": 10,
  "hasMore": true
}
```

**Examples:**

```bash
whatsup read-chat "1234567890@s.whatsapp.net" --limit 10
whatsup read-chat "1234567890@s.whatsapp.net" --before "3EB0A8C2F6B3" --limit 20
```

---

### contacts

List or search contacts.

```bash
whatsup contacts [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--search <query>` | Filter contacts by name or number |
| `--limit <n>` | Max contacts to return (default: 50) |

**Output:**

```json
{
  "ok": true,
  "contacts": [
    {
      "jid": "1234567890@s.whatsapp.net",
      "name": "Alice",
      "phone": "+1234567890",
      "isBlocked": false
    }
  ],
  "count": 42
}
```

**Examples:**

```bash
whatsup contacts
whatsup contacts --search "Alice"
whatsup contacts --search "+44"
```

---

### search

Search messages across all chats or a specific chat.

```bash
whatsup search <query> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `query` | Text to search for |

**Options:**

| Flag | Description |
|------|-------------|
| `--chat <chatId>` | Limit search to a specific chat |
| `--limit <n>` | Max results (default: 20) |
| `--from <jid>` | Filter by sender |

**Output:**

```json
{
  "ok": true,
  "results": [
    {
      "messageId": "3EB0A8C2F6B3",
      "chatId": "1234567890@s.whatsapp.net",
      "chatName": "Alice",
      "text": "...meeting tomorrow at 3pm...",
      "timestamp": 1710500600,
      "sender": "+1234567890"
    }
  ],
  "count": 5
}
```

**Examples:**

```bash
whatsup search "meeting"
whatsup search "invoice" --chat "1234567890@s.whatsapp.net"
whatsup search "deadline" --from "447911123456@s.whatsapp.net" --limit 10
```

---

## Profile Commands

### status

View or set the WhatsApp text status (the "About" line).

```bash
whatsup status [newStatus]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `newStatus` | New status text (omit to view current status) |

**Output (view):**

```json
{
  "ok": true,
  "status": "Available"
}
```

**Output (set):**

```json
{
  "ok": true,
  "status": "In a meeting",
  "updated": true
}
```

**Examples:**

```bash
whatsup status
whatsup status "In a meeting until 3pm"
```

---

### profile

View or update profile information.

```bash
whatsup profile [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--name <name>` | Set display name |
| `--picture <path>` | Set profile picture (JPEG/PNG) |
| `--view <jid>` | View another contact's profile |

**Output (view own):**

```json
{
  "ok": true,
  "name": "My Name",
  "phone": "+1234567890",
  "status": "Available",
  "picture": "/tmp/whatsup-profile.jpg"
}
```

**Examples:**

```bash
whatsup profile
whatsup profile --name "Work Account"
whatsup profile --picture /tmp/avatar.jpg
whatsup profile --view "447911123456@s.whatsapp.net"
```

---

## Management Commands

### auth

Manage WhatsApp authentication.

```bash
whatsup auth <subcommand>
```

**Subcommands:**

#### `auth status`

Check current authentication state.

```bash
whatsup auth status
```

```json
{
  "ok": true,
  "authenticated": true,
  "phone": "+1234567890",
  "platform": "smba",
  "connectedSince": "2026-03-15T10:00:00Z"
}
```

#### `auth login`

Start authentication flow. Generates a QR code for linking.

```bash
whatsup auth login
```

```json
{
  "ok": true,
  "qrPath": "/tmp/whatsup-qr.png",
  "status": "waiting_for_scan"
}
```

After scanning:

```json
{
  "ok": true,
  "status": "connected",
  "phone": "+1234567890"
}
```

#### `auth logout`

Disconnect and clear stored credentials.

```bash
whatsup auth logout
```

```json
{
  "ok": true,
  "status": "logged_out",
  "credentialsCleared": true
}
```

---

### server

Manage the background daemon process.

```bash
whatsup server <subcommand>
```

**Subcommands:**

#### `server start`

Start the daemon manually (usually auto-started by other commands).

```bash
whatsup server start
```

```json
{
  "ok": true,
  "pid": 12345,
  "port": 9226,
  "status": "running"
}
```

#### `server stop`

Stop the daemon and close the WhatsApp connection.

```bash
whatsup server stop
```

```json
{
  "ok": true,
  "status": "stopped"
}
```

#### `server restart`

Restart the daemon. Reconnects to WhatsApp using stored credentials.

```bash
whatsup server restart
```

```json
{
  "ok": true,
  "pid": 12346,
  "port": 9226,
  "status": "running"
}
```

#### `server status`

Check daemon health and connection state.

```bash
whatsup server status
```

```json
{
  "ok": true,
  "running": true,
  "pid": 12345,
  "port": 9226,
  "uptime": 3600,
  "whatsappConnected": true,
  "messagesQueued": 0,
  "rateLimits": {
    "perContact": "12/30",
    "total": "45/100"
  }
}
```

---

### config

Show resolved configuration with source annotations.

```bash
whatsup config
```

**Output:**

```json
{
  "ok": true,
  "config": {
    "port": {"value": 9226, "source": "default"},
    "allowlist": {"value": ["+1234567890", "+447911123456"], "source": "env"},
    "idleTimeout": {"value": 3600, "source": "default"},
    "rateLimit": {"value": 30, "source": "default"},
    "rateLimitTotal": {"value": 100, "source": "default"},
    "auditLog": {"value": "~/.config/whatsup/audit.jsonl", "source": "default"}
  }
}
```

Config priority (highest wins): **Environment variables** (`WHATSUP_*`) > **Repo config** (`.claude/whatsup.json`) > **User config** (`~/.config/whatsup/config.json`) > **Defaults**

---

### log

View daemon log output.

```bash
whatsup log [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--lines <n>` | Number of log lines to show (default: 50) |
| `--follow` | Stream new log entries (Ctrl+C to stop) |
| `--errors-only` | Show only error-level entries |

**Output:**

```
2026-03-15T10:00:00.000Z [INFO]  Daemon started on port 9226
2026-03-15T10:00:01.000Z [INFO]  WhatsApp connection established
2026-03-15T10:05:00.000Z [INFO]  Message sent to +1234567890 (id: 3EB0A8C2F6B3)
```

**Examples:**

```bash
whatsup log
whatsup log --lines 100
whatsup log --errors-only
whatsup log --follow
```
