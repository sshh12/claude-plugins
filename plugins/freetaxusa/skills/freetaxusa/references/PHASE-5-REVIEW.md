# Phase 5: Review & Cleanup

## Tax Return Summary Report (HTML)

Generate a personalized HTML report and write it to the extraction folder as `tax-return-summary.html`. Open it in the browser so the user can review it visually.

### Requirements

- Single self-contained HTML file (inline CSS, no external dependencies)
- Deeply personalized to this specific user and their situation — not a generic template
- Written in plain English for someone who may not understand tax terminology
- Visually clean with good use of color, typography, and layout
- Use `<details>/<summary>` elements so the overview is scannable but detail is available
- Include `@media print` styles
- Footer with disclaimers (not tax advice, not affiliated, user responsible) and timestamp

### What to include

Use your judgment to build the report around what actually matters for this user's return. The goal is to help them **understand** their taxes — what happened, why, and what it means for them.

Ideas to draw from (include what's relevant, skip what isn't):
- Where their income came from and what it means
- How their deduction choice played out (and what the alternative would have been)
- What credits they got (or didn't get) and why
- How the tax calculation flows from gross income to refund/owed — demystify the process
- How this year compares to last year and why things changed
- How the actual result compares to the Phase 2 guesstimate
- Anything surprising, notable, or worth knowing about their specific return
- Actionable insights (carryforwards, phase-out proximity, W-4 adjustment suggestions, things to watch next year)
- The full assumptions log from Phase 4 — every decision made without asking the user, with reasoning and alternatives
- Clear next steps

The agent should make this report genuinely useful and educational for the user. Lean into specifics from their actual documents and situation rather than generic tax explanations.

## Assumptions Log

During Phase 4, decisions were made without asking the user — either from document transcription or from reasonable defaults. Present a complete list of every assumption made, so the user can verify each one. Examples of assumptions to surface:

- Filing status chosen and why
- Deduction method chosen (standard vs itemized) and why
- How ambiguous income was categorized (e.g., a 1099-MISC entered as other income vs self-employment)
- How multi-state income was allocated
- Which credits were claimed or skipped, and the reasoning
- Any "No" answers to FreeTaxUSA questions that could have been "Yes"
- Any amounts that were rounded, estimated, or inferred rather than directly transcribed
- Any entries from delegated agents that involved judgment calls (agents flag these in their completion reports)
- Whether standard or actual method was used for any deduction with options (e.g., home office)
- Any items from the filing plan that were skipped and why

Format as a clear table or numbered list. For each assumption, state what was decided and what the alternative was, so the user can evaluate whether the right choice was made.

## Review Checklist

After the user reviews the HTML report and the assumptions log, walk through these items:

1. **Total income**: Does it match the sum of all your W-2 wages plus 1099 income? If not, why?
2. **Filing status**: Is this correct? (Single, Married Filing Jointly, Head of Household, etc.)
3. **Deduction**: Standard or itemized? Does the choice make sense for your situation?
4. **Credits**: Were any claimed? Were any potentially missed?
5. **Withholdings**: Do they match your W-2 Box 2 amounts plus any estimated payments you made?
6. **State income**: If multi-state, is income allocated correctly between states?
7. **Total tax**: Does it seem reasonable given the effective rate shown in the report?
8. **Refund/owed**: Does this make sense given your withholdings?

If anything looks wrong, go back and investigate before the user submits.

## Next Steps

Explain what the user should do now:

1. Review the return on FreeTaxUSA's review page
2. Run FreeTaxUSA's built-in error check (usually a button on the review page)
3. Fix any errors flagged by FreeTaxUSA
4. **Save/print PDF copies of the return BEFORE submitting** — this is your record
5. When satisfied, submit the return themselves
6. For federal: choose direct deposit or check for refund, or payment method if owed
7. For state: pay the state filing fee, then submit
8. Save the confirmation numbers and submission receipts

If the IRS rejects the e-file (common reasons: SSN already used, prior year AGI mismatch, incorrect IP PIN, dependent claimed on another return), FreeTaxUSA will notify the user. Check the rejection reason and fix accordingly — or consult a tax professional if the issue is complex.

## Data Purge

The `~/Desktop/tax-data-purge-reminder.md` file was created in Phase 2. Remind the user it exists, and reiterate the cleanup steps verbally:

- Delete the extraction folder (contains SSNs and financial data in plain text)
- Delete browser screenshots
- Optionally clear the browser automation's Chrome profile
- Review `~/.claude/` conversation history for tax data
- Keep PDF copies of the filed return for at least 3 years

## Signoff

Use AskUserQuestion:

> "Have you reviewed the return and the summary report? Do you understand that you are solely responsible for its accuracy? (yes/no)"
