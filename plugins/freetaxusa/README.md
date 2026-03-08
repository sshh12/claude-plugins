# freetaxusa

Tax filing automation plugin for Claude Code. Guides you through filing US federal and state taxes on FreeTaxUSA.com by extracting tax documents, researching tax rules, and automating browser-based form filling.

**Not affiliated with FreeTaxUSA or TaxHawk Inc.** This plugin automates form filling based on your documents. It is not tax advice. You are responsible for reviewing and submitting your return.

## How it works

The skill walks through 5 phases:

1. **Setup** — Explains risks, loads browser automation, gets consent
2. **Document Discovery** — Collects and extracts all tax documents (W-2s, 1099s, etc.), builds a consolidated summary, front-loads all questions
3. **Tax Research** — Fetches current tax rules, runs a life-change questionnaire, flags items needing professional help, builds a section-by-section filing plan
4. **Filing** — Navigates FreeTaxUSA in a real browser, fills forms section by section with verification at every step
5. **Review** — Presents a summary, walks through a review checklist, reminds you to purge sensitive data

The skill **never auto-submits** your return. You review and click submit yourself.

## Requirements

- **brw plugin** (browser automation, strongly recommended) — install with `/plugin install brw@shrivu-plugins`. Alternatives like Claude for Chrome, Playwright MCP, or Chrome DevTools MCP also work.
- **Node.js 18+**
- **FreeTaxUSA account** (free at freetaxusa.com)
- **Tax documents** (W-2s, 1099s, prior year return, etc.)

## Install

### From the marketplace

```bash
# Add the marketplace (if not already added)
/plugin marketplace add sshh12/claude-plugins

# Install the plugin
/plugin install freetaxusa@shrivu-plugins
```

### For development

```bash
claude --plugin-dir ./plugins/freetaxusa
```

## Usage

Once installed, invoke the skill:

```
/freetaxusa
```

Or just ask Claude to help you file your taxes — the skill triggers on tax filing requests.

### Example prompts

- "Help me file my taxes on FreeTaxUSA"
- "I need to prepare my federal tax return"
- "Let's do my 2025 taxes"

## PDF Extraction

The plugin includes a PDF extraction tool that pulls text and page images from tax documents:

```bash
node skills/freetaxusa/scripts/extract-pdf.js <pdf-path> [output-dir]
```

Outputs per-page `.txt` and `.png` files plus a `summary.json`.

## Architecture

```
User provides tax documents
        |
        v
Phase 1: Setup & consent
        |
        v
Phase 2: Extract documents --> PDF extraction script
        |                      (text + images per page)
        v
Phase 3: Research tax rules --> WebFetch IRS data
        |
        v
Phase 4: Fill FreeTaxUSA ----> brw (browser automation)
        |                      (Chrome DevTools Protocol)
        v
Phase 5: Review & cleanup
        |
        v
User reviews and submits on FreeTaxUSA
```

## Privacy

- Tax data stays local on your machine
- Document extractions are stored in a folder you choose
- Browser screenshots go to `/tmp/brw-screenshots/`
- No data is sent anywhere except FreeTaxUSA via the browser
- The skill offers to create a cleanup reminder at `~/Desktop/tax-data-purge-reminder.md`
