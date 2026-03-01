# Quick Mode Reference

Quick mode executes multiple actions in a single call, reducing round-trips. Only a screenshot after the final command is returned.

## Usage

```bash
brw quick "<commands>" [--tab ID]
```

Commands are separated by newlines. One command per line.

## Command Table

| Command | Action | Syntax | Example |
|---------|--------|--------|---------|
| `C` | Left click | `C <x> <y>` | `C 100 200` |
| `RC` | Right click | `RC <x> <y>` | `RC 100 200` |
| `DC` | Double click | `DC <x> <y>` | `DC 100 200` |
| `TC` | Triple click | `TC <x> <y>` | `TC 100 200` |
| `H` | Hover | `H <x> <y>` | `H 100 200` |
| `T` | Type text | `T <text>` | `T hello world` |
| `K` | Press key(s) | `K <keys>` | `K Enter`, `K cmd+a` |
| `S` | Scroll | `S <dir> <amt> <x> <y>` | `S down 3 640 400` |
| `D` | Drag | `D <x1> <y1> <x2> <y2>` | `D 100 200 300 400` |
| `Z` | Zoom (crop screenshot) | `Z <x1> <y1> <x2> <y2>` | `Z 0 0 500 500` |
| `N` | Navigate | `N <url>` | `N https://google.com` |
| `N back` | Navigate back | `N back` | `N back` |
| `J` | Execute JavaScript | `J <expression>` | `J document.title` |
| `W` | Wait (page settle) | `W` | `W` |
| `ST` | Switch tab | `ST <tabId>` | `ST 3` |
| `NT` | New tab | `NT <url>` | `NT https://example.com` |
| `LT` | List tabs | `LT` | `LT` |
| `CR` | Click ref | `CR <ref>` | `CR ref_5` |
| `FR` | Form-input ref | `FR <ref> <value>` | `FR ref_3 hello` |
| `R` | Read page | `R [--filter interactive] [--search TEXT]` | `R --search Submit` |
| `WF` | Wait-for | `WF <flags>` | `WF --text "Success"` |

## Output

```json
{
  "ok": true,
  "screenshot": "/tmp/brw-screenshots/123.png",
  "page": {"url": "...", "title": "...", "contentLength": 48230},
  "results": [
    {"command": "LT", "tabs": [{"id": 1, "url": "...", "title": "..."}]},
    {"command": "J", "result": "Example Domain"}
  ]
}
```

- `LT`, `J`, `R`, `WF`, and `NT` produce intermediate results (returned in the `results` array)
- A single screenshot is taken after the last command
- All commands execute sequentially in order

## Examples

### Search workflow

```bash
brw quick "N https://google.com
W
C 500 300
T claude code plugins
K Enter
W"
```

### Form fill

```bash
brw quick "C 400 200
T john@example.com
K Tab
T John Doe
K Tab
T MyP@ssw0rd
K Enter"
```

### Select all and replace

```bash
brw quick "C 400 300
K cmd+a
K Backspace
T new content"
```

### Multi-tab workflow

```bash
brw quick "NT https://docs.example.com
W
LT"
```

### Ref-based interaction

```bash
brw quick "R --filter interactive
CR ref_5
WF --text 'Saved'
R --search status"
```

### Scroll and capture region

```bash
brw quick "S down 5 640 400
Z 0 0 640 400"
```

## When to Use Quick Mode

- **Multiple simple actions** that don't need intermediate verification (e.g., fill a form, navigate and click)
- **Coordinate-based workflows** where you already know the layout from a previous screenshot
- **Reducing latency** when chaining actions that don't need intermediate screenshots

## When NOT to Use Quick Mode

- **Complex conditional flows** where the next action depends on what happened (use individual commands with screenshot verification)
- **First interaction with a page** where you need to read-page first
- **Debugging** when you need to see each step's result
