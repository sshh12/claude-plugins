---
name: windows-computer-use
description: Use when controlling this Windows desktop — capturing the screen or a specific window, clicking/typing/sending keyboard shortcuts, recording video of motion, or play-testing a game or app. Covers the screenshot, act, record, play, window, process, and system MCP tools.
---

# Windows computer use

Drive the local Windows desktop through the `windows-computer-use` MCP tools. The server runs on
this machine and controls the real displays, mouse, and keyboard.

## Tools

- **screenshot** — see the screen: `desktop`, `display:N`/`display:primary|left|right`, a window
  (`window:<title>`, even if it is behind others), `foreground`, or a `region`. Returns a
  downscaled image + a `capture_id`.
- **act** — input, batched: `left_click`, `type`, `key`, `scroll`, `drag`, `hold_key`, `paste`,
  `click_element`, `mouse_move_relative`, … Coordinates are in the last screenshot's image space.
- **record** — record N seconds → one timestamped frame montage + an mp4 (judge motion/animation).
- **play** — run a timed input script at a cadence while recording (games): `hold w 2`, `look 200 0`,
  `tap space`, `probe`/`until` for telemetry-driven early stop.
- **window** — find / focus / close / `get_text` (read via UI Automation, no screenshot) /
  `click_element` (click a control by accessible name) — all token-cheap, no image. Use `close` to
  close UWP/Store apps (their window PID isn't the killable process).
- **process** — `launch` (incl. `shell:true` for URLs / `ms-settings:` / Store apps), `kill`, `wait`,
  `shell`, `wait_for_file`, `wait_for_window` (readiness — use instead of guessing a sleep).
- **system** — `displays` (monitor layout, DPI, scale), `cursor`, clipboard get/set.

## Rules that prevent the common mistakes

- **Coordinates** are in the last `screenshot`'s image space; the server maps them to physical
  pixels. A newer capture invalidates old coordinates — each screenshot returns a `capture_id` and
  `act` errors if you click against a stale frame. Pass that `capture_id` to `act` when precision matters.
- **Keyboard input goes to the FOREGROUND window.** To type into an app, pass `act focus="<title>"`
  (focuses atomically before the batch) or call `window focus` first. `act` tells you which window
  actually received the input.
- **To read text, use `window get_text`** (UIA + OCR fallback) instead of a screenshot — far cheaper,
  and it works without focusing the window. **To click a labeled control, use `click_element`** — it
  invokes via UI Automation and works even when the window isn't foreground.
- **Multi-monitor:** call `system displays` first; target a monitor with `display:0` /
  `display:primary|left|right`. Displays are 0-indexed.
- **Readiness:** after `process launch`, use `wait_for_window` rather than sleeping.
- Screenshots are inline + downscaled; video and full-resolution captures are written to a file and
  the path/link is returned.
