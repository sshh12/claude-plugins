---
name: freetaxusa
description: >-
  Guides users through filing US federal and state taxes on FreeTaxUSA.com
  using document extraction, tax research, and browser-based form automation.
  Use when the user asks to file taxes, prepare a tax return, or automate
  FreeTaxUSA form filling.
---

## Disclaimers

- This skill is **NOT** affiliated with, endorsed by, or connected to FreeTaxUSA or TaxHawk Inc.
- This is **NOT** tax advice. This skill automates form filling based on user-provided documents.
- This skill will **NEVER** auto-submit a tax return. The user must review and submit manually.
- The user is solely responsible for the accuracy of their tax return.
- The agent's tax knowledge may be outdated or incomplete. Phase 3 fetches current-year rules to compensate, but always defer to IRS publications and FreeTaxUSA's built-in guidance over the agent's assumptions.
- **Sensitive data** (SSNs, bank account numbers, IP PINs) must be entered by the user directly into the browser — the agent must not handle these values.

## Prerequisites

- **Browser automation capability** — brw skill strongly recommended (loaded in Phase 1); alternatives like Claude for Chrome, Playwright MCP, or Chrome DevTools MCP also work
- **Node.js 18+**
- A **FreeTaxUSA account** (free to create at freetaxusa.com)
- Tax documents (W-2s, 1099s, etc.)

## Phase Overview

### Phase 1: Setup & Consent

See `references/PHASE-1-SETUP.md`

- [ ] Explain risks of tax inaccuracy
- [ ] Load browser automation (brw skill preferred; detect alternatives if unavailable)
- [ ] Review data privacy implications
- [ ] Get explicit user consent

### Phase 2: Document Discovery

See `references/PHASE-2-DISCOVERY.md`

- [ ] Set up secure working folder
- [ ] Collect and extract all tax documents
- [ ] Build consolidated document summary
- [ ] Front-load ALL questions before filing
- [ ] Generate tax outcome guesstimate

### Phase 3: Tax Research

See `references/PHASE-3-RESEARCH.md`

- [ ] Fetch current tax brackets and rules
- [ ] Run life change questionnaire
- [ ] Flag complexity items needing professional help
- [ ] Build section-by-section filing plan

**Phases 2-3 are iterative.** The life change questionnaire or filing plan review may reveal missing documents or new questions. Loop back to Phase 2 as needed — request additional docs, re-extract, update the summary, and revise the filing plan. Do NOT proceed to Phase 4 until all documents are accounted for and the filing plan is approved.

### Phase 4: Filing

See `references/PHASE-4-FILING.md`

- [ ] Navigate FreeTaxUSA, user logs in
- [ ] Handle first few pages directly to learn the site flow
- [ ] Delegate remaining sections to background agents to save context
- [ ] Maintain verification table throughout
- [ ] Checkpoint reviews after each major section
- [ ] Complete state return(s)
- [ ] STOP at review page — never submit

### Phase 5: Review & Cleanup

See `references/PHASE-5-REVIEW.md`

- [ ] Generate personalized HTML tax summary report
- [ ] Walk through review checklist
- [ ] Explain next steps (user submits)
- [ ] Write data purge reminder with actual paths

## PDF Extraction Script

Extract text and render page images from tax document PDFs:

```bash
node "${SKILL_DIR}/scripts/extract-pdf.js" <pdf-path> [output-dir]
```

- Extracts text and renders page images from PDFs
- Outputs JSON summary to stdout
- Creates per-page `.txt` and `.png` files in the output directory
- If `output-dir` is omitted, outputs are placed alongside the PDF

## Key Principles

### When to Ask vs Assume

Transcribe verified document values directly (W-2 box amounts, 1099 figures, employer info). Ask about ambiguous items, filing choices, and discrepancies between documents.

### Data Privacy

Tax data stays local. No data is sent to external services except FreeTaxUSA via the browser. Extracted files, research notes, and the summary report live in the user-chosen folder. Screenshots go to your browser automation tool's default location (e.g., /tmp/brw-screenshots/ for brw).

### Error Recovery

Each page auto-saves on FreeTaxUSA. If something goes wrong, re-login and resume from where you left off. Progress is never lost.

### Pace

Go slow and verify. Speed is less important than accuracy for tax filing. Double-check every entry against source documents.

## Browser Tips & Known Issues

- See `references/BROWSER-TIPS.md` for FreeTaxUSA-specific browser automation patterns
- See `references/GOTCHAS.md` for known quirks and common pitfalls
