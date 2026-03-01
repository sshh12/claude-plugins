# App Profiles Reference

App Profiles package app-specific automation knowledge — selectors, JS scripts, multi-step actions — into reusable directories that brw loads at runtime.

## Profile Directory Structure

```
.claude/brw/profiles/google-docs/
  profile.json        # Manifest: metadata, selectors, actions, observers
  read-content.js     # JS IIFE run in page context
  type-text.js        # JS IIFE receiving params
```

## profile.json Format

```json
{
  "name": "google-docs",
  "description": "Google Docs automation via canvas-based editor",
  "match": ["https://docs.google.com/document/*"],

  "selectors": {
    "editor-iframe": "iframe.docs-texteventtarget-iframe",
    "comment-draft": "[aria-label='Comment draft']"
  },

  "actions": {
    "read-content": {
      "description": "Read document text via clipboard",
      "noScreenshot": true,
      "steps": [
        { "action": "js", "file": "read-content.js" }
      ]
    },
    "type-text": {
      "description": "Type text into document body",
      "params": { "text": "string" },
      "steps": [
        { "action": "js", "file": "type-text.js" }
      ]
    },
    "add-comment": {
      "description": "Add comment on selected text",
      "params": { "text": "string" },
      "steps": [
        { "action": "key", "keys": "Meta+Alt+m" },
        { "action": "wait-for", "selector": "$selectors.comment-draft", "timeout": 5 },
        { "action": "form-input", "selector": "$selectors.comment-draft", "value": "$text" },
        { "action": "click", "selector": "$selectors.post-comment" }
      ]
    }
  },

  "observers": {
    "comment-added": {
      "description": "Fires when a new comment appears",
      "condition": { "selector": ".docos-anchoreddocoview" },
      "debounce": 2000,
      "run": "read-comments"
    }
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Profile name (kebab-case, matches directory name) |
| `description` | Yes | What this profile automates |
| `match` | No | URL glob patterns this profile applies to |
| `selectors` | No | Named CSS selectors, referenced as `$selectors.name` in steps |
| `actions` | Yes | Map of action name → action definition |
| `observers` | No | Future: event-driven actions (format only, not implemented) |

### Action Definition

| Field | Required | Description |
|-------|----------|-------------|
| `description` | Yes | What this action does |
| `params` | No | Map of parameter name → type string. All declared params are required. |
| `noScreenshot` | No | Skip screenshot after action (for data-returning actions) |
| `steps` | Yes | Array of step objects executed sequentially |

### Step Format

Each step has an `action` field mapping to a brw command:

| Action | Key Fields | Description |
|--------|-----------|-------------|
| `js` | `file` or `expression`, optional `frame` | Execute JavaScript in page context |
| `click` | `selector`, `ref`, or `x`/`y` | Click an element |
| `type` | `text`, optional `clear` | Type text into focused element |
| `key` | `keys`, optional `repeat` | Press keyboard keys |
| `form-input` | `selector` or `ref`, `value` | Set form element value |
| `navigate` | `url`, optional `wait` | Navigate to URL |
| `wait` | `duration` | Wait for duration (seconds) |
| `wait-for` | `selector`, `text`, `url`, `js`, or `timeout` | Wait for condition |
| `scroll` | `direction`, optional `amount` | Scroll the page |
| `scroll-to` | `selector` or `ref` | Scroll element into view |
| `hover` | `selector`, `ref`, or `x`/`y` | Hover over element |
| `screenshot` | optional `ref`, `region`, `fullPage` | Take a screenshot |
| `read-page` | optional `filter`, `search`, `scope` | Read accessibility tree |

### Substitution

String values in steps support two substitution patterns:

- `$selectors.name` → resolved from the profile's `selectors` map
- `$paramName` → resolved from action parameters passed via `--param`

Selectors are resolved first. Unrecognized `$vars` are left as-is.

## JS Files

JS files are IIFEs that receive action params and run in the browser page context:

```js
// read-content.js
(async (params) => {
  const text = await navigator.clipboard.readText();
  return { content: text, title: document.title };
})
```

- Receive all action params as a single object argument
- Run with `awaitPromise: true` — async IIFEs work
- Return value is captured in the response `data` field
- Read from disk on each execution (not cached) — edit scripts without restarting

## Discovery

Profiles are discovered from three locations (highest priority wins):

1. **Repo** — walk up from cwd: `.claude/brw/profiles/*/profile.json`
2. **User** — `~/.config/brw/profiles/*/profile.json`

Higher-priority profiles shadow lower-priority ones with the same name.

## CLI Commands

```bash
brw profile list                                          # List all profiles
brw profile show <name>                                   # Show profile details
brw run <profile>:<action> [--param k=v ...] [--tab N]    # Run a profile action
```

## Examples

### Create a test profile

```bash
mkdir -p .claude/brw/profiles/test
```

**profile.json**:
```json
{
  "name": "test",
  "description": "Test profile for verification",
  "selectors": { "heading": "h1" },
  "actions": {
    "get-title": {
      "description": "Get page title via JS",
      "noScreenshot": true,
      "steps": [{ "action": "js", "file": "get-title.js" }]
    },
    "click-heading": {
      "description": "Click the main heading",
      "steps": [{ "action": "click", "selector": "$selectors.heading" }]
    }
  }
}
```

**get-title.js**:
```js
(async () => {
  return { title: document.title, url: location.href };
})
```

### Run it

```bash
brw navigate https://example.com
brw run test:get-title          # Returns { data: { title: "Example Domain", url: "..." } }
brw run test:click-heading      # Clicks the h1, returns screenshot
```
