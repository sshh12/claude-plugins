# Phase 2: Document Discovery

## Folder Setup

Ask the user to pick a folder for extracted tax data (suggest something like `~/tax-data-2025/`).

Validate the folder is NOT:
- Inside a git repository (check for `.git` up the tree)
- In a cloud-synced location (`~/Library/Mobile Documents/`, `~/Dropbox/`, `~/Google Drive/`, `~/OneDrive/`)

Create the folder if it does not exist. Warn if validation fails but let the user override.

**All artifacts go in this folder.** Extracted documents, summaries, the tax rules reference, and the HTML report should all live here. This keeps everything in one place for easy cleanup.

## Data Purge Reminder

Now that the folder path is known, write `~/Desktop/tax-data-purge-reminder.md` immediately:

```markdown
# Tax Data Cleanup Reminder

Run these commands after you've confirmed your return was accepted:

rm -rf <extraction-folder>           # Extracted docs, research notes, summary report (contains SSNs and financial data)
rm -rf /tmp/brw-screenshots/         # Browser screenshots (adjust path if using a different browser tool)
rm -rf ~/.config/brw/chrome-data/    # Chrome profile with FreeTaxUSA cookies (adjust if using a different browser tool)

Also review your Claude conversation history (~/.claude/) for tax data.

Keep your PDF copies of the filed return for at least 3 years (IRS statute of limitations).
```

Replace `<extraction-folder>` with the actual folder path just chosen. Creating this now ensures the reminder exists even if the session is interrupted before filing completes.

## Document Checklist

Present this checklist and ask the user to gather all applicable documents:

### Employment

- W-2 (wages)
- 1099-NEC (independent contractor income)
- 1099-MISC (miscellaneous income)
- 1099-K (payment card/third-party network transactions)

### Investments

- 1099-B (stock/crypto sales)
- 1099-DIV (dividends)
- 1099-INT (interest)
- Consolidated brokerage statements (Robinhood, Schwab, Fidelity, Vanguard, etc.)

### Retirement

- 1099-R (retirement distributions, pension, IRA)
- SSA-1099 (Social Security benefits)
- Form 5498 (IRA contributions — for reference)

### Equity Compensation

- Form 3921 (ISO exercise)
- Form 3922 (ESPP)

### Pass-Through Income

- Schedule K-1 (partnerships, S-corps, trusts)

### Government Payments

- 1099-G (unemployment compensation, state/local tax refunds)
- 1099-C (cancellation of debt)

### Mortgage/Property

- 1098 (mortgage interest)
- Property tax bills
- HUD-1 / closing disclosure (if home purchased or sold)

### Education

- 1098-T (tuition)
- 1098-E (student loan interest)

### Health

- 1095-A (ACA marketplace coverage — REQUIRED if enrolled)
- 1095-B/C (employer/other health coverage)
- 1099-SA (HSA/MSA distributions)
- Form 5498-SA (HSA contributions — for reference)

### Childcare / Dependents

- Childcare provider info (name, address, EIN/SSN, amount paid)
- Dependent care FSA records (employer plan)

### Self-Employment

- 1099-NEC (independent contractor income)
- Business income/expense records
- Home office measurements (if applicable)
- Estimated tax payment records (Form 1040-ES)

### Other

- W-2G (gambling winnings)
- Crypto platform exports (CSV)
- Alimony records (for pre-2019 divorce agreements)
- State-specific forms

**Guidance**: "When in doubt, include it. It is better to have a document and not need it than miss income."

## Prior Year Filing Record — REQUIRED

MANDATE that the user provide their prior year return (old 1040 plus state return) or CPA organizer.

This is essential for:
- Comparison of income year-over-year
- Carryforward items (capital losses, etc.)
- Identifying what was filed before

HALT if not provided. Say: "A prior year return is required for reference to ensure accuracy. Please locate your prior year 1040 and state return."

## Per-Document Extraction Workflow

For each document the user provides, spawn a Task:

1. Create a subfolder named after the file (sanitized)
2. Based on file type:
   - **PDF**: Run `node "${SKILL_DIR}/scripts/extract-pdf.js" <pdf> <subfolder>` — creates page PNGs, page text files, and summary.json
   - **CSV/Spreadsheet**: Copy to subfolder, generate a `.md` summary parsing key data columns
   - **Image (JPG/PNG)**: Copy to subfolder, generate `.md` from visual read of the image
3. **Every file gets a `.md` summary** in its subfolder regardless of format
4. The task reads all extracted images plus raw text, then builds the `.md` summary noting:
   - Document type and issuer
   - Tax year
   - Key data points (amounts, EINs, names, addresses)
   - OCR vs raw text discrepancies — flag if image reads differ from text extraction
   - Unusual items flagged for follow-up

### IMPORTANT: OCR Accuracy

Image-based reads of tax documents frequently have significant errors — wrong dollar amounts, misread issuers, transposed digits. ALWAYS cross-reference visual reads against raw text extraction. When they disagree, flag both values and ask the user to verify.

## Consolidated Summary

After all documents are extracted, build a summary table:

```
| # | Document | Type | Issuer | Key Amount | Notes |
|---|----------|------|--------|------------|-------|
| 1 | W-2 | Employment | Acme Corp | Wages: $XX,XXX | Box 2 withholding: $X,XXX |
| 2 | 1099-INT | Interest | Bank of X | Interest: $XXX | |
...
```

## Multiple Passes

Discovery is iterative — expect multiple rounds. After initial extraction, review for gaps:

- Ask follow-up questions about anything ambiguous
- Request additional documents if gaps found (e.g., "I see a 1099-DIV from Schwab but no 1099-B — did you have any stock sales?")
- Phase 3's life change questionnaire and filing plan review may also reveal missing docs — loop back here to collect, extract, and update the summary
- Repeat until confident all documents are accounted for

Do NOT move to Phase 4 until discovery is truly complete. It is far cheaper to find a missing document now than to backtrack mid-filing.

## Front-Load ALL Questions

Before proceeding to Phase 4 filing, ask ALL questions via AskUserQuestion:

- Filing status (single, married filing jointly, head of household, etc.)
- Number of dependents and their info (names, dates of birth, relationship — user will enter SSNs directly into the browser)
- Deduction preference (standard vs itemized) if not obvious
- HSA contributions made during the year (employer + personal)
- Estimated tax payments made (dates and amounts)
- Refund preference: direct deposit or paper check (if direct deposit, they will enter bank details directly into FreeTaxUSA themselves)
- IRS Identity Protection PIN (IP PIN) — if they received one, it's required for e-filing (user enters this directly into the browser)
- Prior year AGI (needed for e-filing identity verification — often on prior year 1040 line 11)
- Any special situations flagged during extraction
- Anything ambiguous from documents

Do NOT leave questions for the middle of filing. Get everything resolved now.

## Tax Outcome Guesstimate

Provide a clearly labeled rough estimate:

1. Sum all income from extracted documents
2. Apply standard deduction (or estimated itemized if relevant)
3. Estimate tax from current year brackets
4. Subtract total withholdings from W-2s and estimated payments

Present as:

> **ESTIMATE ONLY** — This is a rough calculation to sanity-check your documents. Actual amounts will differ based on credits, adjustments, and FreeTaxUSA's calculations.

This helps catch missing documents early. If the estimate seems wildly off from what the user expects, investigate before proceeding.
