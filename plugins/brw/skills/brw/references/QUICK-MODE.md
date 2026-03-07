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
| `W` | Wait (fixed pause) | `W [seconds]` | `W` (0.5s), `W 3` (3s) |
| `ST` | Switch tab | `ST <tabId>` | `ST 3` |
| `NT` | New tab | `NT <url>` | `NT https://example.com` |
| `LT` | List tabs | `LT` | `LT` |
| `CR` | Click ref | `CR <ref>` | `CR ref_5` |
| `FR` | Form-input ref | `FR <ref> <value>` | `FR ref_3 hello` |
| `CT` | Click by text | `CT <text>` | `CT Submit` |
| `FT` | Form-input by label | `FT <label> <value>` | `FT Email test@example.com` |
| `R` | Read page | `R [--filter interactive] [--search TEXT]` | `R --search Submit` |
| `WF` | Wait-for | `WF <flags>` | `WF --text "Success"`, `WF --url */step-2*` |

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

For labels with spaces, quote them: `FT "Full name" John Doe`

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

### Cross-page workflow (wizard / multi-step form)

Use `CT` to click by text, then `WF` to wait for the next page to load:

```bash
brw quick "FT Email test@example.com
CT Continue
WF --text 'Step 2 of 5'
FT Phone 555-1234
CT Continue
WF --text 'Step 3 of 5'"
```

For page transitions with URL changes, use `WF --url`:

```bash
brw quick "CT Save and Continue
WF --url */step-2*
FT Name John Doe
CT Save and Continue
WF --url */step-3*"
```

For JS-heavy forms, JS submission is faster than clicking (skips coordinate resolution):

```bash
brw quick "FT Email test@example.com
J document.querySelector('form').submit()
WF --url */step-2*"
```

### Configurable wait duration

`W` accepts an optional duration in seconds (default 0.5s, max 30s):

```bash
brw quick "CT Submit
W 3
R --filter interactive"
```

Use `W <seconds>` for fixed delays. Use `WF` for condition-based waits (more reliable — exits early when condition is met).

## When to Use Quick Mode

- **Multiple simple actions** that don't need intermediate verification (e.g., fill a form, navigate and click)
- **Coordinate-based workflows** where you already know the layout from a previous screenshot
- **Reducing latency** when chaining actions that don't need intermediate screenshots

## When NOT to Use Quick Mode

- **Complex conditional flows** where the next action depends on what happened (use individual commands with screenshot verification)
- **First interaction with a page** where you need to read-page first
- **Debugging** when you need to see each step's result
