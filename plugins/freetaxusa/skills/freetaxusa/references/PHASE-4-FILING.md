# Phase 4: Filing

## Starting the Filing Session

- Navigate to FreeTaxUSA in the browser
- User logs in (or is already logged in) — do NOT attempt to enter credentials
- Select the correct tax year
- Confirm we are on the right account

## Critical: Complete From Scratch

If any data already exists from a prior attempt:

- Notify the user: "Existing data found from a prior filing attempt. I will verify and re-enter all fields from source documents to ensure accuracy. I will NOT rely on pre-filled data."
- Do NOT skip pages that appear complete — verify and re-enter every field
- Do NOT auto-skip pages because they have previous fills
- Treat every page as if filling from scratch

## Per-Page Workflow

For each page in the FreeTaxUSA flow:

1. **Read page** — use interactive-filtered read to see all form fields, radios, dropdowns
2. **Identify the page** — use page title/heading to confirm which section we are in
3. **Fill fields** per the filing plan:
   - For multi-field pages, use quick mode to batch fills
   - For single fields, use standard commands
   - Enter currency amounts as whole dollars (FreeTaxUSA auto-rounds)
4. **Verify** — read the page again or use JS to dump all form name/value pairs, compare against source docs
5. **Update verification table** (maintained throughout)
6. **Save and continue** — scroll down to find the button (often below fold), click it
7. **Wait for page load** — FreeTaxUSA shows a 2-4 second spinner after saves. Wait for network idle.

## Verification Table

Maintain this table throughout the filing process. Every entry is verified by **4 independent sources**:

1. **Expected** — the value from the extracted source document
2. **Entered** — what you typed/filled into the form
3. **Page Read** — the value read back from the page DOM (via text read or JS dump of form values)
4. **Screenshot** — visual confirmation from a screenshot of the completed form

Update the table after every page. All four columns must agree before marking verified:

```
| Item | Source Doc | Expected | Entered | Page Read | Screenshot | Verified |
|------|-----------|----------|---------|-----------|------------|----------|
| W-2 Wages (Acme) | W-2 Box 1 | $XX,XXX | $XX,XXX | $XX,XXX | $XX,XXX | Yes |
| W-2 Fed Withholding | W-2 Box 2 | $X,XXX | $X,XXX | $X,XXX | $X,XXX | Yes |
| Interest Income | 1099-INT | $XXX | $XXX | $XXX | $XXX | Yes |
| Dividend Income | 1099-DIV | $X,XXX | $X,XXX | $X,XXX | $X,XXX | Yes |
...
```

If any column disagrees, STOP and investigate before saving the page. Common causes: typo during entry, FreeTaxUSA auto-rounding, wrong field targeted, stale page read.

## Assume vs Ask

### ASSUME (enter directly from verified documents)

- W-2 box values (wages, withholdings, etc.)
- 1099 amounts (interest, dividends, etc.)
- Employer info (names, EINs, addresses)
- Any direct transcription from a tax document

### ASK (use AskUserQuestion)

- Filing status if ambiguous from documents
- Deduction choice (standard vs itemized)
- Tax treatment of unusual items (e.g., trading losses: ordinary vs capital)
- Dependent information not on documents
- Any amount discrepancy between documents
- Credit eligibility when not clear from documents
- Anything you are not 100% sure about

**Rule**: When in doubt, ask. Better to pause than enter wrong data.

### Track Assumptions

Maintain an **assumptions log** alongside the verification table. Every time a decision is made without explicitly asking the user — even reasonable ones — log it:

- What was decided
- Why (which document or rule justified it)
- What the alternative was

This includes: deduction method choice, income categorization, credit eligibility decisions, "No" answers to FreeTaxUSA questions, multi-state allocation choices, and any amounts that were rounded or inferred. Delegated agents should include their assumptions in their completion reports.

This log is presented to the user in Phase 5 for review.

## Agent Delegation

Filing many pages directly in the main conversation burns context fast (~3-10 tool calls per page, with page reads and screenshots). Delegate page-filling to background agents to keep the main conversation lean.

### Architecture

Handle the first few pages directly (to learn the site flow and catch any surprises), then delegate remaining sections to background agents. The exact split depends on the user's tax situation, but a typical pattern:

```
Main Conversation (orchestrator)
├── First section (e.g., Personal Info + first income form): Handle directly
├── Remaining Income sections: 1-2 background agents
├── Deductions/Credits through Summary: 1 background agent
├── State Return(s): 1 background agent per state
└── Checkpoint reviews + final verification: Handle directly
```

Split by complexity — simple "No" gate sections can share an agent; complex data entry (stock sales, multi-form income) may warrant separate agents. Adjust based on how many forms the user actually has.

### Agent Prompt Template

Each filing agent should receive:

1. **References to read first**: Paths to BROWSER-TIPS.md and GOTCHAS.md
2. **Current state**: What page the browser is on, what's already done, key numbers from the header
3. **Data to enter**: Organized by FreeTaxUSA section, exact amounts (whole dollars), source doc references
4. **What doesn't apply**: Explicit list of "No" answers with reasons — agents waste many tool calls figuring this out otherwise
5. **Browser tips (inline)**: Top 10 most relevant tips condensed — don't make the agent dig through files mid-flow
6. **Clear start and stop conditions**: "Start at [page]. Stop when [section] is complete. Do NOT proceed to [next section]."
7. **Pre-existing data warning**: Check for and report any stale entries from prior filing attempts — override with current year values
8. **Reporting requirements**: What to include in the completion report (amounts entered, final header numbers, issues encountered, new gotchas discovered)

### Efficiency Guidelines

- **Gate pages (Yes/No)**: Just click and continue — no screenshot verification needed. Verify via JS read-back only.
- **Data entry pages**: Verify via JS form value dump, then take ONE screenshot of the completed form. Do not screenshot before and after every field.
- **Keep completion reports concise**: The useful output is ~500 words summarizing what was entered and any issues. The agent's working transcript stays in agent context.
- **Agents can't ask the user questions**: If an agent encounters an ambiguous situation, it should flag it in its report rather than guessing. The main conversation reviews and resolves.

## Section-by-Section Filing

FreeTaxUSA follows a roughly linear flow through these sections, but the exact pages, ordering, and available options may vary by tax year, filing status, and what income/deduction types apply. Read each page as it comes rather than assuming a fixed sequence. The sections below cover the most common areas — skip any that don't apply to this user's filing plan.

### Personal Information

- Name, date of birth, address — enter from documents
- **SSNs**: Pause and ask the user to type SSNs directly into the browser. Do NOT enter SSNs through the agent. Same for dependent SSNs.
- Filing status (confirmed in Phases 2-3)
- Dependents (confirmed in Phases 2-3)

### Income — Wages (W-2)

For each W-2:
- Enter employer name, EIN, address
- Enter Boxes 1 through 20 as applicable
- Pay special attention to:
  - Box 12 codes (retirement contributions, health insurance, etc.) — may need "Add Another" for multiple codes
  - Box 13 checkboxes (statutory employee, retirement plan, third-party sick pay)
  - Box 14 (other) — state-specific items like SDI, SUI, FLI
  - State/local boxes (15-20)

### Income — Interest (1099-INT)

- Enter payer name and interest amount
- Note tax-exempt interest separately if applicable

### Income — Dividends (1099-DIV)

- Enter ordinary dividends and qualified dividends separately
- Capital gain distributions if present

### Income — Stock Sales (1099-B)

- For each sale: description, date acquired, date sold, proceeds, cost basis
- Check for wash sales (Box 1g)
- For many transactions, check if CSV import is available
- Verify short-term vs long-term classification

### Income — Other

- 1099-NEC / 1099-MISC (contractor/freelance income) — may trigger Schedule C
- 1099-G (unemployment compensation, state tax refunds)
- 1099-R (retirement distributions — note taxable amount and any early withdrawal)
- 1099-C (cancellation of debt — may be taxable income)
- SSA-1099 (Social Security benefits)
- K-1 (pass-through income)
- Any other income sources from the filing plan

### Self-Employment (if applicable)

- Schedule C: business income and expenses
- Self-employment tax (Schedule SE) is calculated automatically
- Home office deduction if applicable (simplified or actual)
- Quarterly estimated tax payments — enter amounts and dates

### Adjustments to Income

FreeTaxUSA typically handles these in the Deductions/Adjustments section (the exact placement may vary by tax year):
- IRA contributions (traditional — deductibility depends on income and workplace plan)
- Student loan interest (1098-E — verify current deduction cap from Phase 3 tax rules research)
- HSA contributions (Form 8889 — enter employer and personal contributions separately)
- Self-employment tax deduction (calculated automatically)
- Educator expenses (verify current deduction cap from Phase 3 tax rules research)

### HSA (Form 8889)

If the user has an HSA:
- Enter contribution amounts (employer contributions from W-2 Box 12 code W, plus personal contributions)
- Enter distributions from 1099-SA
- Confirm all distributions were for qualified medical expenses
- FreeTaxUSA generates Form 8889 automatically

### Deductions

- Standard vs itemized (confirmed in Phase 2)
- If itemized: medical expenses (verify current AGI floor percentage from Phase 3 tax rules research), state and local taxes (SALT — verify current cap and Married Filing Separately cap from Phase 3 tax rules research), mortgage interest (1098), charitable contributions (cash and non-cash)
- Present both options and their totals if user was unsure

### Credits

- Child Tax Credit / Additional Child Tax Credit
- Child and Dependent Care Credit (Form 2441) — enter provider info
- Education credits (American Opportunity Credit and Lifetime Learning Credit — verify current maximum amounts from Phase 3 tax rules research)
- Earned Income Tax Credit (EITC)
- Retirement Savings Contributions Credit (Saver's Credit)
- Clean Vehicle Credit / Energy Credits if applicable
- Premium Tax Credit reconciliation (Form 8962) if ACA marketplace coverage (1095-A required)
- Other applicable credits from the filing plan

### Estimated Tax Payments / Other Payments

- Estimated tax payments made during the year (dates and amounts from 1040-ES records)
- Extension payments if applicable
- Any other payments already made to IRS

### Direct Deposit / Refund Setup

- If owed a refund and user wants direct deposit: **pause and ask the user to enter their bank routing number and account number directly into the browser.** Do NOT handle bank details through the agent — treat them like passwords.
- Or select paper check
- If owing tax: FreeTaxUSA provides payment options (direct debit, payment voucher) — user handles payment details directly

## Checkpoint Reviews

At the end of each major section, spawn a dedicated Task to:

1. Screenshot plus read-page dump of the summary/review screen
2. Cross-check totals against local extracted documents
3. Flag any discrepancies or unexpected values
4. Report findings back for review

### Sections to Checkpoint

- After all income entered — verify total income matches document sum
- After deductions — verify deduction choice and amounts
- After credits — verify credits claimed and eligibility
- After state section — verify state income allocation
- Final summary page — comprehensive check of all numbers

If any checkpoint reveals a discrepancy, STOP and resolve before continuing.

## State Returns

Handle AFTER the federal return is complete. FreeTaxUSA typically flows to state after federal, though the exact transition may vary.

Watch for multi-state triggers:
- If employer address differs from residence state
- If user moved states during tax year
- Part-year / nonresident allocations

CRITICAL: Answer state questions based on where work was actually performed, not the employer's mailing address. Getting this wrong can misallocate ALL income to the wrong state.

## NEVER SUBMIT

Even if the user asks you to click submit, DO NOT.

Stop at the review/summary page. Tell the user:

> "Your return is ready for review on FreeTaxUSA. Please review all entries carefully, run FreeTaxUSA's built-in error check, and submit the return yourself."

The user MUST click submit themselves. This is non-negotiable.
